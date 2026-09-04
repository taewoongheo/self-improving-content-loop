#!/usr/bin/env python3

import argparse
import json
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

try:
    from scripts.collect_due_content_results import (
        CollectorAlreadyRunning,
        collector_lock,
        format_timestamp,
        parse_timestamp,
        read_bounded_response,
    )
except ModuleNotFoundError as error:
    if not error.name or not error.name.startswith("scripts"):
        raise
    from collect_due_content_results import (
        CollectorAlreadyRunning,
        collector_lock,
        format_timestamp,
        parse_timestamp,
        read_bounded_response,
    )

COLLECTION_SOURCE = "TikWM public profile API"
DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "db" / "hypothesis-loop.sqlite"
MIN_COLLECTION_INTERVAL = timedelta(hours=24)
TIKWM_USER_ENDPOINT = "https://www.tikwm.com/api/user/info"
HANDLE_PATTERN = re.compile(r"^[A-Za-z0-9._]{2,24}$")


def normalize_handle(value):
    handle = (value or "").strip().removeprefix("@").strip()
    if not HANDLE_PATTERN.fullmatch(handle):
        raise ValueError("TIKTOK_ACCOUNT_HANDLE must be a valid public TikTok handle")
    return handle


def validate_observation(observation):
    followers = observation.get("followers")
    if type(followers) is not int or followers < 0:
        raise ValueError(f"invalid followers: {followers!r}")
    raw_json = observation.get("raw_json")
    if not isinstance(raw_json, str):
        raise ValueError("raw_json must be a string")
    json.loads(raw_json)
    return {"followers": followers, "raw_json": raw_json}


def collect_account_result(connection, now, fetch_observation):
    latest = connection.execute(
        "SELECT collected_at FROM account_results ORDER BY collected_at DESC, id DESC LIMIT 1"
    ).fetchone()
    if latest is not None and now < parse_timestamp(latest[0]) + MIN_COLLECTION_INTERVAL:
        return 0

    observation = validate_observation(fetch_observation())
    with connection:
        connection.execute(
            """
            INSERT INTO account_results (
                collected_at, followers, collection_source, raw_json
            ) VALUES (?, ?, ?, ?)
            """,
            (
                format_timestamp(now),
                observation["followers"],
                COLLECTION_SOURCE,
                observation["raw_json"],
            ),
        )
    return 1


def fetch_tikwm_followers(handle, timeout=30):
    normalized_handle = normalize_handle(handle)
    request_url = f"{TIKWM_USER_ENDPOINT}?{urlencode({'unique_id': normalized_handle})}"
    request = Request(
        request_url,
        headers={"User-Agent": "lift-code-account-metrics-collector/1.0"},
    )
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
    user = data.get("user")
    stats = data.get("stats")
    if not isinstance(user, dict) or not isinstance(stats, dict):
        raise RuntimeError("TikWM response did not contain user and stats objects")
    returned_handle = str(user.get("uniqueId", ""))
    if returned_handle.casefold() != normalized_handle.casefold():
        raise RuntimeError(
            f"TikWM returned handle {returned_handle!r}, expected {normalized_handle!r}"
        )
    return {
        "followers": stats.get("followerCount"),
        "raw_json": raw_json,
    }


def fetch_with_retry(handle, attempts=3):
    last_error = None
    for attempt in range(attempts):
        try:
            return fetch_tikwm_followers(handle)
        except Exception as error:
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(f"failed after {attempts} attempts: {last_error}")


def parse_args():
    parser = argparse.ArgumentParser(
        description="Collect a low-frequency public TikTok follower observation."
    )
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    parser.add_argument("--handle", default=os.environ.get("TIKTOK_ACCOUNT_HANDLE"))
    parser.add_argument(
        "--now",
        help="UTC timestamp override for verification, for example 2026-07-20T12:00:00Z",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        handle = normalize_handle(args.handle)
        now = parse_timestamp(args.now) if args.now else datetime.now(timezone.utc)
        with collector_lock(args.db):
            with sqlite3.connect(args.db) as connection:
                connection.execute("PRAGMA foreign_keys = ON")
                connection.execute("PRAGMA busy_timeout = 30000")
                collect_account_result(
                    connection,
                    now=now,
                    fetch_observation=lambda: fetch_with_retry(handle),
                )
    except CollectorAlreadyRunning:
        return 0
    except Exception as error:
        print(f"daily account-result collector failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
