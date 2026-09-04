#!/usr/bin/env python3
"""Launch a bounded research cycle from a real content-system event."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


PROFILE = "marketing-liftcode"
SKILLS = ("organic-content-operations", "product-marketing")
REPOSITORY = Path(__file__).resolve().parents[1]
VALID_TRIGGERS = {"content_preflight", "result_review", "manual"}


def build_research_prompt(
    *, trigger_kind: str, objective: str, event_context: dict, attempt_token: str
) -> str:
    if trigger_kind not in VALID_TRIGGERS:
        raise ValueError(f"unsupported event research trigger: {trigger_kind}")
    context_json = json.dumps(
        event_context, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return f"""Run one event-driven LIFT CODE research cycle.

Trigger: {trigger_kind}
Objective: {objective}
Event context: {context_json}
Delivery attempt token: {attempt_token}

Operate only in {REPOSITORY}. Follow AGENTS.md and docs/research-loop.md. Use scripts/research_store.py as the sole Research DB lifecycle writer.

First run scripts/system_integrity.py and inspect its result. Treat deterministic failures as blockers. Also assess semantic system integrity: missing responsibility, duplicate owner, logical conflict, stale workflow instruction, unreliable transition, or missing capability that materially limits this content cycle. Implement only the smallest internally authorized correction and verify it. This is scheduler-internal automation; do not add a launchd service, daemon, or any other runtime watchdog outside Hermes Scheduler.

Reconcile prior dispatching research_notifications before starting. Parse each attempt token's scheduler job ID, inspect that job's previous last_status, last_delivery_error, and last_run_at in the marketing-liftcode Hermes jobs file, and resolve only attempts whose scheduler-owned result is unambiguous. Never resolve {attempt_token} during this run.

Start exactly one research run with trigger {trigger_kind}, passing Event context unchanged to `start-run --event-context-json` so every triggering checkpoint remains durably linked to its review. Read the current funnel diagnosis, launch constraints, product truth, active hypothesis lineage, relevant content/checkpoints, accepted Research DB knowledge, recent duplicate/no-finding history, and prior research quality feedback. Frame the governing question as what would most improve the current qualified-audience or content decision, then select no more than three independent bounded questions. For every selected question, investigate actively across appropriate query formulations, source classes, and relevant domains until the minimum evidence is met, credible sources are saturated, or a material limitation is established. Do not research for volume. If accepted evidence is already sufficient, select zero questions and finish the run cleanly.

For every selected question, persist selection before investigation and finish it as one bounded finding, duplicate, no_finding, outside_scope, or failed outcome. Preserve exact sources, contradictions, and limitations. A new 24h/48h/72h checkpoint is diagnostic evidence, not causal proof; distinguish distribution noise, measurement gaps, message, copywriting, and topic/execution conditions before proposing an explanation. Do not turn medium, format, imagery, or raw metrics into hypothesis axes.

When a manual event contains a user-provided URL for candidate knowledge, inspect the original URL first and preserve it as the submitted source. Do not decide from that URL alone. Split its material reusable claims into bounded questions, then actively investigate appropriate independent corroborating or contradicting sources before review. User provision establishes relevance, not truth or authority. If the original cannot be inspected, do not infer it from snippets or prior descriptions and return an unassessed access limitation. Finish each assessed claim as adopted, duplicate, or not adopted with a concise plain-language reason.

If a private TikTok Studio observation materially blocks the decision, create or reuse a pending request through scripts/manual_analytics_store.py. The Telegram request must name the exact metric, scope, window, TikTok Studio location, and decision it unlocks. Never infer private data from public counters or duplicate a matching pending request.

Review every finding autonomously. Adopt a supported result into exactly one valid owner under the AGENTS.md autonomous engineering contract. If the valid owner is missing, implement and verify the smallest safe internal owner-map change before finalizing the route; use `new_owner_proposal` only when a user-exclusive credential or permission, paid cost, destructive or irreversible change, out-of-scope decision, or unresolved trust or consistency risk blocks implementation. Research may inform a message or copywriting hypothesis candidate but must not mutate hypothesis lineage outside its separate contract. Finish the run with no selected question unresolved. Then call prepare-notifications with attempt token {attempt_token}; do not resolve the current attempt.

Return only a short Korean user update, even when no external search was needed. Do not expose IDs, trigger names, database outcomes, owner names, integrity terminology, file paths, or internal feedback labels. Do not ask the user to use internal feedback labels; accept natural-language feedback instead.

For a result review, use this shape:
성과 업데이트
- 핵심 수치: show only the newly observed public metrics and checkpoint age.
- 의미: one plain-language judgment, including uncertainty when it matters.
- 다음: the one content decision that changes, or "아직 바꿀 근거 없음".

For another trigger, use the heading "확인 결과" and the same principle. Use at most three short bullets, one sentence each. Omit routine execution, research-process, source-list, and system-check detail. Mention a source or limitation only when the user needs it to judge the conclusion. If user action is essential, append one concise "확인 필요" line naming the exact action and why it is needed. Return one plain-language blocker line on failure. Never create or publish content in this research cycle."""


def run_research(
    *, trigger_kind: str, objective: str, event_context: dict, attempt_token: str
) -> str:
    hermes = shutil.which("hermes")
    if not hermes:
        raise RuntimeError("hermes executable not found")
    prompt = build_research_prompt(
        trigger_kind=trigger_kind,
        objective=objective,
        event_context=event_context,
        attempt_token=attempt_token,
    )
    command = [hermes, "--profile", PROFILE, "--yolo"]
    for skill in SKILLS:
        command.extend(("--skills", skill))
    command.extend(("chat", "--quiet", "--query", prompt))
    completed = subprocess.run(
        command,
        cwd=REPOSITORY,
        capture_output=True,
        text=True,
        timeout=3300,
        check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "unknown failure").strip()
        raise RuntimeError(f"event research agent failed: {detail[-500:]}")
    output = completed.stdout.strip()
    if not output or "[SILENT]" in output:
        raise RuntimeError("event research agent did not return the required digest")
    return output


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--trigger", choices=sorted(VALID_TRIGGERS), required=True)
    parser.add_argument("--objective", required=True)
    parser.add_argument("--event-json", default="{}")
    parser.add_argument("--attempt-token", required=True)
    return parser.parse_args()


def main():
    args = parse_args()
    event_context = json.loads(args.event_json)
    if not isinstance(event_context, dict):
        raise ValueError("event context must be a JSON object")
    print(
        run_research(
            trigger_kind=args.trigger,
            objective=args.objective,
            event_context=event_context,
            attempt_token=args.attempt_token,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
