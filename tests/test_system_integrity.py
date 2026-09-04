import json
import sqlite3
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.system_integrity import inspect_system


REPO_ROOT = Path(__file__).resolve().parents[1]


class SystemIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.research_db = self.root / "research.sqlite"
        self.hypothesis_db = self.root / "hypothesis.sqlite"
        with sqlite3.connect(self.research_db) as connection:
            connection.executescript(
                (REPO_ROOT / "db/research-schema.sql").read_text(encoding="utf-8")
            )
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.executescript(
                (REPO_ROOT / "db/schema.sql").read_text(encoding="utf-8")
            )
        self.production_formats = self.root / "production-formats.json"
        self.production_formats.write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "production_enabled": True,
                    "allowed_formats": [
                        {"medium": "slideshow", "format_id": "sample-format"}
                    ],
                }
            ),
            encoding="utf-8",
        )
        self.formats_root = self.root / "renderer"
        sample_format = self.formats_root / "slideshow/formats/sample-format"
        (sample_format / "copywriting").mkdir(parents=True)
        (sample_format / "copywriting/v1.md").write_text("# Sample\n", encoding="utf-8")
        (sample_format / "references").mkdir()
        (sample_format / "references/reference.txt").write_text(
            "sample", encoding="utf-8"
        )
        self.jobs_path = self.root / "jobs.json"
        self.jobs_path.write_text(
            json.dumps(
                {
                    "jobs": [
                        {
                            "id": "metrics",
                            "name": "Hourly due content results",
                            "enabled": True,
                            "state": "scheduled",
                            "script": "collect_due_content_results_watchdog.py",
                            "no_agent": True,
                            "deliver": "telegram",
                        },
                        {
                            "id": "production",
                            "name": "LIFT CODE scheduled content production",
                            "enabled": True,
                            "state": "scheduled",
                            "prompt": (
                                "Preserve the current prelaunch contract: no app/product promotion, "
                                "no audience-facing CTA. Deliver the exact final media and do not ask "
                                "for approval; manual publication remains the user's action. Read "
                                "context/production-formats.json as the closed allowlist."
                            ),
                            "script": None,
                            "no_agent": False,
                            "deliver": "origin",
                            "origin": {"platform": "telegram", "chat_id": "test"},
                            "schedule": {"kind": "cron", "expr": "0 9,12,20,23 * * *"},
                            "workdir": str(REPO_ROOT),
                        },
                    ]
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self):
        self.temp_dir.cleanup()

    def inspect(self, **overrides):
        arguments = {
            "research_db": self.research_db,
            "hypothesis_db": self.hypothesis_db,
            "production_formats": self.production_formats,
            "jobs_path": self.jobs_path,
            "formats_root": self.formats_root,
            "required_files": [],
            "now": datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc),
        }
        arguments.update(overrides)
        return inspect_system(**arguments)

    def test_accepts_current_scheduler_topology_and_healthy_databases(self):
        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertEqual(report["issues"], [])
        self.assertEqual(report["warnings"], [])

    def test_selected_production_format_check_uses_closed_allowlist(self):
        allowed = self.inspect(
            selected_medium="slideshow", selected_format_id="sample-format"
        )
        blocked = self.inspect(
            selected_medium="slideshow", selected_format_id="blocked-format"
        )

        self.assertTrue(allowed["ok"], allowed)
        self.assertFalse(blocked["ok"], blocked)
        self.assertTrue(
            any("selected production format is not allowed" in issue for issue in blocked["issues"]),
            blocked,
        )

    def test_global_production_pause_still_rejects_duplicate_paused_jobs(self):
        formats = json.loads(self.production_formats.read_text(encoding="utf-8"))
        formats["production_enabled"] = False
        self.production_formats.write_text(json.dumps(formats), encoding="utf-8")
        payload = json.loads(self.jobs_path.read_text(encoding="utf-8"))
        payload["jobs"][1]["enabled"] = False
        payload["jobs"][1]["state"] = "paused"
        duplicate = dict(payload["jobs"][1])
        duplicate["id"] = "duplicate-production"
        payload["jobs"].append(duplicate)
        self.jobs_path.write_text(json.dumps(payload), encoding="utf-8")

        report = self.inspect()

        self.assertFalse(report["ok"], report)
        self.assertTrue(
            any("exactly one configured" in issue for issue in report["issues"]), report
        )

    def test_global_production_pause_still_validates_paused_job_configuration(self):
        formats = json.loads(self.production_formats.read_text(encoding="utf-8"))
        formats["production_enabled"] = False
        self.production_formats.write_text(json.dumps(formats), encoding="utf-8")
        payload = json.loads(self.jobs_path.read_text(encoding="utf-8"))
        payload["jobs"][1]["enabled"] = False
        payload["jobs"][1]["state"] = "paused"
        payload["jobs"][1]["workdir"] = "/tmp/wrong-workdir"
        self.jobs_path.write_text(json.dumps(payload), encoding="utf-8")

        report = self.inspect()

        self.assertFalse(report["ok"], report)
        self.assertTrue(
            any("repository workdir" in issue for issue in report["issues"]), report
        )

    def test_global_production_pause_blocks_selected_format(self):
        payload = json.loads(self.production_formats.read_text(encoding="utf-8"))
        payload["production_enabled"] = False
        self.production_formats.write_text(json.dumps(payload), encoding="utf-8")

        report = self.inspect(
            selected_medium="slideshow", selected_format_id="sample-format"
        )

        self.assertFalse(report["ok"], report)
        self.assertTrue(
            any("new content production is disabled" in issue for issue in report["issues"]),
            report,
        )

    def test_rejects_missing_production_format_owner(self):
        self.production_formats.unlink()

        report = self.inspect()

        self.assertFalse(report["ok"], report)
        self.assertTrue(
            any("production-format owner is missing" in issue for issue in report["issues"]),
            report,
        )

    def test_rejects_invalid_or_duplicate_production_format_entries(self):
        self.production_formats.write_text(
            json.dumps(
                {
                    "schema_version": 2,
                    "production_enabled": True,
                    "allowed_formats": [
                        {"medium": "slideshow", "format_id": "missing-format"},
                        {"medium": "slideshow", "format_id": "missing-format"},
                    ],
                }
            ),
            encoding="utf-8",
        )

        report = self.inspect()

        self.assertFalse(report["ok"], report)
        self.assertTrue(
            any("does not resolve" in issue for issue in report["issues"]), report
        )
        self.assertTrue(any("duplicates" in issue for issue in report["issues"]), report)

    def test_rejects_pending_content_from_a_non_allowed_format(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.execute(
                """
                INSERT INTO hypotheses (id, statement, decision_reason, created_at)
                VALUES ('hyp-1', 'Test message', 'Test the first message.', '2026-07-29T00:00:00Z')
                """
            )
            connection.execute(
                """
                INSERT INTO contents (
                    id, hypothesis_id, medium, format_id, message_id, message_version,
                    copywriting_version, caption, copy_snapshot_json,
                    final_project_path, final_project_sha256
                ) VALUES (
                    'content-1', 'hyp-1', 'slideshow', 'blocked-format', 'msg-test', 1,
                    1, 'caption', '{"slides":[["text"]]}',
                    'renderer/slideshow/formats/blocked-format/contents/content-1.json',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
                )
                """
            )

        report = self.inspect()

        self.assertFalse(report["ok"], report)
        self.assertTrue(
            any("non-allowed production format" in issue for issue in report["issues"]),
            report,
        )

    def test_allows_published_historical_content_after_format_removal(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.execute(
                """
                INSERT INTO hypotheses (id, statement, decision_reason, created_at)
                VALUES ('hyp-1', 'Test message', 'Test the first message.', '2026-07-29T00:00:00Z')
                """
            )
            connection.execute(
                """
                INSERT INTO contents (
                    id, hypothesis_id, medium, format_id, message_id, message_version,
                    copywriting_version, caption, copy_snapshot_json,
                    final_project_path, final_project_sha256, tiktok_url, published_at
                ) VALUES (
                    'content-1', 'hyp-1', 'slideshow', 'retired-format', 'msg-test', 1,
                    1, 'caption', '{"slides":[["text"]]}',
                    'renderer/slideshow/formats/retired-format/contents/content-1.json',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'https://www.tiktok.com/@liftcode/video/1', '2026-07-29T01:00:00Z'
                )
                """
            )

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertFalse(
            any("non-allowed production format" in issue for issue in report["issues"]),
            report,
        )

    def test_content_schedule_is_owned_by_cron_record(self):
        payload = json.loads(self.jobs_path.read_text(encoding="utf-8"))
        payload["jobs"][1]["schedule"]["expr"] = "0 9 * * *"
        self.jobs_path.write_text(json.dumps(payload), encoding="utf-8")

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertFalse(any("kickoff times" in issue for issue in report["issues"]))

    def test_paused_content_schedule_allows_manual_production(self):
        payload = json.loads(self.jobs_path.read_text(encoding="utf-8"))
        payload["jobs"][1]["enabled"] = False
        payload["jobs"][1]["state"] = "paused"
        self.jobs_path.write_text(json.dumps(payload), encoding="utf-8")

        report = self.inspect(
            selected_medium="slideshow", selected_format_id="sample-format"
        )

        self.assertTrue(report["ok"], report)
        self.assertEqual(report["issues"], [])

    def test_prior_collector_failure_is_operational_warning_not_a_latching_blocker(self):
        payload = json.loads(self.jobs_path.read_text(encoding="utf-8"))
        payload["jobs"][0]["last_status"] = "error"
        payload["jobs"][0]["last_delivery_error"] = "temporary delivery failure"
        self.jobs_path.write_text(json.dumps(payload), encoding="utf-8")

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertTrue(any("last_status=error" in warning for warning in report["warnings"]))
        self.assertTrue(any("delivery error" in warning for warning in report["warnings"]))

    def test_expired_research_lease_is_recoverable_and_does_not_latch_integrity(self):
        with sqlite3.connect(self.research_db) as connection:
            connection.execute(
                """
                INSERT INTO research_runs (
                    id, trigger_kind, objective, status, started_at, lease_expires_at
                ) VALUES (
                    'run-expired', 'manual', 'Recover this interrupted run.', 'running',
                    '2026-07-29T10:00:00Z', '2026-07-29T10:55:00Z'
                )
                """
            )

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertTrue(
            any("expired research lease" in warning for warning in report["warnings"]),
            report,
        )

    def test_warns_when_hypothesis_state_exists_but_event_research_is_empty(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.execute(
                """
                INSERT INTO hypotheses (id, statement, decision_reason, created_at)
                VALUES (
                    'hyp-current', 'Test one message', 'Establish the first message.',
                    '2026-07-29T00:00:00Z'
                )
                """
            )

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertTrue(
            any("no event research runs" in warning for warning in report["warnings"]),
            report,
        )

    def test_warns_when_one_hypothesis_has_not_progressed_for_seven_days(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.execute(
                """
                INSERT INTO hypotheses (
                    id, statement, decision_reason, last_evaluated_at, created_at
                ) VALUES (
                    'hyp-stale', 'Test one message', 'Establish the first message.',
                    '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z'
                )
                """
            )

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertTrue(
            any("one unchanged hypothesis" in warning for warning in report["warnings"]),
            report,
        )

    def test_does_not_treat_a_parent_with_a_closed_child_as_an_active_leaf(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.execute(
                """
                INSERT INTO hypotheses (
                    id, statement, decision_reason, last_evaluated_at, created_at
                ) VALUES (
                    'hyp-parent', 'Parent message', 'Establish the parent.',
                    '2026-07-20T00:00:00Z', '2026-07-20T00:00:00Z'
                )
                """
            )
            connection.execute(
                """
                INSERT INTO hypotheses (
                    id, parent_hypothesis_id, change_axis, statement, decision_reason,
                    closed_at, closure_reason, created_at
                ) VALUES (
                    'hyp-child', 'hyp-parent', 'message', 'Child message',
                    'Test a child message.', '2026-07-28T00:00:00Z',
                    'No longer active.', '2026-07-21T00:00:00Z'
                )
                """
            )

        report = self.inspect()

        self.assertFalse(
            any("one unchanged hypothesis" in warning for warning in report["warnings"]),
            report,
        )

    def test_warns_when_recent_checkpoint_has_no_result_review(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
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
                    final_project_path, final_project_sha256, tiktok_url, published_at
                ) VALUES (
                    'content-1', 'hyp-1', 'video', 'talking-head', 'msg-test', 1,
                    1, 'caption', '{"on_screen_text":[],"spoken_text":[]}',
                    'renderer/video/formats/talking-head/contents/content-1.json',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'https://www.tiktok.com/@liftcode/video/1', '2026-07-27T00:00:00Z'
                )
                """
            )
            connection.execute(
                """
                INSERT INTO content_results (
                    content_id, target_hours, collected_at, views, likes, comments,
                    shares, saves, observed_summary, limitations, collection_source, raw_json
                ) VALUES (
                    'content-1', 24, '2026-07-29T10:00:00Z', 100, 5, 1,
                    1, 2, 'Observed public counts.', 'Public counters only.', 'test', '{}'
                )
                """
            )

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertTrue(
            any("checkpoint has no subsequent result-review" in warning for warning in report["warnings"]),
            report,
        )

    def test_warns_for_each_checkpoint_not_linked_to_a_result_review(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.execute(
                """
                INSERT INTO hypotheses (id, statement, decision_reason, created_at)
                VALUES ('hyp-1', 'Test message', 'Test the first message.', '2026-07-27T00:00:00Z')
                """
            )
            for content_id in ("content-1", "content-2"):
                connection.execute(
                    """
                    INSERT INTO contents (
                        id, hypothesis_id, medium, format_id, message_id, message_version,
                        copywriting_version, caption, copy_snapshot_json,
                        final_project_path, final_project_sha256, tiktok_url, published_at
                    ) VALUES (?, 'hyp-1', 'video', 'talking-head', 'msg-test', 1,
                        1, 'caption', '{"on_screen_text":[],"spoken_text":[]}', ?,
                        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                        ?, '2026-07-27T00:00:00Z')
                    """,
                    (
                        content_id,
                        f"renderer/video/formats/talking-head/contents/{content_id}.json",
                        f"https://www.tiktok.com/@liftcode/video/{content_id[-1]}",
                    ),
                )
                connection.execute(
                    """
                    INSERT INTO content_results (
                        content_id, target_hours, collected_at, views, likes, comments,
                        shares, saves, observed_summary, limitations, collection_source, raw_json
                    ) VALUES (?, 24, '2026-07-29T10:00:00Z', 100, 5, 1, 1, 2,
                        'Observed public counts.', 'Public counters only.', 'test', '{}')
                    """,
                    (content_id,),
                )
        with sqlite3.connect(self.research_db) as connection:
            connection.execute(
                """
                INSERT INTO research_runs (
                    id, trigger_kind, objective, event_context_json, status,
                    started_at, finished_at
                ) VALUES (
                    'review-1', 'result_review', 'Review one checkpoint.',
                    '{"checkpoints":[{"result_id":2,"content_id":"content-2","target_hours":24}]}',
                    'completed', '2026-07-29T10:01:00Z', '2026-07-29T10:02:00Z'
                )
                """
            )
            connection.execute(
                """
                INSERT INTO research_runs (
                    id, trigger_kind, objective, event_context_json, status,
                    started_at, finished_at
                ) VALUES (
                    'review-too-early', 'result_review', 'Invalid early review.',
                    '{"checkpoints":[{"result_id":1,"content_id":"content-1","target_hours":24}]}',
                    'completed', '2026-07-29T09:59:00Z', '2026-07-29T09:59:30Z'
                )
                """
            )

        report = self.inspect()

        self.assertTrue(
            any("1 content checkpoint" in warning for warning in report["warnings"]),
            report,
        )

    def test_warns_on_unexplained_research_owner_and_source_concentration(self):
        with sqlite3.connect(self.research_db) as connection:
            for index in range(10):
                suffix = f"{index:02d}"
                run_id = f"RUN-{suffix}"
                question_id = f"Q-{suffix}"
                finding_id = f"F-{suffix}"
                source_id = f"S-{suffix}"
                connection.execute(
                    """
                    INSERT INTO research_runs (
                        id, trigger_kind, objective, status, started_at, finished_at
                    ) VALUES (?, 'manual', 'Test concentration.', 'completed', ?, ?)
                    """,
                    (run_id, f"2026-07-28T{index:02d}:00:00Z", f"2026-07-28T{index:02d}:30:00Z"),
                )
                connection.execute(
                    """
                    INSERT INTO research_questions (
                        id, run_id, position, question, why_now, expected_decision, status
                    ) VALUES (?, ?, 1, 'Test question?', 'Needed now.', 'Change a decision.', 'completed')
                    """,
                    (question_id, run_id),
                )
                connection.execute(
                    """
                    INSERT INTO research_findings (
                        id, question_id, finding_text, limitations, proposed_action,
                        routing_kind, proposed_owner, finding_fingerprint, created_at
                    ) VALUES (?, ?, 'Bounded finding.', 'Test limitation.', 'Use carefully.',
                              'existing_owner', 'context/expertise.md', ?, ?)
                    """,
                    (finding_id, question_id, f"{index:064x}", f"2026-07-28T{index:02d}:20:00Z"),
                )
                connection.execute(
                    """
                    INSERT INTO research_sources (
                        id, canonical_url, source_kind, first_seen_at, last_accessed_at
                    ) VALUES (?, ?, 'journal', ?, ?)
                    """,
                    (source_id, f"https://example.com/{index}", f"2026-07-28T{index:02d}:10:00Z", f"2026-07-28T{index:02d}:10:00Z"),
                )
                connection.execute(
                    """
                    INSERT INTO research_finding_sources (
                        finding_id, source_id, relation, evidence_note
                    ) VALUES (?, ?, 'supports', 'Supports the bounded finding.')
                    """,
                    (finding_id, source_id),
                )

        report = self.inspect()

        self.assertTrue(report["ok"], report)
        self.assertTrue(
            any("one proposed owner" in warning for warning in report["warnings"]),
            report,
        )
        self.assertTrue(
            any("one source class" in warning for warning in report["warnings"]),
            report,
        )

    def test_rejects_a_standalone_research_job(self):
        jobs = json.loads(self.jobs_path.read_text(encoding="utf-8"))
        jobs["jobs"].append(
            {
                "id": "research",
                "name": "Hourly open-ended research",
                "enabled": True,
                "state": "scheduled",
                "prompt": "research",
                "no_agent": False,
                "deliver": "telegram",
            }
        )
        self.jobs_path.write_text(json.dumps(jobs), encoding="utf-8")

        report = self.inspect()

        self.assertFalse(report["ok"])
        self.assertTrue(
            any("standalone research" in issue for issue in report["issues"]),
            report,
        )

    def test_reports_foreign_key_corruption(self):
        with sqlite3.connect(self.research_db) as connection:
            connection.execute("PRAGMA foreign_keys = OFF")
            connection.execute(
                """
                INSERT INTO research_questions (
                    id, run_id, position, question, why_now, expected_decision, status
                ) VALUES ('RQ-bad', 'RR-missing', 1, 'q', 'w', 'd', 'no_finding')
                """
            )

        report = self.inspect()

        self.assertFalse(report["ok"])
        self.assertTrue(any("foreign key" in issue for issue in report["issues"]), report)


    def test_reports_manual_analytics_lifecycle_corruption(self):
        with sqlite3.connect(self.hypothesis_db) as connection:
            connection.execute("DROP TRIGGER require_pending_measurement_request_insert")
            connection.execute(
                """
                INSERT INTO measurement_requests (
                    id, metric_key, scope_kind, window_start, window_end,
                    decision_reason, status, requested_at, fulfilled_at
                ) VALUES (
                    'MR-bad', 'profile_views', 'account',
                    '2026-07-22T00:00:00Z', '2026-07-29T00:00:00Z',
                    'Needed for diagnosis.', 'fulfilled',
                    '2026-07-29T12:00:00Z', '2026-07-29T12:00:00Z'
                )
                """
            )

        report = self.inspect()

        self.assertFalse(report["ok"])
        self.assertTrue(
            any("manual analytics lifecycle" in issue for issue in report["issues"]),
            report,
        )


if __name__ == "__main__":
    unittest.main()
