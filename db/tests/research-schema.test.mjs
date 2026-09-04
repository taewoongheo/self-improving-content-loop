import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const schemaPath = path.join(repoRoot, "db/research-schema.sql");

async function withDatabase(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-research-schema-"));
  const databasePath = path.join(directory, "research.sqlite");

  try {
    const applied = spawnSync("sqlite3", [databasePath], {
      input: readFileSync(schemaPath, "utf8"),
      encoding: "utf8",
    });
    assert.equal(applied.status, 0, applied.stderr);
    await run(databasePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function execute(databasePath, sql) {
  return spawnSync("sqlite3", [databasePath], {
    input: sql,
    encoding: "utf8",
  });
}

function query(databasePath, sql) {
  return JSON.parse(
    execFileSync("sqlite3", ["-json", databasePath, sql], { encoding: "utf8" }) || "[]",
  );
}

function seedFinding(databasePath, { findingId = "RF-001", withSource = false } = {}) {
  const sourceSql = withSource
    ? `
      INSERT INTO research_sources (
        id, canonical_url, source_kind, title, first_seen_at, last_accessed_at
      ) VALUES (
        'RS-001', 'https://example.com/source', 'web', 'Example source',
        '2026-07-27T00:00:00Z', '2026-07-27T00:00:00Z'
      );
      INSERT INTO research_finding_sources (
        finding_id, source_id, relation, evidence_note
      ) VALUES (
        '${findingId}', 'RS-001', 'supports', 'Directly supports the bounded finding.'
      );
    `
    : "";

  const inserted = execute(databasePath, `
    INSERT INTO research_runs (
      id, trigger_kind, objective, status, started_at, lease_expires_at
    ) VALUES (
      'RR-001', 'scheduled', 'Resolve the most valuable current unknown.',
      'running', '2026-07-27T00:00:00Z', '2026-07-27T00:55:00Z'
    );
    INSERT INTO research_questions (
      id, run_id, position, question, why_now, expected_decision, status
    ) VALUES (
      'RQ-001', 'RR-001', 1, 'What should be learned?',
      'The answer may change the next marketing decision.',
      'Decide whether to change an existing owner.', 'completed'
    );
    INSERT INTO research_findings (
      id, question_id, finding_text, limitations, proposed_action,
      routing_kind, proposed_owner, finding_fingerprint, created_at
    ) VALUES (
      '${findingId}', 'RQ-001', 'A bounded finding.', 'One-source limitation.',
      'Admit only after review.', 'existing_owner', 'expertise_entries',
      '${"a".repeat(64)}', '2026-07-27T00:01:00Z'
    );
    ${sourceSql}
  `);
  assert.equal(inserted.status, 0, inserted.stderr);
}

test("research schema separates lifecycle evidence from typed durable owners", async () => {
  await withDatabase(async (databasePath) => {
    const tables = query(
      databasePath,
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;",
    ).map((row) => row.name);

    for (const table of [
      "research_runs",
      "research_questions",
      "research_sources",
      "research_source_captures",
      "research_findings",
      "research_finding_sources",
      "research_duplicate_question_sources",
      "research_reviews",
      "research_adoptions",
      "research_notifications",
      "research_withdrawals",
      "expertise_entries",
      "marketing_method_entries",
      "audience_language_entries",
      "format_reference_entries",
      "format_reference_assets",
    ]) {
      assert.ok(tables.includes(table), `missing ${table}`);
    }

    assert.equal(query(databasePath, "PRAGMA user_version;")[0].user_version, 8);
    assert.ok(!tables.includes("research_settings"));
  });
});

test("only one research run may hold the singleton lease", async () => {
  await withDatabase(async (databasePath) => {
    const first = execute(databasePath, `
      INSERT INTO research_runs (
        id, trigger_kind, objective, status, started_at, lease_expires_at
      ) VALUES (
        'RR-001', 'scheduled', 'First run.', 'running',
        '2026-07-27T00:00:00Z', '2026-07-27T00:55:00Z'
      );
    `);
    assert.equal(first.status, 0, first.stderr);

    const overlapping = execute(databasePath, `
      INSERT INTO research_runs (
        id, trigger_kind, objective, status, started_at, lease_expires_at
      ) VALUES (
        'RR-002', 'content_preflight', 'Overlapping run.', 'running',
        '2026-07-27T00:05:00Z', '2026-07-27T01:00:00Z'
      );
    `);
    assert.notEqual(overlapping.status, 0);
    assert.match(overlapping.stderr, /UNIQUE constraint failed/);

    const resumed = execute(databasePath, `
      UPDATE research_runs
      SET status = 'completed', finished_at = '2026-07-27T00:10:00Z',
          lease_expires_at = NULL
      WHERE id = 'RR-001';
      INSERT INTO research_runs (
        id, trigger_kind, objective, status, started_at, lease_expires_at
      ) VALUES (
        'RR-002', 'content_preflight', 'Next run.', 'running',
        '2026-07-27T00:11:00Z', '2026-07-27T01:06:00Z'
      );
    `);
    assert.equal(resumed.status, 0, resumed.stderr);
  });
});

test("a run can select at most three ordered open-ended questions", async () => {
  await withDatabase(async (databasePath) => {
    execute(databasePath, `
      INSERT INTO research_runs (
        id, trigger_kind, objective, status, started_at, lease_expires_at
      ) VALUES (
        'RR-001', 'manual', 'Open-ended discovery.', 'running',
        '2026-07-27T00:00:00Z', '2026-07-27T00:55:00Z'
      );
    `);

    for (let position = 1; position <= 3; position += 1) {
      const inserted = execute(databasePath, `
        INSERT INTO research_questions (
          id, run_id, position, question, why_now, expected_decision, status
        ) VALUES (
          'RQ-00${position}', 'RR-001', ${position},
          'Open question ${position}', 'Reason ${position}',
          'Decision ${position}', 'selected'
        );
      `);
      assert.equal(inserted.status, 0, inserted.stderr);
    }

    const fourth = execute(databasePath, `
      INSERT INTO research_questions (
        id, run_id, position, question, why_now, expected_decision, status
      ) VALUES (
        'RQ-004', 'RR-001', 4, 'Not allowed', 'Too many', 'None', 'selected'
      );
    `);
    assert.notEqual(fourth.status, 0);
    assert.match(fourth.stderr, /CHECK constraint failed/);
  });
});

test("findings support new owner proposals without a closed research-domain enum", async () => {
  await withDatabase(async (databasePath) => {
    seedFinding(databasePath);
    const inserted = execute(databasePath, `
      INSERT INTO research_findings (
        id, question_id, finding_text, limitations, proposed_action,
        routing_kind, proposed_owner, finding_fingerprint, created_at
      ) VALUES (
        'RF-002', 'RQ-001', 'A newly discovered responsibility.',
        'Owner does not exist yet.', 'Propose a dedicated owner.',
        'new_owner_proposal', 'distribution-partnership-evidence',
        '${"b".repeat(64)}', '2026-07-27T00:02:00Z'
      );
    `);
    assert.equal(inserted.status, 0, inserted.stderr);
  });
});

test("source URLs and finding fingerprints are globally deduplicated", async () => {
  await withDatabase(async (databasePath) => {
    seedFinding(databasePath, { withSource: true });

    const duplicateSource = execute(databasePath, `
      INSERT INTO research_sources (
        id, canonical_url, source_kind, first_seen_at, last_accessed_at
      ) VALUES (
        'RS-002', 'https://example.com/source', 'paper',
        '2026-07-27T00:02:00Z', '2026-07-27T00:02:00Z'
      );
    `);
    assert.notEqual(duplicateSource.status, 0);

    const duplicateFinding = execute(databasePath, `
      INSERT INTO research_findings (
        id, question_id, finding_text, limitations, proposed_action,
        routing_kind, proposed_owner, finding_fingerprint, created_at
      ) VALUES (
        'RF-002', 'RQ-001', 'Duplicate normalized finding.', 'None.', 'None.',
        'existing_owner', 'expertise_entries', '${"a".repeat(64)}',
        '2026-07-27T00:03:00Z'
      );
    `);
    assert.notEqual(duplicateFinding.status, 0);
  });
});

test("a repeated finding is recorded as a duplicate decision instead of a second fact", async () => {
  await withDatabase(async (databasePath) => {
    seedFinding(databasePath);

    const duplicateQuestion = execute(databasePath, `
      INSERT INTO research_questions (
        id, run_id, position, question, why_now, expected_decision,
        status, duplicate_of_finding_id
      ) VALUES (
        'RQ-002', 'RR-001', 2, 'Was this already known?',
        'Avoid repeated hourly work.', 'Reuse or reject the existing finding.',
        'duplicate', 'RF-001'
      );
    `);
    assert.equal(duplicateQuestion.status, 0, duplicateQuestion.stderr);
  });
});

test("adoption requires current autonomous approval and at least one source", async () => {
  await withDatabase(async (databasePath) => {
    seedFinding(databasePath);

    const unreviewed = execute(databasePath, `
      INSERT INTO research_adoptions (
        finding_id, owner_class, owner_ref, adopted_at
      ) VALUES (
        'RF-001', 'structured_knowledge', 'expertise_entries',
        '2026-07-27T00:05:00Z'
      );
    `);
    assert.notEqual(unreviewed.status, 0);
    assert.match(unreviewed.stderr, /approved review required/);

    execute(databasePath, `
      INSERT INTO research_reviews (
        finding_id, revision, decision, rationale, reviewed_at
      ) VALUES (
        'RF-001', 1, 'approved', 'Evidence supports bounded autonomous adoption.',
        '2026-07-27T00:06:00Z'
      );
    `);
    const sourceless = execute(databasePath, `
      INSERT INTO research_adoptions (
        finding_id, owner_class, owner_ref, adopted_at
      ) VALUES (
        'RF-001', 'structured_knowledge', 'expertise_entries',
        '2026-07-27T00:07:00Z'
      );
    `);
    assert.notEqual(sourceless.status, 0);
    assert.match(sourceless.stderr, /source required/);
  });
});

test("agent review requires rationale and adoption must match proposed routing", async () => {
  await withDatabase(async (databasePath) => {
    seedFinding(databasePath, { withSource: true });

    const reviewWithoutRationale = execute(databasePath, `
      INSERT INTO research_reviews (
        finding_id, revision, decision, rationale, reviewed_at
      ) VALUES (
        'RF-001', 1, 'approved', '',
        '2026-07-27T00:06:00Z'
      );
    `);
    assert.notEqual(reviewWithoutRationale.status, 0);
    assert.match(reviewWithoutRationale.stderr, /CHECK constraint failed/);

    const reviewed = execute(databasePath, `
      INSERT INTO research_reviews (
        finding_id, revision, decision, rationale, reviewed_at
      ) VALUES (
        'RF-001', 1, 'approved', 'Approve expertise only.',
        '2026-07-27T00:06:00Z'
      );
    `);
    assert.equal(reviewed.status, 0, reviewed.stderr);

    const wrongOwner = execute(databasePath, `
      INSERT INTO research_adoptions (
        finding_id, owner_class, owner_ref, adopted_at
      ) VALUES (
        'RF-001', 'structured_knowledge', 'marketing_method_entries',
        '2026-07-27T00:07:00Z'
      );
    `);
    assert.notEqual(wrongOwner.status, 0);
    assert.match(wrongOwner.stderr, /adoption owner does not match finding route/);
  });
});

test("one approved finding materializes in exactly one matching owner", async () => {
  await withDatabase(async (databasePath) => {
    seedFinding(databasePath, { withSource: true });
    execute(databasePath, `
      INSERT INTO research_reviews (
        finding_id, revision, decision, rationale, reviewed_at
      ) VALUES (
        'RF-001', 1, 'approved', 'Evidence supports bounded autonomous adoption.',
        '2026-07-27T00:06:00Z'
      );
      INSERT INTO research_adoptions (
        finding_id, owner_class, owner_ref, adopted_at
      ) VALUES (
        'RF-001', 'structured_knowledge', 'expertise_entries',
        '2026-07-27T00:07:00Z'
      );
    `);

    const expertise = execute(databasePath, `
      INSERT INTO expertise_entries (
        finding_id, topic, claim, practical_application, scope_conditions,
        limitations, evidence_status, content_use
      ) VALUES (
        'RF-001', 'progression', 'Bounded expertise claim.',
        'Use only in the stated training context.', 'Trained adults.',
        'Not individualized medical guidance.', 'supported',
        'May support educational content with the limitation intact.'
      );
    `);
    assert.equal(expertise.status, 0, expertise.stderr);
    assert.deepEqual(
      query(
        databasePath,
        "SELECT notification_kind || ':' || status FROM research_notifications WHERE finding_id = 'RF-001';",
      ),
      [{ "notification_kind || ':' || status": "adopted:pending" }],
    );
    const skippedDispatch = execute(databasePath, `
      UPDATE research_notifications
      SET status = 'delivered', attempt_token = 'attempt-1',
          attempted_at = '2026-07-27T00:08:00Z', attempt_count = 1,
          delivered_at = '2026-07-27T00:08:01Z', transport_ref = 'cron:test'
      WHERE finding_id = 'RF-001';
    `);
    assert.notEqual(skippedDispatch.status, 0);
    assert.match(skippedDispatch.stderr, /invalid notification state transition/);

    const wrongOwner = execute(databasePath, `
      INSERT INTO marketing_method_entries (
        finding_id, method, mechanism, application_context, prerequisites,
        limitations, evidence_status, proposed_test
      ) VALUES (
        'RF-001', 'Method', 'Mechanism', 'Context', 'Prerequisite',
        'Limitation', 'preliminary', 'Test it.'
      );
    `);
    assert.notEqual(wrongOwner.status, 0);
    assert.match(wrongOwner.stderr, /owner mismatch/);

    const secondAdoption = execute(databasePath, `
      INSERT INTO research_adoptions (
        finding_id, owner_class, owner_ref, adopted_at
      ) VALUES (
        'RF-001', 'tracked_owner', 'messages/msg-example/v2.md',
        '2026-07-27T00:08:00Z'
      );
    `);
    assert.notEqual(secondAdoption.status, 0);

    const postAdoptionReview = execute(databasePath, `
      INSERT INTO research_reviews (
        finding_id, revision, decision, rationale, reviewed_at
      ) VALUES (
        'RF-001', 2, 'rejected', 'Supersede it with a new bounded finding.',
        '2026-07-27T00:09:00Z'
      );
    `);
    assert.notEqual(postAdoptionReview.status, 0);
    assert.match(postAdoptionReview.stderr, /review is closed after adoption/);
  });
});

test("post-notification withdrawal removes accepted knowledge and preserves audit", async () => {
  await withDatabase(async (databasePath) => {
    seedFinding(databasePath, { withSource: true });
    const adopted = execute(databasePath, `
      INSERT INTO research_reviews (
        finding_id, revision, decision, rationale, reviewed_at
      ) VALUES (
        'RF-001', 1, 'approved', 'Evidence supports bounded autonomous adoption.',
        '2026-07-27T00:06:00Z'
      );
      INSERT INTO research_adoptions (
        finding_id, owner_class, owner_ref, adopted_at
      ) VALUES (
        'RF-001', 'structured_knowledge', 'expertise_entries',
        '2026-07-27T00:07:00Z'
      );
      INSERT INTO expertise_entries (
        finding_id, topic, claim, practical_application, scope_conditions,
        limitations, evidence_status, content_use
      ) VALUES (
        'RF-001', 'progression', 'Bounded expertise claim.',
        'Use only in the stated training context.', 'Trained adults.',
        'Not individualized medical guidance.', 'supported',
        'May support educational content with the limitation intact.'
      );
    `);
    assert.equal(adopted.status, 0, adopted.stderr);
    const dispatched = execute(databasePath, `
      UPDATE research_notifications
      SET status = 'dispatching', attempt_token = 'attempt-withdrawal',
          attempted_at = '2026-07-27T00:07:30Z', attempt_count = 1
      WHERE finding_id = 'RF-001';
    `);
    assert.equal(dispatched.status, 0, dispatched.stderr);

    const stillMaterialized = execute(databasePath, `
      INSERT INTO research_withdrawals (
        finding_id, reason, actor_kind, actor_evidence, withdrawn_at
      ) VALUES (
        'RF-001', 'User rejected the notified finding.', 'user',
        'telegram:chat-hash:message-456', '2026-07-27T00:08:00Z'
      );
    `);
    assert.notEqual(stillMaterialized.status, 0);
    assert.match(stillMaterialized.stderr, /structured owner must be removed/);

    const withdrawn = execute(databasePath, `
      DELETE FROM expertise_entries WHERE finding_id = 'RF-001';
      INSERT INTO research_withdrawals (
        finding_id, reason, actor_kind, actor_evidence, withdrawn_at
      ) VALUES (
        'RF-001', 'User rejected the notified finding.', 'user',
        'telegram:chat-hash:message-456', '2026-07-27T00:08:00Z'
      );
    `);
    assert.equal(withdrawn.status, 0, withdrawn.stderr);
    assert.equal(query(databasePath, "SELECT COUNT(*) AS count FROM expertise_entries;")[0].count, 0);
    assert.equal(
      query(databasePath, "SELECT actor_kind FROM research_withdrawals;")[0].actor_kind,
      "user",
    );
    assert.equal(
      query(databasePath, "SELECT status FROM research_notifications;")[0].status,
      "cancelled",
    );
  });
});
