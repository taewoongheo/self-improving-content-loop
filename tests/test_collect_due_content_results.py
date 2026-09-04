import io
import json
import sqlite3
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import scripts.collect_due_content_results as collector
from scripts.collect_due_content_results import (
    CollectorAlreadyRunning,
    collect_due_results,
    collector_lock,
    read_bounded_response,
)


SCHEMA_PATH = Path(__file__).resolve().parents[1] / "db" / "schema.sql"
NOW = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)


class DueContentResultCollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "collector.sqlite"
        self.connection = sqlite3.connect(self.db_path)
        self.connection.executescript(SCHEMA_PATH.read_text())
        self.connection.execute(
            "INSERT INTO hypotheses (id, statement, decision_reason) VALUES (?, ?, ?)",
            ("H-001", "Root statement", "Test fixture."),
        )
        self.fetch_calls = []

    def tearDown(self):
        self.connection.close()
        self.temp_dir.cleanup()

    def add_content(self, content_id, published_at):
        self.connection.execute(
            """
            INSERT INTO contents (
                id, hypothesis_id, medium, format_id, message_id, message_version,
                copywriting_version, caption, copy_snapshot_json, final_project_path,
                final_project_sha256, tiktok_url, published_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                content_id,
                "H-001",
                "slideshow",
                "example-format",
                "msg-example",
                1,
                1,
                "caption",
                '{"slides":[["hook"],["body"]]}',
                f"renderer/slideshow/formats/example-format/contents/{content_id}.json",
                content_id[-1].lower() * 64,
                f"https://www.tiktok.com/@liftcode_test/photo/{content_id[-1]}",
                published_at,
            ),
        )

    def fetch_metrics(self, url):
        self.fetch_calls.append(url)
        payload = {
            "code": 0,
            "data": {
                "id": url.rsplit("/", 1)[-1],
                "play_count": 100,
                "digg_count": 10,
                "comment_count": 2,
                "share_count": 3,
                "collect_count": 4,
            },
        }
        return {
            "views": 100,
            "likes": 10,
            "comments": 2,
            "shares": 3,
            "saves": 4,
            "raw_json": json.dumps(payload, separators=(",", ":")),
        }

    def test_collects_due_checkpoint_once(self):
        self.add_content("C-001", "2026-07-19T11:00:00Z")
        collected_events = []

        inserted = collect_due_results(
            self.connection,
            now=NOW,
            fetch_metrics=self.fetch_metrics,
            collected_events=collected_events,
        )
        inserted_again = collect_due_results(
            self.connection,
            now=NOW,
            fetch_metrics=self.fetch_metrics,
        )

        self.assertEqual(inserted, 1)
        self.assertEqual(
            collected_events,
            [{
                "result_id": 1,
                "content_id": "C-001",
                "target_hours": 24,
                "collected_at": "2026-07-20T12:00:00Z",
            }],
        )
        self.assertEqual(inserted_again, 0)
        self.assertEqual(len(self.fetch_calls), 1)
        row = self.connection.execute(
            """
            SELECT target_hours, views, likes, comments, shares, saves,
                   interpretation, collection_source, json_valid(raw_json)
            FROM content_results
            WHERE content_id = 'C-001'
            """
        ).fetchone()
        self.assertEqual(
            row,
            (24, 100, 10, 2, 3, 4, None, "TikWM public API", 1),
        )

    def test_does_not_fetch_before_checkpoint_is_due(self):
        self.add_content("C-001", "2026-07-19T13:00:00Z")

        inserted = collect_due_results(
            self.connection,
            now=NOW,
            fetch_metrics=self.fetch_metrics,
        )

        self.assertEqual(inserted, 0)
        self.assertEqual(self.fetch_calls, [])

    def test_collects_latest_due_checkpoint_without_false_backfill(self):
        self.add_content("C-001", "2026-07-18T10:00:00Z")

        inserted = collect_due_results(
            self.connection,
            now=NOW,
            fetch_metrics=self.fetch_metrics,
        )

        self.assertEqual(inserted, 1)
        rows = self.connection.execute(
            """
            SELECT target_hours, limitations
            FROM content_results
            WHERE content_id = 'C-001'
            """
        ).fetchall()
        self.assertEqual(rows[0][0], 48)
        self.assertIn("24h checkpoint was left missing", rows[0][1])

    def test_does_not_backfill_checkpoint_older_than_existing_result(self):
        self.add_content("C-001", "2026-07-17T00:00:00Z")
        self.connection.execute(
            """
            INSERT INTO content_results (
                content_id, target_hours, collected_at, collection_source
            ) VALUES (?, ?, ?, ?)
            """,
            ("C-001", 72, "2026-07-20T00:00:00Z", "manual"),
        )

        inserted = collect_due_results(
            self.connection,
            now=NOW,
            fetch_metrics=self.fetch_metrics,
        )

        self.assertEqual(inserted, 0)
        self.assertEqual(self.fetch_calls, [])

    def test_one_fetch_failure_does_not_block_other_due_content(self):
        self.add_content("C-001", "2026-07-19T11:00:00Z")
        self.add_content("C-002", "2026-07-19T11:00:00Z")

        def fetch_with_one_failure(url):
            if url.endswith("/1"):
                raise RuntimeError("post unavailable")
            return self.fetch_metrics(url)

        with self.assertRaisesRegex(RuntimeError, "C-001: post unavailable"):
            collect_due_results(
                self.connection,
                now=NOW,
                fetch_metrics=fetch_with_one_failure,
            )

        rows = self.connection.execute(
            "SELECT content_id, target_hours FROM content_results ORDER BY content_id"
        ).fetchall()
        self.assertEqual(rows, [("C-002", 24)])

    def test_json_cli_reports_committed_checkpoints_on_partial_failure(self):
        self.add_content("C-001", "2026-07-19T11:00:00Z")
        self.add_content("C-002", "2026-07-19T11:00:00Z")
        self.connection.commit()

        def fetch_with_one_failure(url):
            if url.endswith("/1"):
                raise RuntimeError("post unavailable")
            return self.fetch_metrics(url)

        stdout = io.StringIO()
        stderr = io.StringIO()
        args = SimpleNamespace(db=self.db_path, now="2026-07-20T12:00:00Z", json=True)
        with (
            patch.object(collector, "parse_args", return_value=args),
            patch.object(collector, "fetch_with_retry", side_effect=fetch_with_one_failure),
            redirect_stdout(stdout),
            redirect_stderr(stderr),
        ):
            exit_code = collector.main()

        payload = json.loads(stdout.getvalue())
        self.assertEqual(exit_code, 1)
        self.assertEqual(payload["inserted"], 1)
        self.assertEqual(payload["checkpoints"][0]["content_id"], "C-002")
        self.assertIn("C-001: post unavailable", payload["errors"])

    def test_one_invalid_publication_timestamp_does_not_block_other_due_content(self):
        self.add_content("C-001", "not-a-timestamp")
        self.add_content("C-002", "2026-07-19T11:00:00Z")

        with self.assertRaisesRegex(RuntimeError, "C-001: Invalid isoformat string"):
            collect_due_results(
                self.connection,
                now=NOW,
                fetch_metrics=self.fetch_metrics,
            )

        rows = self.connection.execute(
            "SELECT content_id, target_hours FROM content_results ORDER BY content_id"
        ).fetchall()
        self.assertEqual(rows, [("C-002", 24)])

    def test_one_observation_failure_does_not_block_other_due_content(self):
        self.add_content("C-001", "2026-07-19T11:00:00Z")
        self.add_content("C-002", "2026-07-19T11:00:00Z")
        clock_calls = 0

        def observation_clock():
            nonlocal clock_calls
            clock_calls += 1
            if clock_calls == 1:
                raise RuntimeError("clock unavailable")
            return NOW

        with self.assertRaisesRegex(RuntimeError, "C-001: clock unavailable"):
            collect_due_results(
                self.connection,
                now=NOW,
                fetch_metrics=self.fetch_metrics,
                observation_clock=observation_clock,
            )

        rows = self.connection.execute(
            "SELECT content_id, target_hours FROM content_results ORDER BY content_id"
        ).fetchall()
        self.assertEqual(rows, [("C-002", 24)])

    def test_process_lock_rejects_overlapping_collector(self):
        with collector_lock(self.db_path):
            with self.assertRaises(CollectorAlreadyRunning):
                with collector_lock(self.db_path):
                    pass

    def test_rejects_oversized_source_response(self):
        with self.assertRaisesRegex(RuntimeError, "exceeded 10 bytes"):
            read_bounded_response(io.BytesIO(b"x" * 11), max_bytes=10)

    def test_records_observation_time_after_fetch(self):
        self.add_content("C-001", "2026-07-19T11:00:00Z")
        observed_at = NOW + timedelta(minutes=5)

        collect_due_results(
            self.connection,
            now=NOW,
            fetch_metrics=self.fetch_metrics,
            observation_clock=lambda: observed_at,
        )

        row = self.connection.execute(
            """
            SELECT collected_at, limitations
            FROM content_results
            WHERE content_id = 'C-001'
            """
        ).fetchone()
        self.assertEqual(row[0], "2026-07-20T12:05:00Z")
        self.assertIn("65 minutes after the 24h target", row[1])


if __name__ == "__main__":
    unittest.main()
