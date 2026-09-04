#!/usr/bin/env python3
"""Deterministic integrity checks for the Self-Improving Content Generation Loop."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RESEARCH_DB = REPO_ROOT / "db/research.sqlite"
DEFAULT_HYPOTHESIS_DB = REPO_ROOT / "db/hypothesis-loop.sqlite"
DEFAULT_PRODUCTION_FORMATS = REPO_ROOT / "context/production-formats.json"
DEFAULT_JOBS_PATH = (
    Path.home() / ".hermes/profiles/marketing-liftcode/cron/jobs.json"
)
EXPECTED_SCHEMA_VERSIONS = {"research": 8, "hypothesis": 17}
DEFAULT_REQUIRED_FILES = (
    "AGENTS.md",
    "README.md",
    "docs/research-loop.md",
    "db/research-schema.sql",
    "db/schema.sql",
    "scripts/research_store.py",
    "scripts/collect_due_content_results.py",
    "scripts/manual_analytics_store.py",
    "scripts/run_event_research.py",
)


def _inspect_database(
    path: Path,
    label: str,
    expected_version: int,
    issues: list[str],
    warnings: list[str],
    now: datetime,
):
    if not path.is_file():
        issues.append(f"{label} database is missing: {path}")
        return
    try:
        with sqlite3.connect(path) as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                issues.append(f"{label} database integrity check failed: {integrity}")
            foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
            if foreign_keys:
                issues.append(
                    f"{label} database foreign key check failed: {len(foreign_keys)} row(s)"
                )
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version != expected_version:
                issues.append(
                    f"{label} database schema version is {version}, expected {expected_version}"
                )
            if label == "research":
                unresolved = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM research_questions AS question
                    JOIN research_runs AS run ON run.id = question.run_id
                    WHERE run.status IN ('completed', 'failed', 'skipped')
                      AND question.status = 'selected'
                    """
                ).fetchone()[0]
                if unresolved:
                    issues.append(
                        f"research lifecycle has {unresolved} selected question(s) in terminal runs"
                    )
                stale = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM research_runs
                    WHERE status = 'running'
                      AND datetime(lease_expires_at) <= datetime(?)
                    """,
                    (now.astimezone(timezone.utc).isoformat(),),
                ).fetchone()[0]
                if stale:
                    warnings.append(
                        f"research lifecycle has {stale} expired research lease(s); "
                        "the next run will recover them"
                    )
            elif label == "hypothesis":
                lifecycle_errors = connection.execute(
                    """
                    SELECT COUNT(*)
                    FROM measurement_requests AS request
                    LEFT JOIN manual_analytics_observations AS observation
                      ON observation.request_id = request.id
                    WHERE (
                        request.status = 'fulfilled'
                        AND (
                            observation.id IS NULL
                            OR request.fulfilled_at <> observation.recorded_at
                        )
                    ) OR (
                        request.status <> 'fulfilled'
                        AND observation.id IS NOT NULL
                    ) OR datetime(request.window_end) > datetime(request.requested_at)
                      OR request.metric_key IN (
                          'retention_curve', 'viewer_composition', 'follower_composition'
                      )
                      OR (observation.id IS NOT NULL AND (
                          datetime(observation.observed_at) < datetime(request.requested_at)
                          OR datetime(observation.observed_at) < datetime(request.window_end)
                          OR datetime(observation.observed_at) > datetime(observation.recorded_at)
                      ))
                    """
                ).fetchone()[0]
                if lifecycle_errors:
                    issues.append(
                        f"manual analytics lifecycle has {lifecycle_errors} inconsistent request(s)"
                    )
                required_triggers = {
                    "require_pending_measurement_request_insert",
                    "validate_measurement_request_timing",
                    "reject_untyped_breakdown_measurement_request",
                    "prevent_equivalent_pending_measurement_request",
                    "preserve_measurement_request_identity",
                    "validate_manual_analytics_observation",
                    "fulfill_measurement_request_after_observation",
                    "require_observation_for_measurement_fulfillment",
                    "preserve_manual_analytics_observation",
                    "preserve_manual_analytics_observation_delete",
                    "preserve_fulfilled_measurement_request",
                    "preserve_measurement_request_delete",
                }
                present_triggers = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'trigger'"
                    ).fetchall()
                }
                missing_triggers = sorted(required_triggers - present_triggers)
                if missing_triggers:
                    issues.append(
                        "manual analytics lifecycle is missing trigger(s): "
                        + ", ".join(missing_triggers)
                    )
    except Exception as error:
        issues.append(f"{label} database inspection failed: {error}")


def _configured_jobs(jobs_path: Path, issues: list[str]):
    if not jobs_path.is_file():
        issues.append(f"Hermes jobs file is missing: {jobs_path}")
        return []
    try:
        payload = json.loads(jobs_path.read_text(encoding="utf-8"))
    except Exception as error:
        issues.append(f"Hermes jobs file is invalid: {error}")
        return []
    return [
        job
        for job in payload.get("jobs", [])
        if job.get("state") != "removed"
    ]


def _inspect_production_formats(
    owner_path: Path,
    hypothesis_db: Path,
    issues: list[str],
    selected_format: tuple[str, str] | None = None,
    formats_root: Path = REPO_ROOT / "renderer",
):
    if not owner_path.is_file():
        issues.append(f"production-format owner is missing: {owner_path}")
        return
    try:
        payload = json.loads(owner_path.read_text(encoding="utf-8"))
    except Exception as error:
        issues.append(f"production-format owner is invalid JSON: {error}")
        return

    if not isinstance(payload, dict) or set(payload) != {
        "schema_version",
        "production_enabled",
        "allowed_formats",
    }:
        issues.append(
            "production-format owner must contain only schema_version, production_enabled, and allowed_formats"
        )
        return
    if payload["schema_version"] != 2:
        issues.append("production-format owner schema_version must be 2")
    production_enabled = payload["production_enabled"]
    if not isinstance(production_enabled, bool):
        issues.append("production-format owner production_enabled must be a boolean")
        return
    entries = payload["allowed_formats"]
    if not isinstance(entries, list):
        issues.append("production-format owner allowed_formats must be a list")
        return

    allowed: set[tuple[str, str]] = set()
    entries_valid = True
    for index, entry in enumerate(entries):
        label = f"production-format entry {index}"
        if not isinstance(entry, dict) or set(entry) != {"medium", "format_id"}:
            issues.append(f"{label} must contain only medium and format_id")
            entries_valid = False
            continue
        medium = entry["medium"]
        format_id = entry["format_id"]
        if medium not in {"slideshow", "video"}:
            issues.append(f"{label} has unsupported medium: {medium}")
            entries_valid = False
            continue
        if not isinstance(format_id, str) or re.fullmatch(
            r"[a-z0-9]+(?:-[a-z0-9]+)*", format_id
        ) is None:
            issues.append(f"{label} has unsafe format_id: {format_id}")
            entries_valid = False
            continue
        identity = (medium, format_id)
        if identity in allowed:
            issues.append(f"production-format owner duplicates {medium}/{format_id}")
            entries_valid = False
            continue
        allowed.add(identity)

        format_root = formats_root / medium / "formats" / format_id
        copywriting_root = format_root / "copywriting"
        references_root = format_root / "references"
        if not format_root.is_dir():
            issues.append(
                f"production-format entry does not resolve to a format namespace: {medium}/{format_id}"
            )
            entries_valid = False
        if not copywriting_root.is_dir() or not any(
            path.is_file() and re.fullmatch(r"v[1-9][0-9]*\.md", path.name)
            for path in copywriting_root.glob("v*.md")
        ):
            issues.append(
                f"production-format entry has no valid copywriting version: {medium}/{format_id}"
            )
            entries_valid = False
        if not references_root.is_dir() or not any(
            path.is_file() for path in references_root.rglob("*")
        ):
            issues.append(
                f"production-format entry has no designated reference evidence: {medium}/{format_id}"
            )
            entries_valid = False

    if entries_valid and selected_format is not None:
        if not production_enabled:
            issues.append("new content production is disabled")
        elif selected_format not in allowed:
            issues.append(
                "selected production format is not allowed: "
                f"{selected_format[0]}/{selected_format[1]}"
            )

    if not entries_valid or not hypothesis_db.is_file():
        return production_enabled
    try:
        with sqlite3.connect(hypothesis_db) as connection:
            pending = connection.execute(
                """
                SELECT id, medium, format_id
                FROM contents
                WHERE tiktok_url IS NULL
                ORDER BY id
                """
            ).fetchall()
    except Exception as error:
        issues.append(f"production-format content inspection failed: {error}")
        return production_enabled
    for content_id, medium, format_id in pending:
        if (medium, format_id) not in allowed:
            issues.append(
                "publication-ready content uses a non-allowed production format: "
                f"{content_id} ({medium}/{format_id})"
            )
    return production_enabled


def _inspect_jobs(
    jobs_path: Path,
    issues: list[str],
    warnings: list[str],
    production_enabled: bool | None,
):
    configured_jobs = _configured_jobs(jobs_path, issues)
    jobs = [job for job in configured_jobs if job.get("enabled", True)]
    standalone_research = [
        job
        for job in jobs
        if "open-ended research" in str(job.get("name", "")).lower()
        or (
            not job.get("no_agent", False)
            and "research" in str(job.get("name", "")).lower()
        )
    ]
    if standalone_research:
        issues.append("standalone research scheduler job is enabled")

    legacy_production_jobs = [
        job
        for job in jobs
        if Path(str(job.get("script", ""))).name
        == "run_scheduled_content_production.py"
    ]
    if legacy_production_jobs:
        issues.append("legacy script-only content production job is enabled")

    configured_production_jobs = [
        job
        for job in configured_jobs
        if job.get("name") == "LIFT CODE scheduled content production"
    ]
    enabled_production_jobs = [
        job for job in configured_production_jobs if job.get("enabled", True)
    ]
    if len(configured_production_jobs) != 1:
        issues.append(
            "expected exactly one configured scheduled content-production job; "
            f"found {len(configured_production_jobs)}"
        )
    else:
        production = configured_production_jobs[0]
        if production.get("no_agent", False) or production.get("script"):
            issues.append("scheduled content production must remain an agent job")
        if production.get("workdir") != str(REPO_ROOT):
            issues.append("scheduled content production must use the repository workdir")
        if (
            production.get("deliver") != "origin"
            or (production.get("origin") or {}).get("platform") != "telegram"
        ):
            issues.append("scheduled content production must deliver to its Telegram origin")
    if production_enabled is False and enabled_production_jobs:
        issues.append(
            "scheduled content-production job must be paused while new content production is disabled"
        )

    expected = {
        "collect_due_content_results_watchdog.py": "due-content collector",
    }
    for script, label in expected.items():
        matches = [job for job in jobs if Path(str(job.get("script", ""))).name == script]
        if len(matches) != 1:
            issues.append(f"expected exactly one enabled {label} job; found {len(matches)}")
            continue
        job = matches[0]
        if not job.get("no_agent", False):
            issues.append(f"{label} job must remain script-only at the scheduler boundary")
        if job.get("deliver") != "telegram":
            issues.append(f"{label} job must deliver alerts and research digests to Telegram")
        if job.get("last_status") not in {None, "ok"}:
            warnings.append(f"{label} job reports last_status={job.get('last_status')}")
        if job.get("last_delivery_error"):
            warnings.append(f"{label} job reports a delivery error")


def _inspect_operational_health(research_db, hypothesis_db, now, warnings):
    now_text = now.astimezone(timezone.utc).isoformat(timespec="seconds")
    with sqlite3.connect(hypothesis_db) as hypothesis:
        hypothesis.row_factory = sqlite3.Row
        active_leaf_count, last_progress = hypothesis.execute(
            """
            SELECT COUNT(*), MAX(coalesce(leaf.last_evaluated_at, leaf.created_at))
            FROM hypotheses AS leaf
            WHERE leaf.closed_at IS NULL
              AND NOT EXISTS (
                  SELECT 1
                  FROM hypotheses AS child
                  WHERE child.parent_hypothesis_id = leaf.id
              )
            """
        ).fetchone()
        hypothesis_count = hypothesis.execute(
            "SELECT COUNT(*) FROM hypotheses"
        ).fetchone()[0]
        if active_leaf_count == 1 and hypothesis.execute(
            "SELECT datetime(?) <= datetime(?, '-7 days')",
            (last_progress, now_text),
        ).fetchone()[0]:
            warnings.append(
                "hypothesis loop has one unchanged hypothesis for at least seven days"
            )

        checkpoints = {
            row["id"]: row
            for row in hypothesis.execute(
                "SELECT id, content_id, target_hours, collected_at FROM content_results"
            ).fetchall()
        }
        stale_requests = hypothesis.execute(
            """
            SELECT COUNT(*)
            FROM measurement_requests
            WHERE status = 'pending'
              AND datetime(requested_at) <= datetime(?, '-3 days')
            """,
            (now_text,),
        ).fetchone()[0]
        if stale_requests:
            warnings.append(
                f"{stale_requests} TikTok Studio measurement request(s) remain pending for at least three days"
            )

    with sqlite3.connect(research_db) as research:
        research.row_factory = sqlite3.Row
        event_run_count = research.execute(
            """
            SELECT COUNT(*)
            FROM research_runs
            WHERE trigger_kind IN ('content_preflight', 'result_review', 'manual')
            """
        ).fetchone()[0]
        if hypothesis_count and event_run_count == 0:
            warnings.append(
                "hypothesis state exists but Research DB has no event research runs"
            )
        reviewed_checkpoint_ids = set()
        for row in research.execute(
            """
            SELECT event_context_json, started_at
            FROM research_runs
            WHERE trigger_kind = 'result_review' AND status = 'completed'
            """
        ).fetchall():
            context = json.loads(row["event_context_json"])
            for checkpoint in context.get("checkpoints", []):
                result_id = checkpoint.get("result_id")
                result = checkpoints.get(result_id)
                if (
                    result is not None
                    and checkpoint.get("content_id") == result["content_id"]
                    and checkpoint.get("target_hours") == result["target_hours"]
                    and research.execute(
                        "SELECT datetime(?) >= datetime(?)",
                        (row["started_at"], result["collected_at"]),
                    ).fetchone()[0]
                ):
                    reviewed_checkpoint_ids.add(result_id)
        unreviewed_count = len(set(checkpoints) - reviewed_checkpoint_ids)
        if unreviewed_count:
            noun = "checkpoint has" if unreviewed_count == 1 else "checkpoints have"
            warnings.append(
                f"{unreviewed_count} content {noun} no subsequent result-review research run linked to that checkpoint"
            )

        outcome_rows = research.execute(
            """
            SELECT question.status
            FROM research_questions AS question
            JOIN research_runs AS run ON run.id = question.run_id
            WHERE run.trigger_kind IN ('content_preflight', 'result_review', 'manual')
              AND question.status <> 'selected'
            ORDER BY run.started_at DESC, question.position DESC
            LIMIT 10
            """
        ).fetchall()
        if len(outcome_rows) >= 5:
            weak_count = sum(
                row["status"] in {"duplicate", "no_finding", "outside_scope", "failed"}
                for row in outcome_rows
            )
            if weak_count / len(outcome_rows) >= 0.8:
                warnings.append(
                    "recent research outcomes are concentrated in duplicate, no-finding, outside-scope, or failed states"
                )

        owner_rows = research.execute(
            """
            SELECT finding.proposed_owner, COUNT(*) AS count
            FROM (
                SELECT id, proposed_owner
                FROM research_findings
                ORDER BY created_at DESC
                LIMIT 10
            ) AS finding
            GROUP BY finding.proposed_owner
            ORDER BY count DESC
            """
        ).fetchall()
        if owner_rows and sum(row["count"] for row in owner_rows) >= 10:
            total = sum(row["count"] for row in owner_rows)
            if owner_rows[0]["count"] / total >= 0.9:
                warnings.append(
                    f"recent research findings are concentrated in one proposed owner: {owner_rows[0]['proposed_owner']}"
                )

        source_rows = research.execute(
            """
            SELECT source.source_kind, COUNT(*) AS count
            FROM (
                SELECT id
                FROM research_findings
                ORDER BY created_at DESC
                LIMIT 10
            ) AS finding
            JOIN research_finding_sources AS link ON link.finding_id = finding.id
            JOIN research_sources AS source ON source.id = link.source_id
            GROUP BY source.source_kind
            ORDER BY count DESC
            """
        ).fetchall()
        if source_rows and sum(row["count"] for row in source_rows) >= 10:
            total = sum(row["count"] for row in source_rows)
            if source_rows[0]["count"] / total >= 0.9:
                warnings.append(
                    f"recent research evidence is concentrated in one source class: {source_rows[0]['source_kind']}"
                )


def inspect_system(
    *,
    research_db: Path = DEFAULT_RESEARCH_DB,
    hypothesis_db: Path = DEFAULT_HYPOTHESIS_DB,
    production_formats: Path = DEFAULT_PRODUCTION_FORMATS,
    selected_medium: str | None = None,
    selected_format_id: str | None = None,
    jobs_path: Path = DEFAULT_JOBS_PATH,
    formats_root: Path = REPO_ROOT / "renderer",
    required_files=None,
    now=None,
):
    if now is None:
        now = datetime.now(timezone.utc)
    issues: list[str] = []
    warnings: list[str] = []
    _inspect_database(
        Path(research_db),
        "research",
        EXPECTED_SCHEMA_VERSIONS["research"],
        issues,
        warnings,
        now,
    )
    _inspect_database(
        Path(hypothesis_db),
        "hypothesis",
        EXPECTED_SCHEMA_VERSIONS["hypothesis"],
        issues,
        warnings,
        now,
    )
    selected_format = None
    if (selected_medium is None) != (selected_format_id is None):
        issues.append(
            "selected production format check requires both medium and format_id"
        )
    elif selected_medium is not None and selected_format_id is not None:
        selected_format = (selected_medium, selected_format_id)
    production_enabled = _inspect_production_formats(
        Path(production_formats),
        Path(hypothesis_db),
        issues,
        selected_format,
        Path(formats_root),
    )
    _inspect_jobs(Path(jobs_path), issues, warnings, production_enabled)
    if not issues:
        try:
            _inspect_operational_health(
                Path(research_db), Path(hypothesis_db), now, warnings
            )
        except Exception as error:
            issues.append(f"operational health inspection failed: {error}")
    files = DEFAULT_REQUIRED_FILES if required_files is None else required_files
    for relative in files:
        path = REPO_ROOT / relative
        if not path.is_file():
            issues.append(f"required owner is missing: {relative}")
    return {
        "ok": not issues,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "issues": issues,
        "warnings": warnings,
        "boundary": "scheduler-internal checks only; no external runtime watchdog",
    }


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-db", type=Path, default=DEFAULT_RESEARCH_DB)
    parser.add_argument("--hypothesis-db", type=Path, default=DEFAULT_HYPOTHESIS_DB)
    parser.add_argument(
        "--production-formats", type=Path, default=DEFAULT_PRODUCTION_FORMATS
    )
    parser.add_argument("--selected-medium")
    parser.add_argument("--selected-format-id")
    parser.add_argument("--jobs", type=Path, default=DEFAULT_JOBS_PATH)
    return parser.parse_args()


def main():
    args = parse_args()
    report = inspect_system(
        research_db=args.research_db,
        hypothesis_db=args.hypothesis_db,
        production_formats=args.production_formats,
        selected_medium=args.selected_medium,
        selected_format_id=args.selected_format_id,
        jobs_path=args.jobs,
    )
    print(json.dumps(report, ensure_ascii=False, separators=(",", ":")))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
