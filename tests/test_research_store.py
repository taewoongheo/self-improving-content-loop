import hashlib
import json
import sqlite3
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.research_store import ResearchStore, canonicalize_url


NOW = datetime(2026, 7, 27, 0, 0, tzinfo=timezone.utc)
REPO_ROOT = Path(__file__).resolve().parents[1]


class ResearchStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "research.sqlite"
        self.store = ResearchStore(self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def payload(self, *, text="A bounded finding.", position=1):
        return {
            "position": position,
            "question": f"What should be learned at position {position}?",
            "why_now": "It can change the next marketing decision.",
            "expected_decision": "Decide whether to admit the finding.",
            "finding": {
                "text": text,
                "limitations": "One public source and no internal outcome evidence.",
                "proposed_action": "Review before adopting it.",
                "routing_kind": "existing_owner",
                "proposed_owner": "expertise_entries",
                "sources": [
                    {
                        "url": "HTTPS://Example.com/article?utm_source=test&b=2&a=1#section",
                        "source_kind": "web",
                        "title": "Example article",
                        "publisher": "Example",
                        "relation": "supports",
                        "evidence_note": "Direct support for the bounded statement.",
                    }
                ],
            },
        }

    def test_initializes_schema_and_skips_an_overlapping_run(self):
        first = self.store.start_run(
            "scheduled", "Resolve the most valuable current unknown.", now=NOW
        )
        second = self.store.start_run(
            "content_preflight", "Resolve a content blocker.", now=NOW + timedelta(minutes=1)
        )

        self.assertEqual(first["status"], "started")
        self.assertEqual(second["status"], "skipped")
        self.assertEqual(second["active_run_id"], first["run_id"])

        with sqlite3.connect(self.db_path) as connection:
            rows = connection.execute(
                "SELECT status, skip_reason FROM research_runs ORDER BY started_at, id"
            ).fetchall()
        self.assertEqual([row[0] for row in rows], ["running", "skipped"])
        self.assertIn(first["run_id"], rows[1][1])

    def test_expired_lease_is_failed_before_a_new_run_starts(self):
        first = self.store.start_run(
            "scheduled",
            "First run.",
            now=NOW,
            lease_minutes=5,
        )
        second = self.store.start_run(
            "scheduled",
            "Recovered run.",
            now=NOW + timedelta(minutes=6),
        )

        self.assertEqual(second["status"], "started")
        with sqlite3.connect(self.db_path) as connection:
            stale = connection.execute(
                "SELECT status, error_text FROM research_runs WHERE id = ?",
                (first["run_id"],),
            ).fetchone()
        self.assertEqual(stale[0], "failed")
        self.assertIn("lease expired", stale[1])

    def test_expired_run_recovery_terminates_its_selected_questions(self):
        first = self.store.start_run(
            "scheduled", "Interrupted run.", now=NOW, lease_minutes=5
        )
        self.store.select_question(
            first["run_id"],
            {
                "position": 1,
                "question": "Which evidence is still needed?",
                "why_now": "The decision is blocked.",
                "expected_decision": "Continue or stop.",
            },
            now=NOW + timedelta(minutes=1),
        )

        second = self.store.start_run(
            "manual",
            "Recover after interruption.",
            now=NOW + timedelta(minutes=6),
        )

        self.assertEqual(second["status"], "started")
        with sqlite3.connect(self.db_path) as connection:
            recovered = connection.execute(
                """
                SELECT run.status, question.status, question.outcome_reason
                FROM research_runs AS run
                JOIN research_questions AS question ON question.run_id = run.id
                WHERE run.id = ?
                """,
                (first["run_id"],),
            ).fetchone()
        self.assertEqual(recovered[0], "failed")
        self.assertEqual(recovered[1], "failed")
        self.assertIn("lease expired", recovered[2])

    def test_result_review_requires_and_persists_exact_checkpoint_context(self):
        with self.assertRaisesRegex(ValueError, "at least one checkpoint"):
            self.store.start_run("result_review", "Review metrics.", now=NOW)
        for invalid_checkpoint in (
            {"result_id": 1, "content_id": 123, "target_hours": 24},
            {"result_id": 1, "content_id": "content-1", "target_hours": 24.0},
            {"result_id": 0, "content_id": "content-1", "target_hours": 24},
        ):
            with self.assertRaisesRegex(ValueError, "checkpoint is invalid"):
                self.store.start_run(
                    "result_review",
                    "Review metrics.",
                    now=NOW,
                    event_context={"checkpoints": [invalid_checkpoint]},
                )

        event_context = {
            "checkpoints": [{
                "result_id": 7,
                "content_id": "content-1",
                "target_hours": 24,
            }]
        }
        run = self.store.start_run(
            "result_review",
            "Review metrics.",
            now=NOW,
            event_context=event_context,
        )

        with sqlite3.connect(self.db_path) as connection:
            stored = connection.execute(
                "SELECT event_context_json FROM research_runs WHERE id = ?",
                (run["run_id"],),
            ).fetchone()[0]
        self.assertEqual(json.loads(stored), event_context)

    def test_expired_lease_rejects_question_and_finish_writes(self):
        run = self.store.start_run(
            "scheduled", "Short lease.", now=NOW, lease_minutes=1
        )

        with self.assertRaisesRegex(ValueError, "research run lease expired"):
            self.store.record_question(
                run["run_id"], self.payload(), now=NOW + timedelta(minutes=2)
            )

        with self.assertRaisesRegex(ValueError, "research run lease expired"):
            self.store.finish_run(
                run["run_id"], "completed", now=NOW + timedelta(minutes=2)
            )

    def test_records_one_bounded_finding_with_canonical_source(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        recorded = self.store.record_question(run["run_id"], self.payload(), now=NOW)

        self.assertEqual(recorded["status"], "completed")
        self.assertTrue(recorded["finding_id"].startswith("RF-"))
        with sqlite3.connect(self.db_path) as connection:
            source = connection.execute(
                "SELECT canonical_url FROM research_sources"
            ).fetchone()[0]
            capture = connection.execute(
                "SELECT original_url, retrieval_method FROM research_source_captures"
            ).fetchone()
        self.assertEqual(source, "https://example.com/article?a=1&b=2")
        self.assertEqual(
            capture[0],
            "HTTPS://Example.com/article?utm_source=test&b=2&a=1#section",
        )
        self.assertEqual(capture[1], "web")

    def test_selected_question_is_persisted_before_research_completes(self):
        run = self.store.start_run("scheduled", "Persist selected work.", now=NOW)
        payload = self.payload()

        selected = self.store.select_question(
            run["run_id"],
            {
                key: payload[key]
                for key in ("position", "question", "why_now", "expected_decision")
            },
            now=NOW + timedelta(minutes=1),
        )

        with sqlite3.connect(self.db_path) as connection:
            stored = connection.execute(
                "SELECT id, status FROM research_questions WHERE run_id = ? AND position = 1",
                (run["run_id"],),
            ).fetchone()
        self.assertEqual(stored, (selected["question_id"], "selected"))

    def test_completed_run_rejects_unresolved_selected_questions(self):
        run = self.store.start_run("scheduled", "Require terminal questions.", now=NOW)
        payload = self.payload()
        self.store.select_question(
            run["run_id"],
            {
                key: payload[key]
                for key in ("position", "question", "why_now", "expected_decision")
            },
            now=NOW + timedelta(minutes=1),
        )

        with self.assertRaisesRegex(ValueError, "cannot retain selected questions"):
            self.store.finish_run(
                run["run_id"], "completed", now=NOW + timedelta(minutes=2)
            )

    def test_recording_transitions_the_selected_question(self):
        run = self.store.start_run("scheduled", "Complete selected work.", now=NOW)
        payload = self.payload()
        selected = self.store.select_question(
            run["run_id"],
            {
                key: payload[key]
                for key in ("position", "question", "why_now", "expected_decision")
            },
            now=NOW + timedelta(minutes=1),
        )

        recorded = self.store.record_question(
            run["run_id"], payload, now=NOW + timedelta(minutes=2)
        )

        with sqlite3.connect(self.db_path) as connection:
            questions = connection.execute(
                "SELECT id, status FROM research_questions WHERE run_id = ?",
                (run["run_id"],),
            ).fetchall()
        self.assertEqual(questions, [(selected["question_id"], "completed")])
        self.assertEqual(recorded["question_id"], selected["question_id"])

    def test_repeated_finding_becomes_duplicate_without_copying_the_fact(self):
        first_run = self.store.start_run("manual", "First research.", now=NOW)
        first = self.store.record_question(first_run["run_id"], self.payload(), now=NOW)
        self.store.finish_run(first_run["run_id"], "completed", now=NOW)

        second_run = self.store.start_run(
            "scheduled", "Avoid repeated research.", now=NOW + timedelta(hours=1)
        )
        duplicate = self.store.record_question(
            second_run["run_id"], self.payload(position=1), now=NOW + timedelta(hours=1)
        )

        self.assertEqual(duplicate["status"], "duplicate")
        self.assertEqual(duplicate["duplicate_of_finding_id"], first["finding_id"])
        with sqlite3.connect(self.db_path) as connection:
            count = connection.execute("SELECT COUNT(*) FROM research_findings").fetchone()[0]
            captures = connection.execute(
                "SELECT COUNT(*) FROM research_source_captures"
            ).fetchone()[0]
        self.assertEqual(count, 1)
        self.assertEqual(captures, 2)

    def test_semantically_changed_finding_is_not_collapsed_by_text_alone(self):
        first_run = self.store.start_run("manual", "First research.", now=NOW)
        first = self.store.record_question(first_run["run_id"], self.payload(), now=NOW)
        self.store.finish_run(first_run["run_id"], "completed", now=NOW)

        changed = self.payload()
        changed["finding"]["limitations"] = "A materially narrower population and timeframe."
        changed["finding"]["sources"][0]["url"] = "https://example.com/narrower"
        second_run = self.store.start_run(
            "manual", "Changed semantic scope.", now=NOW + timedelta(minutes=1)
        )
        second = self.store.record_question(
            second_run["run_id"], changed, now=NOW + timedelta(minutes=1)
        )

        self.assertEqual(second["status"], "completed")
        self.assertNotEqual(second["finding_id"], first["finding_id"])

    def test_review_freezes_finding_source_provenance(self):
        first_run = self.store.start_run("manual", "First evidence.", now=NOW)
        first = self.store.record_question(first_run["run_id"], self.payload(), now=NOW)
        self.store.review(
            first["finding_id"],
            "approved",
            "Autonomous review found bounded support.",
            now=NOW + timedelta(minutes=1),
        )
        self.store.finish_run(
            first_run["run_id"], "completed", now=NOW + timedelta(minutes=1)
        )

        duplicate_payload = self.payload()
        duplicate_payload["finding"]["sources"][0]["url"] = (
            "https://example.com/new-evidence"
        )
        second_run = self.store.start_run(
            "manual", "Later duplicate evidence.", now=NOW + timedelta(minutes=2)
        )
        duplicate = self.store.record_question(
            second_run["run_id"], duplicate_payload, now=NOW + timedelta(minutes=2)
        )

        with sqlite3.connect(self.db_path) as connection:
            links = connection.execute(
                "SELECT COUNT(*) FROM research_finding_sources WHERE finding_id = ?",
                (first["finding_id"],),
            ).fetchone()[0]
            question_sources = connection.execute(
                """
                SELECT source.canonical_url
                FROM research_duplicate_question_sources AS question_source
                JOIN research_sources AS source ON source.id = question_source.source_id
                WHERE question_source.question_id = ?
                """,
                (duplicate["question_id"],),
            ).fetchall()
        self.assertEqual(duplicate["status"], "duplicate")
        self.assertEqual(links, 1)
        self.assertEqual(question_sources, [("https://example.com/new-evidence",)])

    def test_proposals_stop_at_review_and_cannot_be_adopted(self):
        payload = self.payload()
        payload["finding"]["routing_kind"] = "new_owner_proposal"
        payload["finding"]["proposed_owner"] = "future-owner"
        run = self.store.start_run("manual", "Propose a structural owner.", now=NOW)
        finding = self.store.record_question(run["run_id"], payload, now=NOW)
        self.store.review(
            finding["finding_id"],
            "approved",
            "Autonomous review found bounded support.",
            now=NOW + timedelta(minutes=1),
        )

        with self.assertRaisesRegex(ValueError, "proposal findings are not adoptable"):
            self.store.adopt(
                finding["finding_id"],
                "external_proposal",
                "future-owner",
                {},
                now=NOW + timedelta(minutes=2),
            )

    def test_outside_scope_is_rejected_as_a_finding_route(self):
        payload = self.payload()
        payload["finding"]["routing_kind"] = "outside_scope"
        payload["finding"]["proposed_owner"] = None
        run = self.store.start_run("manual", "Reject invalid routing.", now=NOW)

        with self.assertRaisesRegex(ValueError, "invalid finding route"):
            self.store.record_question(run["run_id"], payload, now=NOW)

    def test_records_outside_scope_as_a_terminal_question_outcome(self):
        run = self.store.start_run("manual", "Record bounded scope decision.", now=NOW)
        result = self.store.record_question(
            run["run_id"],
            {
                "position": 1,
                "question": "Does this question affect the LIFT CODE marketing system?",
                "why_now": "The research selector must close irrelevant questions explicitly.",
                "expected_decision": "Whether to research the question.",
                "outcome": "outside_scope",
                "outcome_reason": "It has no decision-relevant connection to LIFT CODE.",
            },
            now=NOW + timedelta(minutes=1),
        )

        self.assertEqual(result["status"], "outside_scope")
        with sqlite3.connect(self.db_path) as connection:
            stored = connection.execute(
                "SELECT status, outcome_reason FROM research_questions WHERE id = ?",
                (result["question_id"],),
            ).fetchone()
        self.assertEqual(
            stored,
            ("outside_scope", "It has no decision-relevant connection to LIFT CODE."),
        )

    def test_records_bounded_failed_question_without_fabricating_a_finding(self):
        run = self.store.start_run("scheduled", "Research live unknowns.", now=NOW)

        result = self.store.record_question(
            run["run_id"],
            {
                "position": 1,
                "question": "Did the live source expose the required evidence?",
                "why_now": "The answer could change the next decision.",
                "expected_decision": "Whether to retry with another source.",
                "outcome": "failed",
                "outcome_reason": "The source required a credential that is not configured.",
            },
            now=NOW + timedelta(minutes=1),
        )

        self.assertEqual(result["status"], "failed")
        with sqlite3.connect(self.db_path) as connection:
            count = connection.execute("SELECT COUNT(*) FROM research_findings").fetchone()[0]
        self.assertEqual(count, 0)

    def test_pending_findings_can_be_limited_to_the_current_run(self):
        first_run = self.store.start_run("manual", "First run.", now=NOW)
        first = self.store.record_question(first_run["run_id"], self.payload(), now=NOW)
        self.store.finish_run(first_run["run_id"], "completed", now=NOW + timedelta(minutes=1))

        second_payload = self.payload()
        second_payload["finding"]["text"] = "A distinct second bounded finding."
        second_payload["finding"]["sources"][0]["url"] = "https://example.com/second"
        second_run = self.store.start_run("manual", "Second run.", now=NOW + timedelta(minutes=2))
        second = self.store.record_question(
            second_run["run_id"], second_payload, now=NOW + timedelta(minutes=3)
        )

        pending = self.store.pending_findings(run_id=second_run["run_id"])

        self.assertEqual([item["id"] for item in pending], [second["finding_id"]])
        self.assertNotEqual(first["finding_id"], second["finding_id"])

    def test_lists_unresolved_findings_with_sources_for_autonomous_review(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        recorded = self.store.record_question(run["run_id"], self.payload(), now=NOW)

        pending = self.store.pending_findings()

        self.assertEqual(len(pending), 1)
        self.assertEqual(pending[0]["id"], recorded["finding_id"])
        self.assertEqual(pending[0]["sources"][0]["canonical_url"], "https://example.com/article?a=1&b=2")

    def test_approved_existing_owner_remains_unresolved_until_adoption(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        existing = self.store.record_question(run["run_id"], self.payload(), now=NOW)
        self.store.review(
            existing["finding_id"],
            "approved",
            "The existing-owner change is supported.",
            now=NOW + timedelta(minutes=1),
        )

        proposal_payload = self.payload()
        proposal_payload["position"] = 2
        proposal_payload["question"] = "Is a new owner required?"
        proposal_payload["finding"]["text"] = "A bounded missing-owner proposal."
        proposal_payload["finding"]["routing_kind"] = "new_owner_proposal"
        proposal_payload["finding"]["proposed_owner"] = "future-owner"
        proposal_payload["finding"]["sources"][0]["url"] = "https://example.com/proposal"
        proposal = self.store.record_question(
            run["run_id"], proposal_payload, now=NOW + timedelta(minutes=2)
        )
        self.store.review(
            proposal["finding_id"],
            "approved",
            "The proposal is supported but remains non-adoptable.",
            now=NOW + timedelta(minutes=3),
        )

        unresolved = self.store.pending_findings()

        self.assertEqual([item["id"] for item in unresolved], [existing["finding_id"]])
        with sqlite3.connect(self.db_path) as connection:
            proposal_notification = connection.execute(
                """
                SELECT status
                FROM research_notifications
                WHERE finding_id = ? AND notification_kind = 'proposal'
                """,
                (proposal["finding_id"],),
            ).fetchone()
        self.assertEqual(proposal_notification, ("pending",))

        dispatched = self.store.prepare_notifications(
            "proposal-approved", now=NOW + timedelta(minutes=3, seconds=30)
        )
        self.assertEqual(
            [item["event_revision"] for item in dispatched["notifications"]],
            [1],
        )

        self.store.review(
            proposal["finding_id"],
            "rejected",
            "A later review found that no new owner is justified.",
            now=NOW + timedelta(minutes=4),
        )
        resolved = self.store.resolve_notification_attempt(
            "proposal-approved",
            "delivered",
            transport_ref="cron:stale-proposal",
            now=NOW + timedelta(minutes=4, seconds=30),
        )
        self.assertEqual(resolved["status"], "cancelled")
        self.assertEqual(resolved["notification_count"], 0)
        self.assertEqual(resolved["cancelled_count"], 1)
        cancelled = self.store.prepare_notifications(
            "proposal-rejected", now=NOW + timedelta(minutes=5)
        )
        self.assertEqual(cancelled["notifications"], [])
        self.store.review(
            proposal["finding_id"],
            "approved",
            "New evidence now justifies notifying the revised proposal.",
            now=NOW + timedelta(minutes=6),
        )
        prepared = self.store.prepare_notifications(
            "proposal-reapproved", now=NOW + timedelta(minutes=7)
        )
        self.assertEqual(
            [
                (item["notification_kind"], item["event_revision"])
                for item in prepared["notifications"]
            ],
            [("proposal", 3)],
        )

    def test_approved_finding_is_materialized_in_exactly_one_typed_owner(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        finding = self.store.record_question(run["run_id"], self.payload(), now=NOW)
        self.store.review(
            finding["finding_id"],
            "approved",
            "Keep the limitation attached.",
            now=NOW + timedelta(minutes=1),
        )
        self.store.adopt(
            finding["finding_id"],
            owner_class="structured_knowledge",
            owner_ref="expertise_entries",
            record={
                "topic": "progression",
                "claim": "A bounded expertise claim.",
                "mechanism": None,
                "practical_application": "Use it only in the supported context.",
                "scope_conditions": "Trained adults.",
                "limitations": "Not individualized medical guidance.",
                "evidence_status": "supported",
                "content_use": "Educational content may use the bounded claim.",
            },
            now=NOW + timedelta(minutes=2),
        )

        with sqlite3.connect(self.db_path) as connection:
            owner = connection.execute(
                "SELECT owner_ref FROM research_adoptions WHERE finding_id = ?",
                (finding["finding_id"],),
            ).fetchone()[0]
            claim = connection.execute(
                "SELECT claim FROM expertise_entries WHERE finding_id = ?",
                (finding["finding_id"],),
            ).fetchone()[0]
        self.assertEqual(owner, "expertise_entries")
        self.assertEqual(claim, "A bounded expertise claim.")

        prepared = self.store.prepare_notifications(
            "cron-run-001", now=NOW + timedelta(minutes=3)
        )
        self.assertEqual(
            [item["finding_id"] for item in prepared["notifications"]],
            [finding["finding_id"]],
        )
        self.assertEqual(
            self.store.open_notification_attempts()[0]["attempt_token"],
            "cron-run-001",
        )
        with self.assertRaisesRegex(ValueError, "earlier notification attempt"):
            self.store.prepare_notifications(
                "cron-run-002", now=NOW + timedelta(minutes=4)
            )
        failed = self.store.resolve_notification_attempt(
            "cron-run-001",
            "failed",
            error_text="Telegram delivery failed.",
            now=NOW + timedelta(minutes=4),
        )
        self.assertEqual(failed["notification_count"], 1)

        retried = self.store.prepare_notifications(
            "cron-run-002", now=NOW + timedelta(minutes=5)
        )
        self.assertEqual(retried["notifications"][0]["attempt_count"], 2)
        delivered = self.store.resolve_notification_attempt(
            "cron-run-002",
            "delivered",
            transport_ref="cron:e5f2f583a0cb:2026-07-28T13:00:00Z",
            now=NOW + timedelta(minutes=6),
        )
        self.assertEqual(delivered["notification_count"], 1)
        self.assertEqual(self.store.open_notification_attempts(), [])

        with self.assertRaisesRegex(ValueError, "already adopted"):
            self.store.adopt(
                finding["finding_id"],
                owner_class="structured_knowledge",
                owner_ref="marketing_method_entries",
                record={
                    "method": "Method",
                    "mechanism": "Mechanism",
                    "application_context": "Context",
                    "prerequisites": "Prerequisite",
                    "limitations": "Limitation",
                    "evidence_status": "preliminary",
                    "proposed_test": "Test it.",
                },
                now=NOW + timedelta(minutes=3),
            )

    def test_user_withdrawal_cancels_an_undelivered_adoption_notification(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        finding = self.store.record_question(run["run_id"], self.payload(), now=NOW)
        self.store.review(
            finding["finding_id"],
            "approved",
            "The bounded claim is supported for autonomous adoption.",
            now=NOW + timedelta(minutes=1),
        )
        self.store.adopt(
            finding["finding_id"],
            owner_class="structured_knowledge",
            owner_ref="expertise_entries",
            record={
                "topic": "progression",
                "claim": "A bounded expertise claim.",
                "mechanism": None,
                "practical_application": "Use it only in the supported context.",
                "scope_conditions": "Trained adults.",
                "limitations": "Not individualized medical guidance.",
                "evidence_status": "supported",
                "content_use": "Educational content may use the bounded claim.",
            },
            now=NOW + timedelta(minutes=2),
        )

        with self.assertRaisesRegex(ValueError, "user withdrawal requires actor evidence"):
            self.store.withdraw(
                finding["finding_id"],
                "User says the finding is not appropriate.",
                actor_kind="user",
                now=NOW + timedelta(minutes=3),
            )

        dispatched = self.store.prepare_notifications(
            "withdrawal-open", now=NOW + timedelta(minutes=2, seconds=30)
        )
        self.assertEqual(
            [item["finding_id"] for item in dispatched["notifications"]],
            [finding["finding_id"]],
        )

        result = self.store.withdraw(
            finding["finding_id"],
            "User says the finding is not appropriate.",
            actor_kind="user",
            actor_evidence="telegram:chat-hash:message-456",
            now=NOW + timedelta(minutes=3),
        )

        self.assertEqual(result["status"], "withdrawn")
        with sqlite3.connect(self.db_path) as connection:
            accepted = connection.execute(
                "SELECT COUNT(*) FROM expertise_entries WHERE finding_id = ?",
                (finding["finding_id"],),
            ).fetchone()[0]
            audit = connection.execute(
                """
                SELECT reason, actor_kind, actor_evidence
                FROM research_withdrawals
                WHERE finding_id = ?
                """,
                (finding["finding_id"],),
            ).fetchone()
        self.assertEqual(accepted, 0)
        self.assertEqual(
            audit,
            (
                "User says the finding is not appropriate.",
                "user",
                "telegram:chat-hash:message-456",
            ),
        )

        prepared = self.store.prepare_notifications(
            "withdrawn-finding", now=NOW + timedelta(minutes=4)
        )
        self.assertEqual(prepared["notifications"], [])
        with sqlite3.connect(self.db_path) as connection:
            notification = connection.execute(
                """
                SELECT status, cancellation_reason
                FROM research_notifications
                WHERE finding_id = ? AND notification_kind = 'adopted'
                """,
                (finding["finding_id"],),
            ).fetchone()
        self.assertEqual(
            notification,
            ("cancelled", "finding withdrawn before delivery"),
        )
        resolved = self.store.resolve_notification_attempt(
            "withdrawal-open",
            "delivered",
            transport_ref="cron:stale-adoption",
            now=NOW + timedelta(minutes=5),
        )
        self.assertEqual(resolved["status"], "cancelled")
        self.assertEqual(resolved["notification_count"], 0)
        self.assertEqual(resolved["cancelled_count"], 1)

    def test_agent_review_requires_rationale(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        finding = self.store.record_question(run["run_id"], self.payload(), now=NOW)

        with self.assertRaisesRegex(ValueError, "review rationale is required"):
            self.store.review(
                finding["finding_id"],
                "approved",
                "",
                now=NOW + timedelta(minutes=1),
            )

    def test_adoption_must_match_the_findings_proposed_owner(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        finding = self.store.record_question(run["run_id"], self.payload(), now=NOW)
        self.store.review(
            finding["finding_id"],
            "approved",
            "Approve only the proposed expertise owner.",
            now=NOW + timedelta(minutes=1),
        )

        with self.assertRaisesRegex(ValueError, "adoption owner does not match"):
            self.store.adopt(
                finding["finding_id"],
                owner_class="structured_knowledge",
                owner_ref="marketing_method_entries",
                record={
                    "method": "Method",
                    "mechanism": "Mechanism",
                    "application_context": "Context",
                    "prerequisites": "Prerequisite",
                    "limitations": "Limitation",
                    "evidence_status": "preliminary",
                    "proposed_test": "Test it.",
                },
                now=NOW + timedelta(minutes=2),
            )

    def test_tracked_owner_receipt_is_computed_from_an_existing_tracked_file(self):
        payload = self.payload()
        payload["finding"]["proposed_owner"] = "context/expertise.md"
        run = self.store.start_run("manual", "Verify tracked owner receipt.", now=NOW)
        finding = self.store.record_question(run["run_id"], payload, now=NOW)
        self.store.review(
            finding["finding_id"],
            "approved",
            "Autonomous review found bounded support.",
            now=NOW + timedelta(minutes=1),
        )

        with self.assertRaisesRegex(ValueError, "owner checksum does not match"):
            self.store.adopt(
                finding["finding_id"],
                owner_class="tracked_owner",
                owner_ref="context/expertise.md",
                record={},
                owner_sha256="0" * 64,
                now=NOW + timedelta(minutes=2),
            )

        self.store.adopt(
            finding["finding_id"],
            owner_class="tracked_owner",
            owner_ref="context/expertise.md",
            record={},
            now=NOW + timedelta(minutes=2),
        )
        expected = hashlib.sha256(
            (REPO_ROOT / "context/expertise.md").read_bytes()
        ).hexdigest()
        with sqlite3.connect(self.db_path) as connection:
            stored = connection.execute(
                "SELECT owner_sha256 FROM research_adoptions WHERE finding_id = ?",
                (finding["finding_id"],),
            ).fetchone()[0]
        self.assertEqual(stored, expected)

    def test_tracked_owner_must_change_before_withdrawal(self):
        workspace = Path(self.temp_dir.name) / "tracked-workspace"
        workspace.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)
        owner = workspace / "policy.md"
        owner.write_text("accepted\n", encoding="utf-8")
        subprocess.run(["git", "add", "--", "policy.md"], cwd=workspace, check=True)
        store = ResearchStore(
            Path(self.temp_dir.name) / "tracked-withdrawal.sqlite",
            workspace_root=workspace,
        )
        payload = self.payload()
        payload["finding"]["proposed_owner"] = "policy.md"
        run = store.start_run("manual", "Verify tracked withdrawal.", now=NOW)
        finding = store.record_question(run["run_id"], payload, now=NOW)
        store.review(
            finding["finding_id"],
            "approved",
            "Autonomous review found bounded support.",
            now=NOW + timedelta(minutes=1),
        )
        store.adopt(
            finding["finding_id"],
            owner_class="tracked_owner",
            owner_ref="policy.md",
            record={},
            now=NOW + timedelta(minutes=2),
        )

        with self.assertRaisesRegex(ValueError, "must be corrected"):
            store.withdraw(
                finding["finding_id"],
                "User rejected the finding.",
                actor_kind="user",
                actor_evidence="telegram:chat-hash:message-789",
                now=NOW + timedelta(minutes=3),
            )

        owner.write_text("corrected\n", encoding="utf-8")
        result = store.withdraw(
            finding["finding_id"],
            "User rejected the finding.",
            actor_kind="user",
            actor_evidence="telegram:chat-hash:message-789",
            now=NOW + timedelta(minutes=4),
        )

        self.assertEqual(result["status"], "withdrawn")

    def test_raw_reference_receipt_verifies_each_asset(self):
        workspace = Path(self.temp_dir.name) / "workspace"
        asset = workspace / "renderer/slideshow/formats/test/references/post-1/1.png"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"reference-bytes")
        store = ResearchStore(
            Path(self.temp_dir.name) / "raw-reference.sqlite",
            workspace_root=workspace,
        )
        payload = self.payload()
        payload["finding"]["proposed_owner"] = "format_reference_entries"
        run = store.start_run("manual", "Verify raw reference receipt.", now=NOW)
        finding = store.record_question(run["run_id"], payload, now=NOW)
        store.review(
            finding["finding_id"],
            "approved",
            "Autonomous review found bounded support.",
            now=NOW + timedelta(minutes=1),
        )
        with sqlite3.connect(store.db_path) as connection:
            source_id = connection.execute("SELECT id FROM research_sources").fetchone()[0]
        record = {
            "medium": "slideshow",
            "format_id": "test",
            "post_id": "post-1",
            "source_id": source_id,
            "selection_reason": "Bounded execution evidence.",
            "assets": [
                {
                    "position": 1,
                    "local_path": str(asset.relative_to(workspace)),
                    "media_sha256": "0" * 64,
                    "media_type": "image",
                    "width": 1,
                    "height": 1,
                }
            ],
        }

        record["format_id"] = "../test"
        with self.assertRaisesRegex(ValueError, "lowercase safe identifier"):
            store.adopt(
                finding["finding_id"],
                owner_class="raw_reference",
                owner_ref="format_reference_entries",
                record=record,
                now=NOW + timedelta(minutes=2),
            )
        record["format_id"] = "test"

        outside_asset = workspace / "elsewhere.bin"
        outside_asset.write_bytes(b"outside-reference-owner")
        asset.unlink()
        asset.symlink_to(outside_asset)
        record["assets"][0]["media_sha256"] = hashlib.sha256(
            outside_asset.read_bytes()
        ).hexdigest()
        with self.assertRaisesRegex(ValueError, "asset cannot be a symlink"):
            store.adopt(
                finding["finding_id"],
                owner_class="raw_reference",
                owner_ref="format_reference_entries",
                record=record,
                now=NOW + timedelta(minutes=2),
            )
        asset.unlink()
        asset.write_bytes(b"reference-bytes")
        record["assets"][0]["media_sha256"] = "0" * 64

        with self.assertRaisesRegex(ValueError, "raw reference asset checksum does not match"):
            store.adopt(
                finding["finding_id"],
                owner_class="raw_reference",
                owner_ref="format_reference_entries",
                record=record,
                now=NOW + timedelta(minutes=2),
            )

        record["assets"][0]["media_sha256"] = hashlib.sha256(asset.read_bytes()).hexdigest()
        store.adopt(
            finding["finding_id"],
            owner_class="raw_reference",
            owner_ref="format_reference_entries",
            record=record,
            now=NOW + timedelta(minutes=2),
        )
        with sqlite3.connect(store.db_path) as connection:
            receipt = connection.execute(
                "SELECT owner_sha256 FROM research_adoptions WHERE finding_id = ?",
                (finding["finding_id"],),
            ).fetchone()[0]
        self.assertEqual(len(receipt), 64)


    def test_rejected_finding_cannot_be_adopted(self):
        run = self.store.start_run("manual", "Pilot research.", now=NOW)
        finding = self.store.record_question(run["run_id"], self.payload(), now=NOW)
        self.store.review(
            finding["finding_id"],
            "rejected",
            "The source does not support the conclusion.",
            now=NOW + timedelta(minutes=1),
        )

        with self.assertRaisesRegex(sqlite3.IntegrityError, "approved review required"):
            self.store.adopt(
                finding["finding_id"],
                owner_class="structured_knowledge",
                owner_ref="expertise_entries",
                record={
                    "topic": "progression",
                    "claim": "Claim",
                    "mechanism": None,
                    "practical_application": "Application",
                    "scope_conditions": "Scope",
                    "limitations": "Limit",
                    "evidence_status": "preliminary",
                    "content_use": "Do not use.",
                },
                now=NOW + timedelta(minutes=2),
            )

    def test_admission_does_not_expose_a_runtime_authorization_mode(self):
        with sqlite3.connect(self.db_path) as connection:
            settings_table = connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'research_settings'"
            ).fetchone()

        self.assertIsNone(settings_table)
        self.assertFalse(hasattr(self.store, "set_admission_mode"))

    def test_records_user_quality_feedback_without_rewriting_agent_review(self):
        run = self.store.start_run("manual", "Collect quality feedback.", now=NOW)
        finding = self.store.record_question(run["run_id"], self.payload(), now=NOW)

        feedback = self.store.record_quality_feedback(
            run_id=run["run_id"],
            finding_id=finding["finding_id"],
            verdict="weak_evidence",
            rationale="The source is relevant, but one article is not enough.",
            actor_evidence="telegram:chat-hash:message-900",
            now=NOW + timedelta(minutes=1),
        )

        self.assertEqual(feedback["verdict"], "weak_evidence")
        with sqlite3.connect(self.db_path) as connection:
            stored = connection.execute(
                """
                SELECT run_id, finding_id, verdict, rationale, actor_evidence
                FROM research_quality_feedback
                """
            ).fetchone()
            reviews = connection.execute(
                "SELECT COUNT(*) FROM research_reviews WHERE finding_id = ?",
                (finding["finding_id"],),
            ).fetchone()[0]
        self.assertEqual(
            stored,
            (
                run["run_id"],
                finding["finding_id"],
                "weak_evidence",
                "The source is relevant, but one article is not enough.",
                "telegram:chat-hash:message-900",
            ),
        )
        self.assertEqual(reviews, 0)

    def test_quality_feedback_finding_must_belong_to_the_named_run(self):
        first_run = self.store.start_run("manual", "First run.", now=NOW)
        finding = self.store.record_question(first_run["run_id"], self.payload(), now=NOW)
        self.store.finish_run(
            first_run["run_id"], "completed", now=NOW + timedelta(minutes=1)
        )
        second_run = self.store.start_run(
            "manual", "Second run.", now=NOW + timedelta(minutes=2)
        )

        with self.assertRaisesRegex(ValueError, "does not belong"):
            self.store.record_quality_feedback(
                run_id=second_run["run_id"],
                finding_id=finding["finding_id"],
                verdict="irrelevant",
                rationale="This was not useful for the current decision.",
                actor_evidence="telegram:chat-hash:message-901",
                now=NOW + timedelta(minutes=3),
            )

    def test_canonicalize_url_removes_fragments_and_tracking_parameters(self):
        normalized = canonicalize_url(
            "HTTPS://Example.COM:443/path/?z=2&utm_campaign=x&a=1#fragment"
        )
        self.assertEqual(normalized, "https://example.com/path/?a=1&z=2")


if __name__ == "__main__":
    unittest.main()
