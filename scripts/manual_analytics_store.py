#!/usr/bin/env python3
"""Store Telegram-requested TikTok Studio measurements and their provenance."""

import argparse
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "db/hypothesis-loop.sqlite"
COUNT_METRICS = {"profile_views", "post_follows"}
RATE_METRICS = {"watched_full_video_rate"}
SECONDS_METRICS = {"average_watch_time_seconds"}
METRICS = COUNT_METRICS | RATE_METRICS | SECONDS_METRICS


def utc_now():
    return datetime.now(timezone.utc)


def format_timestamp(value):
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("timestamp must include a timezone")
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def canonical_timestamp(value, field_name):
    if not isinstance(value, str):
        raise ValueError(f"{field_name} must be a timestamp string")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"{field_name} must be a valid timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field_name} must include a timezone")
    return format_timestamp(parsed)


def new_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex}"


class ManualAnalyticsStore:
    def __init__(self, db_path=DEFAULT_DB_PATH):
        self.db_path = Path(db_path)

    def connect(self):
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def request(
        self,
        *,
        metric_key,
        scope_kind,
        decision_reason,
        window_start,
        window_end,
        content_id=None,
        now=None,
    ):
        if metric_key not in METRICS:
            raise ValueError(f"unsupported metric: {metric_key}")
        if scope_kind not in {"account", "content"}:
            raise ValueError("scope_kind must be account or content")
        if (scope_kind == "account") != (content_id is None):
            raise ValueError("content scope requires content_id; account scope forbids it")
        if now is None:
            now = utc_now()
        window_start = canonical_timestamp(window_start, "window_start")
        window_end = canonical_timestamp(window_end, "window_end")
        requested_at = format_timestamp(now)
        if window_end <= window_start:
            raise ValueError("window_end must be after window_start")
        if window_end > requested_at:
            raise ValueError("window_end cannot be after requested_at")
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            existing = connection.execute(
                """
                SELECT id
                FROM measurement_requests
                WHERE metric_key = ?
                  AND scope_kind = ?
                  AND coalesce(content_id, '') = coalesce(?, '')
                  AND window_start = ?
                  AND window_end = ?
                  AND status = 'pending'
                """,
                (metric_key, scope_kind, content_id, window_start, window_end),
            ).fetchone()
            if existing is not None:
                return {"request_id": existing["id"], "status": "pending", "duplicate": True}
            request_id = new_id("MR")
            connection.execute(
                """
                INSERT INTO measurement_requests (
                    id, metric_key, scope_kind, content_id, window_start, window_end,
                    decision_reason, status, requested_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
                """,
                (
                    request_id,
                    metric_key,
                    scope_kind,
                    content_id,
                    window_start,
                    window_end,
                    decision_reason.strip(),
                    requested_at,
                ),
            )
        return {"request_id": request_id, "status": "pending", "duplicate": False}

    def pending(self):
        with self.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT * FROM measurement_requests
                    WHERE status = 'pending'
                    ORDER BY requested_at, id
                    """
                )
            ]

    def record(
        self,
        *,
        request_id,
        value,
        observed_at,
        evidence_ref,
        limitations,
        now=None,
    ):
        if now is None:
            now = utc_now()
        observed_at = canonical_timestamp(observed_at, "observed_at")
        recorded_at = format_timestamp(now)
        with self.connect() as connection:
            request = connection.execute(
                """
                SELECT metric_key, status, requested_at, window_end
                FROM measurement_requests
                WHERE id = ?
                """,
                (request_id,),
            ).fetchone()
            if request is None:
                raise ValueError(f"unknown measurement request: {request_id}")
            if request["status"] != "pending":
                raise ValueError("measurement request is not pending")
            if observed_at < request["requested_at"] or observed_at < request["window_end"]:
                raise ValueError("observed_at cannot precede the request or reporting window")
            if observed_at > recorded_at:
                raise ValueError("observed_at cannot be after recorded_at")
            self._validate_value(request["metric_key"], value)
            observation_id = new_id("MO")
            try:
                connection.execute(
                    """
                    INSERT INTO manual_analytics_observations (
                        id, request_id, value_json, observed_at, recorded_at,
                        source, evidence_ref, limitations
                    ) VALUES (?, ?, ?, ?, ?, 'TikTok Studio', ?, ?)
                    """,
                    (
                        observation_id,
                        request_id,
                        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
                        observed_at,
                        recorded_at,
                        evidence_ref.strip(),
                        limitations.strip(),
                    ),
                )
            except sqlite3.IntegrityError as error:
                raise ValueError(str(error)) from error
        return {
            "request_id": request_id,
            "observation_id": observation_id,
            "status": "fulfilled",
        }

    def cancel(self, *, request_id, reason, now=None):
        if now is None:
            now = utc_now()
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE measurement_requests
                SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?
                WHERE id = ? AND status = 'pending'
                """,
                (format_timestamp(now), reason.strip(), request_id),
            )
            if cursor.rowcount != 1:
                raise ValueError("measurement request is missing or not pending")
        return {"request_id": request_id, "status": "cancelled"}

    @staticmethod
    def _validate_value(metric_key, value):
        if metric_key in COUNT_METRICS:
            if type(value) is not int or value < 0:
                raise ValueError("count must be a non-negative integer")
        elif metric_key in RATE_METRICS:
            if type(value) not in {int, float} or not 0 <= value <= 1:
                raise ValueError("rate must be between 0 and 1")
        elif metric_key in SECONDS_METRICS:
            if type(value) not in {int, float} or value < 0:
                raise ValueError("seconds must be non-negative")
        else:
            raise ValueError(f"unsupported metric: {metric_key}")


def build_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    subparsers = parser.add_subparsers(dest="command", required=True)

    request = subparsers.add_parser("request")
    request.add_argument("--metric", required=True, choices=sorted(METRICS))
    request.add_argument("--scope", required=True, choices=("account", "content"))
    request.add_argument("--content-id")
    request.add_argument("--window-start", required=True)
    request.add_argument("--window-end", required=True)
    request.add_argument("--decision-reason", required=True)

    subparsers.add_parser("pending")

    record = subparsers.add_parser("record")
    record.add_argument("--request-id", required=True)
    record.add_argument("--value-json", required=True)
    record.add_argument("--observed-at", required=True)
    record.add_argument("--evidence-ref", required=True)
    record.add_argument("--limitations", required=True)

    cancel = subparsers.add_parser("cancel")
    cancel.add_argument("--request-id", required=True)
    cancel.add_argument("--reason", required=True)
    return parser


def main():
    args = build_parser().parse_args()
    store = ManualAnalyticsStore(args.db)
    if args.command == "request":
        result = store.request(
            metric_key=args.metric,
            scope_kind=args.scope,
            content_id=args.content_id,
            window_start=args.window_start,
            window_end=args.window_end,
            decision_reason=args.decision_reason,
        )
    elif args.command == "pending":
        result = store.pending()
    elif args.command == "record":
        result = store.record(
            request_id=args.request_id,
            value=json.loads(args.value_json),
            observed_at=args.observed_at,
            evidence_ref=args.evidence_ref,
            limitations=args.limitations,
        )
    else:
        result = store.cancel(request_id=args.request_id, reason=args.reason)
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
