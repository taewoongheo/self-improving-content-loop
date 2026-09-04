#!/usr/bin/env python3

import argparse
import hashlib
import json
import re
import sqlite3
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB_PATH = REPO_ROOT / "db" / "research.sqlite"
DEFAULT_SCHEMA_PATH = REPO_ROOT / "db" / "research-schema.sql"
SCHEMA_VERSION = 8
TRACKING_QUERY_KEYS = {
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "ref",
    "ref_src",
}


def utc_now():
    return datetime.now(timezone.utc)


def format_timestamp(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def canonicalize_url(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("source URL must be a non-empty string")
    parsed = urlsplit(value.strip())
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("source URL must use http or https")
    if parsed.username or parsed.password:
        raise ValueError("source URL must not contain credentials")

    hostname = parsed.hostname.lower()
    port = parsed.port
    if port and not ((scheme == "https" and port == 443) or (scheme == "http" and port == 80)):
        netloc = f"{hostname}:{port}"
    else:
        netloc = hostname

    query_items = []
    for key, item_value in parse_qsl(parsed.query, keep_blank_values=True):
        lowered = key.lower()
        if lowered.startswith("utm_") or lowered in TRACKING_QUERY_KEYS:
            continue
        query_items.append((key, item_value))
    query_items.sort()

    path = parsed.path or "/"
    return urlunsplit((scheme, netloc, path, urlencode(query_items, doseq=True), ""))


def semantic_fingerprint(values):
    normalized = {
        key: " ".join(value.lower().split()) if isinstance(value, str) else value
        for key, value in values.items()
    }
    canonical = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def new_id(prefix):
    return f"{prefix}-{uuid.uuid4().hex[:16]}"


def require_text(mapping, key):
    value = mapping.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value.strip()


def require_safe_identifier(mapping, key):
    value = require_text(mapping, key)
    if (
        len(value) > 100
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", value) is None
    ):
        raise ValueError(f"{key} must be a safe identifier")
    return value


class ResearchStore:
    def __init__(
        self,
        db_path=DEFAULT_DB_PATH,
        schema_path=DEFAULT_SCHEMA_PATH,
        workspace_root=REPO_ROOT,
    ):
        self.db_path = Path(db_path)
        self.schema_path = Path(schema_path)
        self.workspace_root = Path(workspace_root).resolve()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def _connect(self):
        connection = sqlite3.connect(self.db_path)
        connection.execute("PRAGMA foreign_keys = ON")
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self):
        with self._connect() as connection:
            tables = connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' LIMIT 1"
            ).fetchone()
            if tables is None:
                connection.executescript(self.schema_path.read_text(encoding="utf-8"))
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version == 5:
                self._migrate_v5_to_v6(connection)
                version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version == 6:
                self._migrate_v6_to_v7(connection)
                version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version == 7:
                self._migrate_v7_to_v8(connection)
                version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version != SCHEMA_VERSION:
                raise RuntimeError(f"unsupported research schema version: {version}")
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise RuntimeError(f"research database integrity check failed: {integrity}")

    @staticmethod
    def _migrate_v5_to_v6(connection):
        connection.executescript(
            """
            BEGIN IMMEDIATE;
            CREATE TABLE research_quality_feedback (
                id INTEGER PRIMARY KEY,
                run_id TEXT NOT NULL REFERENCES research_runs(id) ON DELETE RESTRICT,
                finding_id TEXT REFERENCES research_findings(id) ON DELETE RESTRICT,
                verdict TEXT NOT NULL CHECK (verdict IN (
                    'useful', 'weak_evidence', 'irrelevant', 'overstated', 'correction'
                )),
                rationale TEXT NOT NULL CHECK (length(trim(rationale)) BETWEEN 1 AND 5000),
                actor_evidence TEXT NOT NULL CHECK (
                    length(trim(actor_evidence)) BETWEEN 1 AND 1000
                ),
                created_at TEXT NOT NULL CHECK (datetime(created_at) IS NOT NULL)
            );
            CREATE TRIGGER research_quality_feedback_finding_run_match
            BEFORE INSERT ON research_quality_feedback
            WHEN NEW.finding_id IS NOT NULL
             AND NOT EXISTS (
                 SELECT 1
                 FROM research_findings AS finding
                 JOIN research_questions AS question ON question.id = finding.question_id
                 WHERE finding.id = NEW.finding_id
                   AND question.run_id = NEW.run_id
             )
            BEGIN
                SELECT RAISE(ABORT, 'quality feedback finding does not belong to run');
            END;
            CREATE TRIGGER research_quality_feedback_immutable_update
            BEFORE UPDATE ON research_quality_feedback
            BEGIN
                SELECT RAISE(ABORT, 'research quality feedback is immutable');
            END;
            CREATE TRIGGER research_quality_feedback_immutable_delete
            BEFORE DELETE ON research_quality_feedback
            BEGIN
                SELECT RAISE(ABORT, 'research quality feedback is immutable');
            END;
            PRAGMA user_version = 6;
            COMMIT;
            """
        )

    @staticmethod
    def _migrate_v6_to_v7(connection):
        connection.executescript(
            """
            BEGIN IMMEDIATE;
            ALTER TABLE research_runs ADD COLUMN event_context_json TEXT NOT NULL DEFAULT '{}'
                CHECK (json_valid(event_context_json) AND json_type(event_context_json) = 'object');
            PRAGMA user_version = 7;
            COMMIT;
            """
        )

    @staticmethod
    def _migrate_v7_to_v8(connection):
        connection.executescript(
            """
            BEGIN IMMEDIATE;
            CREATE TABLE research_duplicate_question_sources (
                question_id TEXT NOT NULL
                    REFERENCES research_questions(id) ON DELETE RESTRICT,
                source_id TEXT NOT NULL
                    REFERENCES research_sources(id) ON DELETE RESTRICT,
                relation TEXT NOT NULL
                    CHECK (relation IN ('supports', 'contradicts', 'context')),
                evidence_note TEXT NOT NULL
                    CHECK (length(trim(evidence_note)) BETWEEN 1 AND 2000),
                PRIMARY KEY (question_id, source_id)
            );
            CREATE TRIGGER research_duplicate_question_sources_status_insert
            BEFORE INSERT ON research_duplicate_question_sources
            WHEN NOT EXISTS (
                SELECT 1
                FROM research_questions
                WHERE id = NEW.question_id AND status = 'duplicate'
            )
            BEGIN
                SELECT RAISE(ABORT, 'question source requires duplicate question');
            END;
            CREATE TRIGGER research_duplicate_question_sources_immutable_update
            BEFORE UPDATE ON research_duplicate_question_sources
            BEGIN
                SELECT RAISE(ABORT, 'duplicate question sources are immutable');
            END;
            CREATE TRIGGER research_duplicate_question_sources_immutable_delete
            BEFORE DELETE ON research_duplicate_question_sources
            BEGIN
                SELECT RAISE(ABORT, 'duplicate question sources are immutable');
            END;
            PRAGMA user_version = 8;
            COMMIT;
            """
        )

    def start_run(
        self, trigger_kind, objective, now=None, lease_minutes=55, event_context=None
    ):
        if now is None:
            now = utc_now()
        if event_context is None:
            event_context = {}
        if not isinstance(event_context, dict):
            raise ValueError("event_context must be a JSON object")
        if trigger_kind == "result_review":
            checkpoints = event_context.get("checkpoints")
            if not isinstance(checkpoints, list) or not checkpoints:
                raise ValueError("result_review requires at least one checkpoint")
            for checkpoint in checkpoints:
                if (
                    not isinstance(checkpoint, dict)
                    or type(checkpoint.get("result_id")) is not int
                    or checkpoint.get("result_id", 0) <= 0
                    or not isinstance(checkpoint.get("content_id"), str)
                    or re.fullmatch(
                        r"[A-Za-z0-9][A-Za-z0-9_-]*",
                        checkpoint.get("content_id", ""),
                    )
                    is None
                    or type(checkpoint.get("target_hours")) is not int
                    or checkpoint.get("target_hours") not in {24, 48, 72}
                ):
                    raise ValueError("result_review checkpoint is invalid")
        event_context_json = json.dumps(
            event_context, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        )
        if lease_minutes <= 0 or lease_minutes > 59:
            raise ValueError("lease_minutes must be between 1 and 59")
        started_at = format_timestamp(now)
        lease_expires_at = format_timestamp(now + timedelta(minutes=lease_minutes))

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            expired = connection.execute(
                """
                SELECT id
                FROM research_runs
                WHERE status = 'running'
                  AND datetime(lease_expires_at) <= datetime(?)
                """,
                (started_at,),
            ).fetchall()
            for row in expired:
                connection.execute(
                    """
                    UPDATE research_questions
                    SET status = 'failed',
                        outcome_reason = 'run lease expired before question completion'
                    WHERE run_id = ? AND status = 'selected'
                    """,
                    (row["id"],),
                )
                connection.execute(
                    """
                    UPDATE research_runs
                    SET status = 'failed', lease_expires_at = NULL, finished_at = ?,
                        error_text = 'singleton lease expired before completion'
                    WHERE id = ?
                    """,
                    (started_at, row["id"]),
                )

            active = connection.execute(
                "SELECT id FROM research_runs WHERE status = 'running'"
            ).fetchone()
            run_id = new_id("RR")
            if active is not None:
                reason = f"active research run {active['id']} still holds the singleton lease"
                connection.execute(
                    """
                    INSERT INTO research_runs (
                        id, trigger_kind, objective, event_context_json, status, started_at,
                        lease_expires_at, finished_at, skip_reason
                    ) VALUES (?, ?, ?, ?, 'skipped', ?, NULL, ?, ?)
                    """,
                    (
                        run_id, trigger_kind, objective, event_context_json,
                        started_at, started_at, reason,
                    ),
                )
                return {
                    "status": "skipped",
                    "run_id": run_id,
                    "active_run_id": active["id"],
                    "reason": reason,
                }

            connection.execute(
                """
                INSERT INTO research_runs (
                    id, trigger_kind, objective, event_context_json, status,
                    started_at, lease_expires_at
                ) VALUES (?, ?, ?, ?, 'running', ?, ?)
                """,
                (
                    run_id, trigger_kind, objective, event_context_json,
                    started_at, lease_expires_at,
                ),
            )
            return {
                "status": "started",
                "run_id": run_id,
                "lease_expires_at": lease_expires_at,
            }

    def _upsert_source(self, connection, source, accessed_at):
        original_url = require_text(source, "url")
        canonical_url = canonicalize_url(original_url)
        source_id = "RS-" + hashlib.sha256(canonical_url.encode("utf-8")).hexdigest()[:16]
        source_kind = require_text(source, "source_kind")
        title = source.get("title")
        publisher = source.get("publisher")
        published_at = source.get("published_at")

        connection.execute(
            """
            INSERT INTO research_sources (
                id, canonical_url, source_kind, title, publisher, published_at,
                first_seen_at, last_accessed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(canonical_url) DO UPDATE SET
                last_accessed_at = excluded.last_accessed_at,
                title = COALESCE(research_sources.title, excluded.title),
                publisher = COALESCE(research_sources.publisher, excluded.publisher),
                published_at = COALESCE(research_sources.published_at, excluded.published_at)
            """,
            (
                source_id,
                canonical_url,
                source_kind,
                title,
                publisher,
                published_at,
                accessed_at,
                accessed_at,
            ),
        )
        row = connection.execute(
            "SELECT id FROM research_sources WHERE canonical_url = ?", (canonical_url,)
        ).fetchone()
        source_id = row["id"]
        connection.execute(
            """
            INSERT INTO research_source_captures (
                id, source_id, observed_at, original_url, resolved_url,
                retrieval_method, http_status, published_at, content_sha256,
                capture_error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id("RC"),
                source_id,
                accessed_at,
                original_url,
                source.get("resolved_url") or canonical_url,
                source.get("retrieval_method") or source_kind,
                source.get("http_status"),
                published_at,
                source.get("content_sha256"),
                source.get("capture_error"),
            ),
        )
        return source_id

    def select_question(self, run_id, payload, now=None):
        if now is None:
            now = utc_now()
        if not isinstance(payload, dict):
            raise ValueError("question payload must be an object")
        position = payload.get("position")
        if type(position) is not int or position not in {1, 2, 3}:
            raise ValueError("position must be 1, 2, or 3")
        question = require_text(payload, "question")
        why_now = require_text(payload, "why_now")
        expected_decision = require_text(payload, "expected_decision")
        selected_at = format_timestamp(now)
        question_id = new_id("RQ")

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            run = connection.execute(
                "SELECT status, lease_expires_at FROM research_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if run is None or run["status"] != "running":
                raise ValueError(f"research run is not active: {run_id}")
            if run["lease_expires_at"] <= selected_at:
                raise ValueError(f"research run lease expired: {run_id}")
            connection.execute(
                """
                INSERT INTO research_questions (
                    id, run_id, position, question, why_now,
                    expected_decision, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'selected')
                """,
                (
                    question_id,
                    run_id,
                    position,
                    question,
                    why_now,
                    expected_decision,
                ),
            )
        return {"status": "selected", "question_id": question_id}

    def record_question(self, run_id, payload, now=None):
        if now is None:
            now = utc_now()
        if not isinstance(payload, dict):
            raise ValueError("question payload must be an object")
        position = payload.get("position")
        if type(position) is not int or position not in {1, 2, 3}:
            raise ValueError("position must be 1, 2, or 3")
        question = require_text(payload, "question")
        why_now = require_text(payload, "why_now")
        expected_decision = require_text(payload, "expected_decision")
        finding = payload.get("finding")
        if finding is not None and not isinstance(finding, dict):
            raise ValueError("finding must be an object or null")
        outcome = payload.get("outcome", "no_finding" if finding is None else "completed")
        terminal_outcomes = {"no_finding", "outside_scope", "failed"}
        if finding is None and outcome not in terminal_outcomes:
            raise ValueError(
                "a question without a finding must be no_finding, outside_scope, or failed"
            )
        if finding is not None and outcome != "completed":
            raise ValueError("a question with a finding must be completed")
        outcome_reason = payload.get("outcome_reason")
        if outcome in {"failed", "outside_scope"}:
            outcome_reason = require_text(payload, "outcome_reason")
        elif outcome_reason is not None:
            raise ValueError(
                "outcome_reason is allowed only for failed or outside_scope questions"
            )
        recorded_at = format_timestamp(now)
        question_id = new_id("RQ")

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            run = connection.execute(
                "SELECT status, lease_expires_at FROM research_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if run is None:
                raise ValueError(f"unknown research run: {run_id}")
            if run["status"] != "running":
                raise ValueError(f"research run is not active: {run_id}")
            if run["lease_expires_at"] <= recorded_at:
                raise ValueError(f"research run lease expired: {run_id}")

            selected = connection.execute(
                """
                SELECT id, question, why_now, expected_decision, status
                FROM research_questions
                WHERE run_id = ? AND position = ?
                """,
                (run_id, position),
            ).fetchone()
            if selected is not None:
                if selected["status"] != "selected":
                    raise ValueError("research question is already terminal")
                if (
                    selected["question"] != question
                    or selected["why_now"] != why_now
                    or selected["expected_decision"] != expected_decision
                ):
                    raise ValueError("recorded question does not match selected question")
                question_id = selected["id"]

            if finding is None:
                if selected is None:
                    connection.execute(
                        """
                        INSERT INTO research_questions (
                            id, run_id, position, question, why_now,
                            expected_decision, status, outcome_reason
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            question_id,
                            run_id,
                            position,
                            question,
                            why_now,
                            expected_decision,
                            outcome,
                            outcome_reason,
                        ),
                    )
                else:
                    connection.execute(
                        "UPDATE research_questions SET status = ?, outcome_reason = ? WHERE id = ?",
                        (outcome, outcome_reason, question_id),
                    )
                return {"status": outcome, "question_id": question_id}

            finding_text = require_text(finding, "text")
            limitations = require_text(finding, "limitations")
            proposed_action = require_text(finding, "proposed_action")
            routing_kind = require_text(finding, "routing_kind")
            proposed_owner = finding.get("proposed_owner")
            if routing_kind not in {"existing_owner", "new_owner_proposal"}:
                raise ValueError("invalid finding route")
            if not isinstance(proposed_owner, str) or not proposed_owner.strip():
                raise ValueError("proposed_owner must be a non-empty string")
            proposed_owner = proposed_owner.strip()
            fingerprint = semantic_fingerprint(
                {
                    "finding_text": finding_text,
                    "limitations": limitations,
                    "proposed_action": proposed_action,
                    "routing_kind": routing_kind,
                    "proposed_owner": proposed_owner,
                }
            )
            existing = connection.execute(
                "SELECT id FROM research_findings WHERE finding_fingerprint = ?",
                (fingerprint,),
            ).fetchone()
            sources = finding.get("sources")
            if not isinstance(sources, list) or not sources:
                raise ValueError("a finding requires at least one source")

            if existing is not None:
                if selected is None:
                    connection.execute(
                        """
                        INSERT INTO research_questions (
                            id, run_id, position, question, why_now, expected_decision,
                            status, duplicate_of_finding_id
                        ) VALUES (?, ?, ?, ?, ?, ?, 'duplicate', ?)
                        """,
                        (
                            question_id,
                            run_id,
                            position,
                            question,
                            why_now,
                            expected_decision,
                            existing["id"],
                        ),
                    )
                else:
                    connection.execute(
                        """
                        UPDATE research_questions
                        SET status = 'duplicate', duplicate_of_finding_id = ?
                        WHERE id = ?
                        """,
                        (existing["id"], question_id),
                    )
                reviewed = connection.execute(
                    "SELECT 1 FROM research_reviews WHERE finding_id = ? LIMIT 1",
                    (existing["id"],),
                ).fetchone()
                for source in sources:
                    source_id = self._upsert_source(connection, source, recorded_at)
                    relation = require_text(source, "relation")
                    evidence_note = require_text(source, "evidence_note")
                    connection.execute(
                        """
                        INSERT INTO research_duplicate_question_sources (
                            question_id, source_id, relation, evidence_note
                        ) VALUES (?, ?, ?, ?)
                        ON CONFLICT(question_id, source_id) DO NOTHING
                        """,
                        (question_id, source_id, relation, evidence_note),
                    )
                    if reviewed is not None:
                        continue
                    connection.execute(
                        """
                        INSERT INTO research_finding_sources (
                            finding_id, source_id, relation, evidence_note
                        ) VALUES (?, ?, ?, ?)
                        ON CONFLICT(finding_id, source_id) DO NOTHING
                        """,
                        (
                            existing["id"],
                            source_id,
                            relation,
                            evidence_note,
                        ),
                    )
                return {
                    "status": "duplicate",
                    "question_id": question_id,
                    "duplicate_of_finding_id": existing["id"],
                }

            finding_id = new_id("RF")
            if selected is None:
                connection.execute(
                    """
                    INSERT INTO research_questions (
                        id, run_id, position, question, why_now,
                        expected_decision, status
                    ) VALUES (?, ?, ?, ?, ?, ?, 'completed')
                    """,
                    (question_id, run_id, position, question, why_now, expected_decision),
                )
            else:
                connection.execute(
                    "UPDATE research_questions SET status = 'completed' WHERE id = ?",
                    (question_id,),
                )
            connection.execute(
                """
                INSERT INTO research_findings (
                    id, question_id, finding_text, limitations, proposed_action,
                    routing_kind, proposed_owner, finding_fingerprint, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    finding_id,
                    question_id,
                    finding_text,
                    limitations,
                    proposed_action,
                    routing_kind,
                    proposed_owner,
                    fingerprint,
                    recorded_at,
                ),
            )
            for source in sources:
                source_id = self._upsert_source(connection, source, recorded_at)
                connection.execute(
                    """
                    INSERT INTO research_finding_sources (
                        finding_id, source_id, relation, evidence_note
                    ) VALUES (?, ?, ?, ?)
                    """,
                    (
                        finding_id,
                        source_id,
                        require_text(source, "relation"),
                        require_text(source, "evidence_note"),
                    ),
                )
            return {
                "status": "completed",
                "question_id": question_id,
                "finding_id": finding_id,
            }

    def finish_run(self, run_id, status, now=None, error_text=None):
        if now is None:
            now = utc_now()
        if status not in {"completed", "failed"}:
            raise ValueError("finish status must be completed or failed")
        finished_at = format_timestamp(now)
        if status == "failed" and (not isinstance(error_text, str) or not error_text.strip()):
            raise ValueError("failed runs require error_text")
        if status == "completed" and error_text is not None:
            raise ValueError("completed runs cannot have error_text")

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            run = connection.execute(
                "SELECT status, lease_expires_at FROM research_runs WHERE id = ?",
                (run_id,),
            ).fetchone()
            if run is None or run["status"] != "running":
                raise ValueError(f"research run is not active: {run_id}")
            if run["lease_expires_at"] <= finished_at:
                raise ValueError(f"research run lease expired: {run_id}")
            if status == "completed":
                selected = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM research_questions
                    WHERE run_id = ? AND status = 'selected'
                    """,
                    (run_id,),
                ).fetchone()[0]
                if selected:
                    raise ValueError("completed run cannot retain selected questions")
            connection.execute(
                """
                UPDATE research_runs
                SET status = ?, lease_expires_at = NULL, finished_at = ?, error_text = ?
                WHERE id = ?
                """,
                (status, finished_at, error_text, run_id),
            )
        return {"status": status, "run_id": run_id}

    def pending_findings(self, run_id=None):
        with self._connect() as connection:
            run_filter = ""
            parameters = []
            if run_id is not None:
                run_filter = "AND question.run_id = ?"
                parameters.append(run_id)
            rows = connection.execute(
                f"""
                SELECT finding.*, question.question, question.why_now,
                       question.expected_decision
                FROM research_findings AS finding
                JOIN research_questions AS question ON question.id = finding.question_id
                WHERE (
                    NOT EXISTS (
                        SELECT 1 FROM research_reviews AS review
                        WHERE review.finding_id = finding.id
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM research_reviews AS review
                        WHERE review.finding_id = finding.id
                          AND review.revision = (
                              SELECT MAX(latest.revision)
                              FROM research_reviews AS latest
                              WHERE latest.finding_id = finding.id
                          )
                          AND (
                              review.decision = 'revision_requested'
                              OR (
                                  review.decision = 'approved'
                                  AND finding.routing_kind = 'existing_owner'
                                  AND NOT EXISTS (
                                      SELECT 1 FROM research_adoptions AS adoption
                                      WHERE adoption.finding_id = finding.id
                                  )
                              )
                          )
                    )
                )
                {run_filter}
                ORDER BY finding.created_at, finding.id
                """,
                parameters,
            ).fetchall()
            results = []
            for row in rows:
                item = dict(row)
                sources = connection.execute(
                    """
                    SELECT source.canonical_url, source.source_kind, source.title,
                           source.publisher, source.published_at,
                           link.relation, link.evidence_note
                    FROM research_finding_sources AS link
                    JOIN research_sources AS source ON source.id = link.source_id
                    WHERE link.finding_id = ?
                    ORDER BY source.canonical_url
                    """,
                    (row["id"],),
                ).fetchall()
                item["sources"] = [dict(source) for source in sources]
                results.append(item)
            return results

    def open_notification_attempts(self):
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT attempt_token, MIN(attempted_at) AS attempted_at,
                       COUNT(*) AS notification_count
                FROM research_notifications
                WHERE status = 'dispatching'
                GROUP BY attempt_token
                ORDER BY attempted_at, attempt_token
                """
            ).fetchall()
            return [dict(row) for row in rows]

    def prepare_notifications(self, attempt_token, now=None):
        if now is None:
            now = utc_now()
        if not isinstance(attempt_token, str) or not attempt_token.strip():
            raise ValueError("notification attempt token is required")
        attempt_token = attempt_token.strip()
        attempted_at = format_timestamp(now)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE research_notifications AS notification
                SET status = 'cancelled', cancelled_at = ?,
                    cancellation_reason = 'notification event is no longer current'
                WHERE notification.status IN ('pending', 'failed', 'dispatching')
                  AND (
                      (
                          notification.notification_kind = 'adopted'
                          AND EXISTS (
                              SELECT 1 FROM research_withdrawals AS withdrawal
                              WHERE withdrawal.finding_id = notification.finding_id
                          )
                      )
                      OR
                      (
                          notification.notification_kind = 'proposal'
                          AND NOT EXISTS (
                              SELECT 1
                              FROM research_findings AS finding
                              JOIN research_reviews AS review
                                ON review.finding_id = finding.id
                              WHERE finding.id = notification.finding_id
                                AND finding.routing_kind = 'new_owner_proposal'
                                AND review.revision = notification.event_revision
                                AND review.decision = 'approved'
                                AND review.revision = (
                                    SELECT MAX(latest.revision)
                                    FROM research_reviews AS latest
                                    WHERE latest.finding_id = finding.id
                                )
                          )
                      )
                  )
                """,
                (attempted_at,),
            )
            open_attempt = connection.execute(
                "SELECT 1 FROM research_notifications WHERE status = 'dispatching' LIMIT 1"
            ).fetchone()
            if open_attempt is not None:
                raise ValueError("an earlier notification attempt is still unresolved")
            connection.execute(
                """
                UPDATE research_notifications
                SET status = 'dispatching', attempt_token = ?, attempted_at = ?,
                    attempt_count = attempt_count + 1, last_error = NULL
                WHERE status IN ('pending', 'failed')
                """,
                (attempt_token, attempted_at),
            )
            rows = connection.execute(
                """
                SELECT notification.finding_id, notification.notification_kind,
                       notification.event_revision, notification.attempt_count,
                       finding.finding_text,
                       finding.limitations, finding.proposed_action,
                       finding.routing_kind, finding.proposed_owner,
                       adoption.owner_class, adoption.owner_ref
                FROM research_notifications AS notification
                JOIN research_findings AS finding ON finding.id = notification.finding_id
                LEFT JOIN research_adoptions AS adoption
                    ON adoption.finding_id = notification.finding_id
                WHERE notification.status = 'dispatching'
                  AND notification.attempt_token = ?
                ORDER BY notification.created_at, notification.finding_id
                """,
                (attempt_token,),
            ).fetchall()
            results = []
            for row in rows:
                item = dict(row)
                sources = connection.execute(
                    """
                    SELECT source.canonical_url, source.title, source.publisher,
                           link.relation, link.evidence_note
                    FROM research_finding_sources AS link
                    JOIN research_sources AS source ON source.id = link.source_id
                    WHERE link.finding_id = ?
                    ORDER BY source.canonical_url
                    """,
                    (row["finding_id"],),
                ).fetchall()
                item["sources"] = [dict(source) for source in sources]
                results.append(item)
            return {"attempt_token": attempt_token, "notifications": results}

    def resolve_notification_attempt(
        self,
        attempt_token,
        status,
        transport_ref=None,
        error_text=None,
        now=None,
    ):
        if now is None:
            now = utc_now()
        if not isinstance(attempt_token, str) or not attempt_token.strip():
            raise ValueError("notification attempt token is required")
        if status not in {"delivered", "failed"}:
            raise ValueError("notification resolution must be delivered or failed")
        if status == "delivered":
            if not isinstance(transport_ref, str) or not transport_ref.strip():
                raise ValueError("delivered notification requires transport_ref")
            if error_text is not None:
                raise ValueError("delivered notification cannot include error_text")
            transport_ref_value = transport_ref.strip()
            error_value = None
        else:
            if not isinstance(error_text, str) or not error_text.strip():
                raise ValueError("failed notification requires error_text")
            if transport_ref is not None:
                raise ValueError("failed notification cannot include transport_ref")
            transport_ref_value = None
            error_value = error_text.strip()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if status == "delivered":
                changed = connection.execute(
                    """
                    UPDATE research_notifications
                    SET status = 'delivered', delivered_at = ?, transport_ref = ?,
                        last_error = NULL
                    WHERE status = 'dispatching' AND attempt_token = ?
                    """,
                    (format_timestamp(now), transport_ref_value, attempt_token.strip()),
                ).rowcount
            else:
                changed = connection.execute(
                    """
                    UPDATE research_notifications
                    SET status = 'failed', delivered_at = NULL, transport_ref = NULL,
                        last_error = ?
                    WHERE status = 'dispatching' AND attempt_token = ?
                    """,
                    (error_value, attempt_token.strip()),
                ).rowcount
            cancelled = connection.execute(
                """
                SELECT COUNT(*)
                FROM research_notifications
                WHERE status = 'cancelled' AND attempt_token = ?
                """,
                (attempt_token.strip(),),
            ).fetchone()[0]
            if changed == 0 and cancelled == 0:
                raise ValueError("notification attempt is not open")
        return {
            "attempt_token": attempt_token.strip(),
            "status": status if changed else "cancelled",
            "notification_count": changed,
            "cancelled_count": cancelled,
        }

    def review(
        self,
        finding_id,
        decision,
        rationale,
        now=None,
    ):
        if now is None:
            now = utc_now()
        if decision not in {"approved", "rejected", "revision_requested"}:
            raise ValueError("invalid review decision")
        if not isinstance(rationale, str) or not rationale.strip():
            raise ValueError("review rationale is required")
        rationale = rationale.strip()
        with self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM research_findings WHERE id = ?", (finding_id,)
            ).fetchone()
            if exists is None:
                raise ValueError(f"unknown finding: {finding_id}")
            revision = connection.execute(
                "SELECT COALESCE(MAX(revision), 0) + 1 FROM research_reviews WHERE finding_id = ?",
                (finding_id,),
            ).fetchone()[0]
            connection.execute(
                """
                INSERT INTO research_reviews (
                    finding_id, revision, decision, rationale, reviewed_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    finding_id,
                    revision,
                    decision,
                    rationale,
                    format_timestamp(now),
                ),
            )
        return {"finding_id": finding_id, "revision": revision, "decision": decision}

    def record_quality_feedback(
        self,
        run_id,
        verdict,
        rationale,
        actor_evidence,
        finding_id=None,
        now=None,
    ):
        if now is None:
            now = utc_now()
        valid_verdicts = {
            "useful",
            "weak_evidence",
            "irrelevant",
            "overstated",
            "correction",
        }
        if verdict not in valid_verdicts:
            raise ValueError("invalid quality feedback verdict")
        rationale = require_text({"rationale": rationale}, "rationale")
        actor_evidence = require_text(
            {"actor_evidence": actor_evidence}, "actor_evidence"
        )
        with self._connect() as connection:
            if connection.execute(
                "SELECT 1 FROM research_runs WHERE id = ?", (run_id,)
            ).fetchone() is None:
                raise ValueError(f"unknown research run: {run_id}")
            if finding_id is not None:
                belongs = connection.execute(
                    """
                    SELECT 1
                    FROM research_findings AS finding
                    JOIN research_questions AS question ON question.id = finding.question_id
                    WHERE finding.id = ? AND question.run_id = ?
                    """,
                    (finding_id, run_id),
                ).fetchone()
                if belongs is None:
                    raise ValueError("quality feedback finding does not belong to run")
            cursor = connection.execute(
                """
                INSERT INTO research_quality_feedback (
                    run_id, finding_id, verdict, rationale, actor_evidence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    finding_id,
                    verdict,
                    rationale,
                    actor_evidence,
                    format_timestamp(now),
                ),
            )
        return {
            "feedback_id": cursor.lastrowid,
            "run_id": run_id,
            "finding_id": finding_id,
            "verdict": verdict,
        }

    def _tracked_owner_sha256(self, owner_ref):
        relative_path = Path(owner_ref)
        if relative_path.is_absolute() or ".." in relative_path.parts:
            raise ValueError("tracked owner must be a repository-relative path")
        owner_path = (self.workspace_root / relative_path).resolve()
        try:
            owner_path.relative_to(self.workspace_root)
        except ValueError as error:
            raise ValueError("tracked owner escapes the repository") from error
        tracked = subprocess.run(
            [
                "git",
                "-C",
                str(self.workspace_root),
                "ls-files",
                "--error-unmatch",
                "--",
                owner_ref,
            ],
            capture_output=True,
            check=False,
            text=True,
        )
        if tracked.returncode != 0 or not owner_path.is_file():
            raise ValueError("tracked owner does not exist as a tracked file")
        return hashlib.sha256(owner_path.read_bytes()).hexdigest()

    def adopt(
        self,
        finding_id,
        owner_class,
        owner_ref,
        record,
        now=None,
        owner_sha256=None,
    ):
        if now is None:
            now = utc_now()
        if record is None:
            record = {}
        if not isinstance(record, dict):
            raise ValueError("adoption record must be an object")

        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            finding = connection.execute(
                """
                SELECT routing_kind, proposed_owner
                FROM research_findings
                WHERE id = ?
                """,
                (finding_id,),
            ).fetchone()
            if finding is None:
                raise ValueError(f"unknown finding: {finding_id}")
            existing = connection.execute(
                "SELECT 1 FROM research_adoptions WHERE finding_id = ?", (finding_id,)
            ).fetchone()
            if existing is not None:
                raise ValueError(f"finding already adopted: {finding_id}")
            structured_owners = {
                "expertise_entries",
                "marketing_method_entries",
                "audience_language_entries",
            }
            if finding["routing_kind"] == "new_owner_proposal":
                raise ValueError("proposal findings are not adoptable")
            elif finding["routing_kind"] == "existing_owner":
                if finding["proposed_owner"] in structured_owners:
                    expected_class = "structured_knowledge"
                elif finding["proposed_owner"] == "format_reference_entries":
                    expected_class = "raw_reference"
                else:
                    expected_class = "tracked_owner"
            else:
                raise ValueError("finding route is not adoptable")
            if (
                owner_ref != finding["proposed_owner"]
                or owner_class != expected_class
            ):
                raise ValueError("adoption owner does not match finding route")
            if owner_class == "tracked_owner" and record:
                raise ValueError(f"owner {owner_ref!r} does not accept a structured record")
            if owner_class == "tracked_owner":
                actual_sha256 = self._tracked_owner_sha256(owner_ref)
                if owner_sha256 is not None and owner_sha256 != actual_sha256:
                    raise ValueError("owner checksum does not match tracked file")
                owner_sha256 = actual_sha256
            if owner_class == "raw_reference":
                assets = record.get("assets")
                if not isinstance(assets, list) or not assets:
                    raise ValueError("raw reference adoption requires assets")
                medium = require_text(record, "medium")
                if medium not in {"slideshow", "video"}:
                    raise ValueError("raw reference medium must be slideshow or video")
                format_id = require_text(record, "format_id")
                if (
                    len(format_id) > 100
                    or re.fullmatch(r"[a-z0-9][a-z0-9-]*", format_id) is None
                ):
                    raise ValueError("format_id must be a lowercase safe identifier")
                post_id = require_safe_identifier(record, "post_id")
                expected_parent = Path(
                    f"renderer/{medium}/formats/{format_id}/references/{post_id}"
                )
                expected_parent_path = self.workspace_root / expected_parent
                resolved_parent = expected_parent_path.resolve()
                if resolved_parent != expected_parent_path:
                    raise ValueError("raw reference owner directory cannot be symlinked")
                manifest = []
                for asset in assets:
                    if not isinstance(asset, dict):
                        raise ValueError("raw reference asset must be an object")
                    local_path = Path(require_text(asset, "local_path"))
                    if local_path.is_absolute() or ".." in local_path.parts:
                        raise ValueError("raw reference asset path must be repository-relative")
                    try:
                        local_path.relative_to(expected_parent)
                    except ValueError as error:
                        raise ValueError(
                            "raw reference asset is outside its reference owner"
                        ) from error
                    local_asset_path = self.workspace_root / local_path
                    if local_asset_path.is_symlink():
                        raise ValueError("raw reference asset cannot be a symlink")
                    asset_path = local_asset_path.resolve()
                    try:
                        asset_path.relative_to(resolved_parent)
                    except ValueError as error:
                        raise ValueError(
                            "raw reference asset escapes its reference owner"
                        ) from error
                    if not asset_path.is_file():
                        raise ValueError("raw reference asset does not exist")
                    expected_sha256 = require_text(asset, "media_sha256")
                    actual_sha256 = hashlib.sha256(asset_path.read_bytes()).hexdigest()
                    if expected_sha256 != actual_sha256:
                        raise ValueError("raw reference asset checksum does not match")
                    manifest.append(
                        {
                            "position": asset.get("position"),
                            "local_path": local_path.as_posix(),
                            "media_sha256": actual_sha256,
                        }
                    )
                manifest.sort(key=lambda item: (item["position"], item["local_path"]))
                manifest_json = json.dumps(
                    manifest,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                actual_sha256 = hashlib.sha256(manifest_json.encode("utf-8")).hexdigest()
                if owner_sha256 is not None and owner_sha256 != actual_sha256:
                    raise ValueError("owner checksum does not match raw reference manifest")
                owner_sha256 = actual_sha256
            connection.execute(
                """
                INSERT INTO research_adoptions (
                    finding_id, owner_class, owner_ref, adopted_at, owner_sha256
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    finding_id,
                    owner_class,
                    owner_ref,
                    format_timestamp(now),
                    owner_sha256,
                ),
            )
            self._materialize_owner(connection, finding_id, owner_ref, record)
        return {"finding_id": finding_id, "owner_class": owner_class, "owner_ref": owner_ref}

    def withdraw(
        self,
        finding_id,
        reason,
        actor_kind="agent",
        actor_evidence=None,
        owner_sha256_after=None,
        now=None,
    ):
        if now is None:
            now = utc_now()
        if not isinstance(reason, str) or not reason.strip():
            raise ValueError("withdrawal reason is required")
        if actor_kind not in {"user", "agent"}:
            raise ValueError("invalid withdrawal actor kind")
        if actor_kind == "user" and not str(actor_evidence or "").strip():
            raise ValueError("user withdrawal requires actor evidence")

        structured_tables = {
            "expertise_entries",
            "marketing_method_entries",
            "audience_language_entries",
        }
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            adoption = connection.execute(
                """
                SELECT owner_class, owner_ref, owner_sha256
                FROM research_adoptions
                WHERE finding_id = ?
                """,
                (finding_id,),
            ).fetchone()
            if adoption is None:
                raise ValueError(f"finding is not adopted: {finding_id}")
            withdrawn = connection.execute(
                "SELECT 1 FROM research_withdrawals WHERE finding_id = ?",
                (finding_id,),
            ).fetchone()
            if withdrawn is not None:
                raise ValueError(f"finding is already withdrawn: {finding_id}")

            if adoption["owner_class"] == "structured_knowledge":
                if adoption["owner_ref"] not in structured_tables:
                    raise ValueError("unknown structured owner")
                deleted = connection.execute(
                    f"DELETE FROM {adoption['owner_ref']} WHERE finding_id = ?",
                    (finding_id,),
                )
                if deleted.rowcount != 1:
                    raise ValueError("structured owner record is missing")
                owner_sha256_after = None
            elif adoption["owner_class"] == "raw_reference":
                connection.execute(
                    "DELETE FROM format_reference_assets WHERE finding_id = ?",
                    (finding_id,),
                )
                deleted = connection.execute(
                    "DELETE FROM format_reference_entries WHERE finding_id = ?",
                    (finding_id,),
                )
                if deleted.rowcount != 1:
                    raise ValueError("raw reference owner record is missing")
                owner_sha256_after = None
            elif adoption["owner_class"] == "tracked_owner":
                actual_sha256 = self._tracked_owner_sha256(adoption["owner_ref"])
                if actual_sha256 == adoption["owner_sha256"]:
                    raise ValueError("tracked owner must be corrected before withdrawal")
                if owner_sha256_after is not None and owner_sha256_after != actual_sha256:
                    raise ValueError("owner checksum does not match corrected tracked file")
                owner_sha256_after = actual_sha256
            else:
                raise ValueError("unsupported adoption owner class")

            connection.execute(
                """
                INSERT INTO research_withdrawals (
                    finding_id, reason, actor_kind, actor_evidence,
                    withdrawn_at, owner_sha256_after
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    finding_id,
                    reason.strip(),
                    actor_kind,
                    str(actor_evidence).strip() if actor_evidence is not None else None,
                    format_timestamp(now),
                    owner_sha256_after,
                ),
            )
        return {"finding_id": finding_id, "status": "withdrawn"}

    def _materialize_owner(self, connection, finding_id, owner_ref, record):
        table_columns = {
            "expertise_entries": (
                "topic",
                "claim",
                "mechanism",
                "practical_application",
                "scope_conditions",
                "limitations",
                "evidence_status",
                "content_use",
            ),
            "marketing_method_entries": (
                "method",
                "mechanism",
                "application_context",
                "prerequisites",
                "limitations",
                "evidence_status",
                "proposed_test",
            ),
            "audience_language_entries": (
                "expression",
                "situation",
                "source_context",
                "target_fit",
            ),
        }
        columns = table_columns.get(owner_ref)
        if columns is not None:
            values = [record.get(column) for column in columns]
            placeholders = ", ".join("?" for _ in columns)
            connection.execute(
                f"INSERT INTO {owner_ref} (finding_id, {', '.join(columns)}) "
                f"VALUES (?, {placeholders})",
                [finding_id] + values,
            )
            return

        if owner_ref == "format_reference_entries":
            columns = (
                "medium",
                "format_id",
                "post_id",
                "source_id",
                "selection_reason",
            )
            values = [record.get(column) for column in columns]
            connection.execute(
                """
                INSERT INTO format_reference_entries (
                    finding_id, medium, format_id, post_id, source_id, selection_reason
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                [finding_id] + values,
            )
            for asset in record.get("assets", []):
                connection.execute(
                    """
                    INSERT INTO format_reference_assets (
                        id, finding_id, position, local_path, media_sha256,
                        media_type, width, height, duration_seconds
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        asset.get("id") or new_id("RA"),
                        finding_id,
                        asset.get("position"),
                        asset.get("local_path"),
                        asset.get("media_sha256"),
                        asset.get("media_type"),
                        asset.get("width"),
                        asset.get("height"),
                        asset.get("duration_seconds"),
                    ),
                )
            return

        if record:
            raise ValueError(f"owner {owner_ref!r} does not accept a structured record")


def read_json_file(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def build_parser():
    parser = argparse.ArgumentParser(description="Operate the LIFT CODE research store.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB_PATH)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init")


    start = subparsers.add_parser("start-run")
    start.add_argument("--trigger", required=True)
    start.add_argument("--objective", required=True)
    start.add_argument("--event-context-json", default="{}")
    start.add_argument("--lease-minutes", type=int, default=55)

    record = subparsers.add_parser("record-question")
    record.add_argument("--run-id", required=True)
    record.add_argument("--payload-file", type=Path, required=True)

    select = subparsers.add_parser("select-question")
    select.add_argument("--run-id", required=True)
    select.add_argument("--payload-file", type=Path, required=True)

    finish = subparsers.add_parser("finish-run")
    finish.add_argument("--run-id", required=True)
    finish.add_argument("--status", choices=("completed", "failed"), required=True)
    finish.add_argument("--error-text")

    pending = subparsers.add_parser("pending")
    pending.add_argument("--run-id")

    subparsers.add_parser("open-notification-attempts")

    prepare_notifications = subparsers.add_parser("prepare-notifications")
    prepare_notifications.add_argument("--attempt-token", required=True)

    resolve_notification = subparsers.add_parser("resolve-notification-attempt")
    resolve_notification.add_argument("--attempt-token", required=True)
    resolve_notification.add_argument(
        "--status", choices=("delivered", "failed"), required=True
    )
    resolve_notification.add_argument("--transport-ref")
    resolve_notification.add_argument("--error-text")

    review = subparsers.add_parser("review")
    review.add_argument("--finding-id", required=True)
    review.add_argument(
        "--decision", choices=("approved", "rejected", "revision_requested"), required=True
    )
    review.add_argument("--rationale", required=True)

    adopt = subparsers.add_parser("adopt")
    adopt.add_argument("--finding-id", required=True)
    adopt.add_argument("--owner-class", required=True)
    adopt.add_argument("--owner-ref", required=True)
    adopt.add_argument("--payload-file", type=Path)
    adopt.add_argument("--owner-sha256")

    withdraw = subparsers.add_parser("withdraw")
    withdraw.add_argument("--finding-id", required=True)
    withdraw.add_argument("--reason", required=True)
    withdraw.add_argument("--actor-kind", choices=("user", "agent"), default="agent")
    withdraw.add_argument("--actor-evidence")
    withdraw.add_argument("--owner-sha256-after")

    quality_feedback = subparsers.add_parser("quality-feedback")
    quality_feedback.add_argument("--run-id", required=True)
    quality_feedback.add_argument("--finding-id")
    quality_feedback.add_argument(
        "--verdict",
        choices=("useful", "weak_evidence", "irrelevant", "overstated", "correction"),
        required=True,
    )
    quality_feedback.add_argument("--rationale", required=True)
    quality_feedback.add_argument("--actor-evidence", required=True)

    return parser


def main():
    args = build_parser().parse_args()
    store = ResearchStore(args.db)
    if args.command == "init":
        result = {"status": "initialized", "db": str(args.db)}
    elif args.command == "start-run":
        result = store.start_run(
            args.trigger,
            args.objective,
            lease_minutes=args.lease_minutes,
            event_context=json.loads(args.event_context_json),
        )
    elif args.command == "record-question":
        result = store.record_question(args.run_id, read_json_file(args.payload_file))
    elif args.command == "select-question":
        result = store.select_question(args.run_id, read_json_file(args.payload_file))
    elif args.command == "finish-run":
        result = store.finish_run(
            args.run_id, args.status, error_text=args.error_text
        )
    elif args.command == "pending":
        result = store.pending_findings(run_id=args.run_id)
    elif args.command == "open-notification-attempts":
        result = store.open_notification_attempts()
    elif args.command == "prepare-notifications":
        result = store.prepare_notifications(args.attempt_token)
    elif args.command == "resolve-notification-attempt":
        result = store.resolve_notification_attempt(
            args.attempt_token,
            args.status,
            transport_ref=args.transport_ref,
            error_text=args.error_text,
        )
    elif args.command == "review":
        result = store.review(
            args.finding_id,
            args.decision,
            args.rationale,
        )
    elif args.command == "adopt":
        payload = read_json_file(args.payload_file) if args.payload_file else {}
        result = store.adopt(
            args.finding_id,
            args.owner_class,
            args.owner_ref,
            payload,
            owner_sha256=args.owner_sha256,
        )
    elif args.command == "withdraw":
        result = store.withdraw(
            args.finding_id,
            args.reason,
            actor_kind=args.actor_kind,
            actor_evidence=args.actor_evidence,
            owner_sha256_after=args.owner_sha256_after,
        )
    elif args.command == "quality-feedback":
        result = store.record_quality_feedback(
            run_id=args.run_id,
            finding_id=args.finding_id,
            verdict=args.verdict,
            rationale=args.rationale,
            actor_evidence=args.actor_evidence,
        )
    else:
        raise RuntimeError(f"unsupported command: {args.command}")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
