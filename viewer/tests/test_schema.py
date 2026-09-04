import sqlite3
import tempfile
import unittest
from pathlib import Path


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "db" / "schema.sql"


class AccountResultsSchemaTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "account-results.sqlite"
        self.connection = sqlite3.connect(self.db_path)
        self.connection.executescript(SCHEMA_PATH.read_text())

    def tearDown(self):
        self.connection.close()
        self.temp_dir.cleanup()

    def test_records_account_follower_snapshot(self):
        self.connection.execute(
            """
            INSERT INTO account_results (
                collected_at, followers, collection_source, raw_json
            ) VALUES (?, ?, ?, ?)
            """,
            (
                "2026-07-18T10:00:00Z",
                13,
                "TikWM public user-info API",
                '{"followerCount":13}',
            ),
        )

        row = self.connection.execute(
            """
            SELECT collected_at, followers, collection_source
            FROM account_results
            """
        ).fetchone()
        self.assertEqual(
            row,
            ("2026-07-18T10:00:00Z", 13, "TikWM public user-info API"),
        )

    def test_rejects_non_integer_follower_values(self):
        for followers in (-1, 1.5, "13"):
            with self.subTest(followers=followers):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.connection.execute(
                        """
                        INSERT INTO account_results (
                            collected_at, followers, collection_source
                        ) VALUES (?, ?, ?)
                        """,
                        ("2026-07-18T10:00:00Z", followers, "manual"),
                    )


class ContentCopySnapshotSchemaTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "content-copy.sqlite"
        self.connection = sqlite3.connect(self.db_path)
        self.connection.executescript(SCHEMA_PATH.read_text())
        self.connection.execute(
            "INSERT INTO hypotheses (id, statement, decision_reason) VALUES (?, ?, ?)",
            ("H-001", "Root statement", "Test fixture."),
        )

    def tearDown(self):
        self.connection.close()
        self.temp_dir.cleanup()

    def insert_content(
        self,
        copy_snapshot_json,
        hypothesis_id="H-001",
        medium="slideshow",
    ):
        self.connection.execute(
            """
            INSERT INTO contents (
                id, hypothesis_id, medium, format_id, message_id, message_version,
                copywriting_version, caption, copy_snapshot_json,
                final_project_path, final_project_sha256
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "C-001", hypothesis_id, medium, "example-format", "msg-example", 1,
                1, "caption", copy_snapshot_json,
                f"renderer/{medium}/formats/example-format/contents/C-001.json",
                "a" * 64,
            ),
        )

    def test_records_ordered_slideshow_copy(self):
        snapshot = '{"slides":[["hook","support"],["body","cta"]]}'
        self.insert_content(snapshot)

        value = self.connection.execute(
            "SELECT copy_snapshot_json FROM contents WHERE id = 'C-001'"
        ).fetchone()[0]
        self.assertEqual(value, snapshot)

        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "UPDATE contents SET copy_snapshot_json = '{}' WHERE id = 'C-001'"
            )

    def test_rejects_empty_or_invalid_slideshow_copy(self):
        for value in (
            "[]", "{}", '"hook"', '{"slides":[]}',
            '{"slides":["hook"]}', '{"slides":[[1]]}',
            '{"slides":[[]]}', "not-json",
        ):
            with self.subTest(value=value):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.insert_content(value)

    def test_records_video_copy_channels(self):
        snapshot = '{"on_screen_text":["overlay"],"spoken_text":["voiceover"]}'
        self.insert_content(snapshot, medium="video")

        row = self.connection.execute(
            "SELECT medium, copy_snapshot_json FROM contents WHERE id = 'C-001'"
        ).fetchone()
        self.assertEqual(row, ("video", snapshot))

    def test_rejects_non_integer_content_metrics(self):
        self.insert_content('{"slides":[["hook"]]}')

        for views in (-1, 1.5, "abc"):
            with self.subTest(views=views):
                with self.assertRaises(sqlite3.IntegrityError):
                    self.connection.execute(
                        """
                        INSERT INTO content_results (
                            content_id, target_hours, collected_at,
                            views, collection_source
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                        ("C-001", 24, "2026-07-19T00:00:00Z", views, "manual"),
                    )

    def test_enforces_active_leaf_lifecycle(self):
        self.connection.execute(
            """
            INSERT INTO hypotheses (
                id, parent_hypothesis_id, change_axis, statement, decision_reason
            ) VALUES (?, ?, ?, ?, ?)
            """,
            ("H-002", "H-001", "copywriting", "Child statement", "Test fixture."),
        )

        with self.assertRaisesRegex(sqlite3.IntegrityError, "active leaf"):
            self.insert_content('{"slides":[["hook"]]}')
        with self.assertRaisesRegex(sqlite3.IntegrityError, "branched"):
            self.connection.execute(
                """
                UPDATE hypotheses
                SET closed_at = ?, closure_reason = ?
                WHERE id = 'H-001'
                """,
                ("2026-07-19T00:00:00Z", "No longer active"),
            )

        self.connection.execute(
            """
            UPDATE hypotheses
            SET closed_at = ?, closure_reason = ?
            WHERE id = 'H-002'
            """,
            ("2026-07-19T00:00:00Z", "Test closure"),
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "cannot be reopened"):
            self.connection.execute(
                """
                UPDATE hypotheses
                SET closed_at = NULL, closure_reason = NULL
                WHERE id = 'H-002'
                """
            )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "active leaf"):
            self.insert_content('{"slides":[["hook"]]}', hypothesis_id="H-002")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "must exist and be open"):
            self.connection.execute(
                """
                INSERT INTO hypotheses (
                    id, parent_hypothesis_id, change_axis, statement, decision_reason
                ) VALUES (?, ?, ?, ?, ?)
                """,
                ("H-003", "H-002", "message", "Grandchild statement", "Test fixture."),
            )

        with self.assertRaisesRegex(sqlite3.IntegrityError, "must exist and be open"):
            self.connection.execute(
                """
                INSERT INTO hypotheses (
                    id, parent_hypothesis_id, change_axis, statement, decision_reason
                ) VALUES (?, ?, ?, ?, ?)
                """,
                ("H-004", "H-missing", "message", "Orphan statement", "Test fixture."),
            )

    def test_preserves_hypothesis_lineage(self):
        self.connection.execute(
            """
            INSERT INTO hypotheses (
                id, parent_hypothesis_id, change_axis, statement, decision_reason
            ) VALUES (?, ?, ?, ?, ?)
            """,
            ("H-002", "H-001", "message", "Child statement", "Test fixture."),
        )

        with self.assertRaisesRegex(sqlite3.IntegrityError, "lineage"):
            self.connection.execute(
                """
                UPDATE hypotheses
                SET parent_hypothesis_id = NULL, change_axis = NULL
                WHERE id = 'H-002'
                """
            )


if __name__ == "__main__":
    unittest.main()
