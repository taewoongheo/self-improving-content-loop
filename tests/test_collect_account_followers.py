import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.collect_account_followers import (
    COLLECTION_SOURCE,
    collect_account_result,
    normalize_handle,
    validate_observation,
)

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "db" / "schema.sql"
NOW = datetime(2026, 7, 20, 12, 0, tzinfo=timezone.utc)


class AccountFollowerCollectorTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "collector.sqlite"
        self.connection = sqlite3.connect(self.db_path)
        self.connection.executescript(SCHEMA_PATH.read_text())
        self.fetch_calls = 0

    def tearDown(self):
        self.connection.close()
        self.temp_dir.cleanup()

    def fetch_observation(self):
        self.fetch_calls += 1
        payload = {
            "code": 0,
            "data": {
                "user": {"uniqueId": "liftcode"},
                "stats": {"followerCount": 123},
            },
        }
        return {
            "followers": 123,
            "raw_json": json.dumps(payload, separators=(",", ":")),
        }

    def test_normalizes_public_handle(self):
        self.assertEqual(normalize_handle(" @lift.code_1 "), "lift.code_1")

    def test_rejects_missing_or_invalid_handle(self):
        for value in (None, "", "@", "bad handle", "x"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    normalize_handle(value)

    def test_collects_one_normalized_account_observation(self):
        inserted = collect_account_result(
            self.connection,
            now=NOW,
            fetch_observation=self.fetch_observation,
        )

        row = self.connection.execute(
            """
            SELECT collected_at, followers, collection_source, json_valid(raw_json)
            FROM account_results
            """
        ).fetchone()
        self.assertEqual(inserted, 1)
        self.assertEqual(
            row,
            ("2026-07-20T12:00:00Z", 123, COLLECTION_SOURCE, 1),
        )

    def test_skips_fetch_until_24_hours_after_latest_observation(self):
        collect_account_result(
            self.connection,
            now=NOW,
            fetch_observation=self.fetch_observation,
        )

        inserted = collect_account_result(
            self.connection,
            now=NOW + timedelta(hours=23, minutes=59),
            fetch_observation=self.fetch_observation,
        )

        self.assertEqual(inserted, 0)
        self.assertEqual(self.fetch_calls, 1)

    def test_collects_again_when_24_hours_have_elapsed(self):
        collect_account_result(
            self.connection,
            now=NOW,
            fetch_observation=self.fetch_observation,
        )

        inserted = collect_account_result(
            self.connection,
            now=NOW + timedelta(hours=24),
            fetch_observation=self.fetch_observation,
        )

        self.assertEqual(inserted, 1)
        self.assertEqual(self.fetch_calls, 2)

    def test_rejects_invalid_follower_observation(self):
        for followers in (-1, True, "123", None):
            with self.subTest(followers=followers):
                with self.assertRaises(ValueError):
                    validate_observation(
                        {"followers": followers, "raw_json": "{}"}
                    )


if __name__ == "__main__":
    unittest.main()
