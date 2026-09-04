# Marketing methods

## Purpose

This file defines the policy and retrieval contract for reusable external marketing methods. Unbounded accepted methods live in `marketing_method_entries` and their evidence lives in the associated finding/source rows in `db/research.sqlite`.

A marketing method is an externally supported mechanism or practice that may change how LIFT CODE acquires qualified attention. It is not proof that the method will work for this account.

## Ownership boundary

`marketing_method_entries` owns:

- the method and proposed mechanism;
- the context in which it may apply;
- prerequisites, limitations, and evidence status;
- the smallest LIFT CODE test that could evaluate it.

It does not own:

- funnel stages or measurement contracts: `docs/marketing-funnel.md`;
- LIFT CODE message or copywriting decisions: versioned strategy owners;
- internal causal evidence: `db/hypothesis-loop.sqlite`;
- format execution evidence: renderer references and Research DB format metadata;
- operating procedures: `AGENTS.md`, project docs, or a reusable skill.

External success, popularity, or expert recommendation makes a method a candidate, not an adopted LIFT CODE rule. Any generation-affecting use must still enter the existing message/copywriting hypothesis loop when appropriate.

## Admission rules

- State the mechanism, not only the tactic label.
- Preserve the audience, channel, product stage, resource, and measurement conditions.
- Separate platform facts from causal marketing claims.
- Do not infer effectiveness from one successful account or post.
- Prefer a bounded test over a universal best-practice claim.
- When a method requires a new internal project responsibility, create or change the narrowest complete owner autonomously under `AGENTS.md`, then route the finding to that resulting owner. Use `new_owner_proposal` only when a user-exclusive credential, cost, destructive change, out-of-scope decision, or unresolved trust or consistency risk blocks implementation.

## Retrieval contract

Query only methods relevant to the current bottleneck or planned test:

```bash
sqlite3 -json db/research.sqlite \
  "SELECT finding_id, method, mechanism, application_context, prerequisites, limitations, evidence_status, proposed_test FROM marketing_method_entries WHERE application_context LIKE '%TikTok%';"
```

Open linked finding/source rows when validating provenance, scope, contradiction, or freshness. Do not copy full research reports into message or copywriting files.
