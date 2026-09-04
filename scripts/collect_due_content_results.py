#!/usr/bin/env python3

import argparse
import fcntl
import hashlib
import json
import re
import sqlite3
import sys
import tempfile
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


CHECKPOINT_HOURS = (24, 48, 72)
COLLECTION_SOURCE = "TikWM public API"
DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "db" / "hypothesis-loop.sqlite"
TIKWM_ENDPOINT = "https://www.tikwm.com/api/"
MAX_RESPONSE_BYTES = 5 * 1024 * 1024


class CollectorAlreadyRunning(RuntimeError):
    pass


@contextmanager
def collector_lock(db_path):
    db_key = hashlib.sha256(str(Path(db_path).resolve()).encode("utf-8")).hexdigest()[:16]
    lock_path = Path(tempfile.gettempdir()) / f"lift-code-content-results-{db_key}.lock"
    with lock_path.open("a+") as lock_file:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise CollectorAlreadyRunning(str(db_path)) from error
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def read_bounded_response(response, max_bytes=MAX_RESPONSE_BYTES):
    payload = response.read(max_bytes + 1)
    if len(payload) > max_bytes:
        raise RuntimeError(f"TikWM response exceeded {max_bytes} bytes")
    return payload


def parse_timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def format_timestamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def due_target(published_at, existing_targets, now):
    latest_existing = max(existing_targets, default=0)
    due = [
        target
        for target in CHECKPOINT_HOURS
        if target > latest_existing
        and target not in existing_targets
        and now >= published_at + timedelta(hours=target)
    ]
    return max(due, default=None)


def validate_metrics(metrics):
    normalized = {}
    for field in ("views", "likes", "comments", "shares", "saves"):
        value = metrics.get(field)
        if type(value) is not int or value < 0:
            raise ValueError(f"invalid {field}: {value!r}")
        normalized[field] = value
    raw_json = metrics.get("raw_json")
    if not isinstance(raw_json, str):
        raise ValueError("raw_json must be a string")
    json.loads(raw_json)
    normalized["raw_json"] = raw_json
    return normalized


def collect_due_results(
    connection,
    now,
    fetch_metrics,
    observation_clock=None,
    collected_events=None,
):
    if observation_clock is None:
        observation_clock = lambda: now
    existing_by_content = {}
    for content_id, target_hours in connection.execute(
        """
        SELECT partial.content_id, partial.target_hours
        FROM content_results AS partial
        WHERE partial.target_hours < 72
          AND NOT EXISTS (
              SELECT 1
              FROM content_results AS completed
              WHERE completed.content_id = partial.content_id
                AND completed.target_hours = 72
          )
        """
    ):
        existing_by_content.setdefault(content_id, set()).add(target_hours)

    rows = connection.execute(
        """
        SELECT c.id, c.tiktok_url, c.published_at
        FROM contents AS c
        WHERE c.tiktok_url IS NOT NULL
          AND c.published_at IS NOT NULL
          AND NOT EXISTS (
              SELECT 1
              FROM content_results AS completed
              WHERE completed.content_id = c.id
                AND completed.target_hours = 72
          )
        ORDER BY c.published_at, c.id
        """
    ).fetchall()
    inserted = 0
    failures = []

    for content_id, tiktok_url, published_at_text in rows:
        existing_targets = existing_by_content.get(content_id, set())
        try:
            published_at = parse_timestamp(published_at_text)
        except Exception as error:
            failures.append(f"{content_id}: {error}")
            continue
        target = due_target(published_at, existing_targets, now)
        if target is None:
            continue

        skipped_targets = [
            checkpoint
            for checkpoint in CHECKPOINT_HOURS
            if checkpoint < target
            and checkpoint not in existing_targets
            and now >= published_at + timedelta(hours=checkpoint)
        ]

        try:
            metrics = validate_metrics(fetch_metrics(tiktok_url))
            observed_at = observation_clock()
            due_at = published_at + timedelta(hours=target)
            lag_minutes = max(0, int((observed_at - due_at).total_seconds() // 60))
            observed_summary = (
                f"Public counts at collection: {metrics['views']} views, "
                f"{metrics['likes']} likes, {metrics['comments']} comments, "
                f"{metrics['shares']} shares, and {metrics['saves']} saves."
            )
            limitations = (
                f"Collected {lag_minutes} minutes after the {target}h target. "
                "Public third-party API cache and timing semantics are not independently verified; "
                "the counts may include activity after the target time."
            )
            if skipped_targets:
                skipped_label = ", ".join(f"{checkpoint}h" for checkpoint in skipped_targets)
                noun = "checkpoint was" if len(skipped_targets) == 1 else "checkpoints were"
                limitations += (
                    f" The {skipped_label} {noun} left missing rather than backfilled "
                    "with this later observation."
                )

            with connection:
                cursor = connection.execute(
                    """
                    INSERT OR IGNORE INTO content_results (
                        content_id, target_hours, collected_at,
                        views, likes, comments, shares, saves,
                        observed_summary, interpretation, limitations,
                        collection_source, raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
                    """,
                    (
                        content_id,
                        target,
                        format_timestamp(observed_at),
                        metrics["views"],
                        metrics["likes"],
                        metrics["comments"],
                        metrics["shares"],
                        metrics["saves"],
                        observed_summary,
                        limitations,
                        COLLECTION_SOURCE,
                        metrics["raw_json"],
                    ),
                )
            inserted += cursor.rowcount
            if cursor.rowcount and collected_events is not None:
                collected_events.append(
                    {
                        "result_id": cursor.lastrowid,
                        "content_id": content_id,
                        "target_hours": target,
                        "collected_at": format_timestamp(observed_at),
                    }
                )
        except Exception as error:
            failures.append(f"{content_id}: {error}")

    if failures:
        raise RuntimeError("; ".join(failures))
    return inserted


def fetch_tikwm_metrics(tiktok_url, timeout=30):
    request_url = f"{TIKWM_ENDPOINT}?{urlencode({'url': tiktok_url})}"
    request = Request(request_url, headers={"User-Agent": "lift-code-metrics-collector/1.0"})
    with urlopen(request, timeout=timeout) as response:
        raw_json = read_bounded_response(response).decode("utf-8")
    payload = json.loads(raw_json)
    if payload.get("code") != 0:
        raise RuntimeError(
            f"TikWM returned code {payload.get('code')}: {payload.get('msg')!r}"
        )
    data = payload.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("TikWM response did not contain a data object")

    expected_match = re.search(r"/(?:video|photo)/(\d+)", tiktok_url)
    returned_id = str(data.get("id", ""))
    if expected_match and returned_id != expected_match.group(1):
        raise RuntimeError(
            f"TikWM returned post {returned_id!r}, expected {expected_match.group(1)!r}"
        )

    return {
        "views": data.get("play_count"),
        "likes": data.get("digg_count"),
        "comments": data.get("comment_count"),
        "shares": data.get("share_count"),
        "saves": data.get("collect_count"),
        "raw_json": raw_json,
    }


def fetch_with_retry(tiktok_url, attempts=3):
    last_error = None
    for attempt in range(attempts):
        try:
            return fetch_tikwm_metrics(tiktok_url)
        except Exception as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(f"failed after {attempts} attempts: {last_error}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Collect due 24h, 48h, and 72h TikTok checkpoints."
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument(
        "--now",
        help="UTC timestamp override for verification, for example 2026-07-20T12:00:00Z",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the collected checkpoint events as JSON.",
    )
    return parser.parse_args()


def print_json_result(collected_events, errors=None):
    print(
        json.dumps(
            {
                "inserted": len(collected_events),
                "checkpoints": collected_events,
                "errors": errors or [],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )


def main():
    args = parse_args()
    now = parse_timestamp(args.now) if args.now else datetime.now(timezone.utc)
    observation_clock = (
        (lambda: now) if args.now else (lambda: datetime.now(timezone.utc))
    )
    collected_events = []
    try:
        with collector_lock(args.db):
            with sqlite3.connect(args.db) as connection:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute("PRAGMA busy_timeout = 30000")
                collect_due_results(
                    connection,
                    now=now,
                    fetch_metrics=fetch_with_retry,
                    observation_clock=observation_clock,
                    collected_events=collected_events,
                )
    except CollectorAlreadyRunning:
        return 0
    except Exception as error:
        if args.json:
            print_json_result(collected_events, [str(error)])
        print(f"hourly content-result collector failed: {error}", file=sys.stderr)
        return 1
    if args.json:
        print_json_result(collected_events)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
