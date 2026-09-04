import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.manual_analytics_store import ManualAnalyticsStore


REPO_ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)


class ManualAnalyticsStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "hypothesis.sqlite"
        with sqlite3.connect(self.db_path) as connection:
            connection.executescript(
                (REPO_ROOT / "db/schema.sql").read_text(encoding="utf-8")
            )
        self.store = ManualAnalyticsStore(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_request_is_deduplicated_while_pending(self):
        first = self.store.request(
            metric_key="profile_views",
            scope_kind="account",
            decision_reason="Profile-view evidence blocks the current funnel diagnosis.",
            window_start="2026-07-22T00:00:00Z",
            window_end="2026-07-29T00:00:00Z",
            now=NOW,
        )
        second = self.store.request(
            metric_key="profile_views",
            scope_kind="account",
            decision_reason="Profile-view evidence blocks the current funnel diagnosis.",
            window_start="2026-07-22T09:00:00+09:00",
            window_end="2026-07-29T09:00:00+09:00",
            now=NOW,
        )

        self.assertEqual(first["request_id"], second["request_id"])
        self.assertFalse(first["duplicate"])
        self.assertTrue(second["duplicate"])

    def test_record_fulfills_request_and_preserves_provenance(self):
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                INSERT INTO hypotheses (id, statement, decision_reason, created_at)
                VALUES ('hyp-1', 'Test message', 'Test the first message.', '2026-07-28T00:00:00Z')
                """
            )
            connection.execute(
                """
                INSERT INTO contents (
                    id, hypothesis_id, medium, format_id, message_id, message_version,
                    copywriting_version, caption, copy_snapshot_json,
                    final_project_path, final_project_sha256
                ) VALUES (
                    'content-1', 'hyp-1', 'video', 'talking-head', 'msg-test', 1,
                    1, 'caption', '{"on_screen_text":[],"spoken_text":[]}',
                    'renderer/video/formats/talking-head/contents/content-1.json',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
                )
                """
            )

        request = self.store.request(
            metric_key="post_follows",
            scope_kind="content",
            content_id="content-1",
            decision_reason="Per-post follows are needed to interpret profile intent.",
            window_start="2026-07-28T00:00:00Z",
            window_end="2026-07-29T00:00:00Z",
            now=NOW,
        )
        result = self.store.record(
            request_id=request["request_id"],
            value=7,
            observed_at="2026-07-29T12:00:00Z",
            evidence_ref="telegram:message-123",
            limitations="TikTok Studio account display; exact attribution semantics are not independently verified.",
            now=datetime(2026, 7, 29, 13, 0, tzinfo=timezone.utc),
        )

        with sqlite3.connect(self.db_path) as connection:
            connection.row_factory = sqlite3.Row
            request_row = connection.execute(
                "SELECT * FROM measurement_requests WHERE id = ?",
                (request["request_id"],),
            ).fetchone()
            observation = connection.execute(
                "SELECT * FROM manual_analytics_observations WHERE request_id = ?",
                (request["request_id"],),
            ).fetchone()
        self.assertEqual(result["status"], "fulfilled")
        self.assertEqual(request_row["status"], "fulfilled")
        self.assertEqual(json.loads(observation["value_json"]), 7)
        self.assertEqual(observation["source"], "TikTok Studio")
        self.assertEqual(observation["evidence_ref"], "telegram:message-123")

    def test_rejects_a_rate_outside_zero_to_one(self):
        request = self.store.request(
            metric_key="watched_full_video_rate",
            scope_kind="account",
            decision_reason="Completion is needed to diagnose watch quality.",
            window_start="2026-07-22T00:00:00Z",
            window_end="2026-07-29T00:00:00Z",
            now=NOW,
        )

        with self.assertRaisesRegex(ValueError, "between 0 and 1"):
            self.store.record(
                request_id=request["request_id"],
                value=72,
                observed_at="2026-07-29T12:00:00Z",
                evidence_ref="telegram:message-124",
                limitations="Displayed as a percentage and not normalized yet.",
                now=datetime(2026, 7, 29, 13, 0, tzinfo=timezone.utc),
            )


    def test_rejects_an_empty_or_inverted_reporting_window(self):
        for window_start, window_end in (
            ("2026-07-30T10:00:00Z", "2026-07-30T10:00:00Z"),
            ("2026-07-30T11:00:00Z", "2026-07-30T10:00:00Z"),
        ):
            with self.assertRaisesRegex(ValueError, "window_end"):
                self.store.request(
                    metric_key="profile_views",
                    scope_kind="account",
                    decision_reason="Diagnose qualified-account interest.",
                    window_start=window_start,
                    window_end=window_end,
                    now=NOW,
                )

    def test_rejects_noncanonical_or_impossible_observation_timing(self):
        with self.assertRaisesRegex(ValueError, "timezone"):
            self.store.request(
                metric_key="profile_views",
                scope_kind="account",
                decision_reason="Diagnose qualified-account interest.",
                window_start="2026-07-22T00:00:00",
                window_end="2026-07-29T00:00:00Z",
                now=NOW,
            )

        request = self.store.request(
            metric_key="profile_views",
            scope_kind="account",
            decision_reason="Diagnose qualified-account interest.",
            window_start="2026-07-22T00:00:00Z",
            window_end="2026-07-29T00:00:00Z",
            now=NOW,
        )
        for observed_at, recorded_at in (
            ("2026-07-29T11:59:59Z", datetime(2026, 7, 29, 13, 0, tzinfo=timezone.utc)),
            ("2026-07-29T14:00:00Z", datetime(2026, 7, 29, 13, 0, tzinfo=timezone.utc)),
        ):
            with self.assertRaisesRegex(ValueError, "observed_at"):
                self.store.record(
                    request_id=request["request_id"],
                    value=10,
                    observed_at=observed_at,
                    evidence_ref="telegram:message-timing",
                    limitations="Manual observation timing test.",
                    now=recorded_at,
                )

    def test_rejects_breakdown_metrics_until_a_typed_contract_exists(self):
        with self.assertRaisesRegex(ValueError, "unsupported metric"):
            self.store.request(
                metric_key="viewer_composition",
                scope_kind="account",
                decision_reason="Understand viewer composition.",
                window_start="2026-07-22T00:00:00Z",
                window_end="2026-07-29T00:00:00Z",
                now=NOW,
            )
        with self.assertRaisesRegex(ValueError, "unsupported metric"):
            ManualAnalyticsStore._validate_value(
                "viewer_composition", {"arbitrary": 999999}
            )

    def test_schema_rejects_equivalent_pending_window_spellings(self):
        with sqlite3.connect(self.db_path) as connection:
            connection.execute(
                """
                INSERT INTO measurement_requests (
                    id, metric_key, scope_kind, window_start, window_end,
                    decision_reason, requested_at
                ) VALUES (
                    'MR-canonical', 'profile_views', 'account',
                    '2026-07-22T00:00:00Z', '2026-07-29T00:00:00Z',
                    'Need profile evidence.', '2026-07-29T12:00:00Z'
                )
                """
            )
            with self.assertRaisesRegex(sqlite3.IntegrityError, "equivalent pending"):
                connection.execute(
                    """
                    INSERT INTO measurement_requests (
                        id, metric_key, scope_kind, window_start, window_end,
                        decision_reason, requested_at
                    ) VALUES (
                        'MR-offset', 'profile_views', 'account',
                        '2026-07-22T09:00:00+09:00', '2026-07-29T09:00:00+09:00',
                        'Need profile evidence.', '2026-07-29T12:00:00Z'
                    )
                    """
                )

    def test_schema_rejects_bypassing_the_request_lifecycle(self):
        with sqlite3.connect(self.db_path) as connection:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "start pending"):
                connection.execute(
                    """
                    INSERT INTO measurement_requests (
                        id, metric_key, scope_kind, window_start, window_end,
                        decision_reason, status, requested_at, fulfilled_at
                    ) VALUES (
                        'MR-direct', 'profile_views', 'account',
                        '2026-07-22T00:00:00Z', '2026-07-29T00:00:00Z',
                        'Needed for diagnosis.', 'fulfilled',
                        '2026-07-29T12:00:00Z', '2026-07-29T12:00:00Z'
                    )
                    """
                )

        request = self.store.request(
            metric_key="profile_views",
            scope_kind="account",
            decision_reason="Profile-view evidence blocks the current funnel diagnosis.",
            window_start="2026-07-22T00:00:00Z",
            window_end="2026-07-29T00:00:00Z",
            now=NOW,
        )
        with sqlite3.connect(self.db_path) as connection:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "identity cannot change"):
                connection.execute(
                    "UPDATE measurement_requests SET metric_key = 'post_follows' WHERE id = ?",
                    (request["request_id"],),
                )
            with self.assertRaisesRegex(sqlite3.IntegrityError, "requires an observation"):
                connection.execute(
                    """
                    UPDATE measurement_requests
                    SET status = 'fulfilled', fulfilled_at = '2026-07-29T12:00:00Z'
                    WHERE id = ?
                    """,
                    (request["request_id"],),
                )


if __name__ == "__main__":
    unittest.main()
