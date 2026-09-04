# Self-Improving Content Generation Loop

## Objective

This repository develops a reusable content-generation loop that improves its future decisions from research and observed performance. Its first application is increasing qualified App Store inflow for LIFT CODE and, through that, supporting app revenue. During prelaunch there is no App Store path, so the current application builds a relevant U.S. strength-training audience with standalone TikTok value. Research, followers, engagement, content volume, and technical sophistication are means or diagnostics—not the final goal.

`docs/marketing-funnel.md` owns the funnel and measurement contract. A missing metric is a measurement gap, not proof that a stage is the bottleneck.

## Authority

The agent owns all internal means and may autonomously change policy, code, renderers, schemas, databases, prompts, schedulers, formats, hypotheses, research methods, and repository structure. It chooses content direction, message, copy, medium, format, imagery, timing, audio, and internal operating changes. It may commit and push verified repository changes without asking for approval. Report completed changes afterward.

The user retains only actions that cross an external trust boundary:

- publishing to TikTok and returning the published URL;
- providing new credentials or permissions;
- approving non-zero spend;
- approving destructive or irreversible external actions;
- resolving account-trust risks or decisions outside this marketing workspace.

Never request secret values in chat. The user provisions credentials in the profile `.env`. Never publish, contact people, spend money, or make destructive external changes autonomously.

## Operating loop

```text
observe current funnel evidence
→ diagnose the nearest actionable constraint
→ research only a decision-changing unknown
→ continue, close, or create one hypothesis
→ produce and validate one publication-ready content
→ deliver it for manual TikTok publication
→ attach the returned URL
→ collect 24h, 48h, and 72h results
→ update the hypothesis decision
```

Every interactive content request and every scheduled production event runs this loop. The Hermes cron record is the sole owner of exact schedule, prompt, skills, workdir, and delivery configuration. A late scheduled run skips its slot rather than creating catch-up content.

The result collector remains active even when new production is paused so already published content completes its checkpoints. Expired research leases are recoverable state: integrity may warn, and the next run must fail the expired lease before acquiring a new one.

## Current launch contract

The product is unreleased. Audience-facing content therefore:

- carries the account-wide `LIFT CODE` identity badge on every slideshow page but does not mention planned product capabilities or otherwise promote the unreleased product;
- contains no CTA to follow, comment, save, share, visit a profile, or take another next step;
- delivers standalone value inside the product's delegated strength-training decision space in `context/product.md`.

TikTok publication remains manual. After delivering final media, title, and caption, ask only for the published TikTok URL.

## Hypotheses

`docs/hypothesis-loop.md` owns hypothesis operation; `db/schema.sql` owns exact storage.

- The only current axes are `message` and `copywriting`.
- A hypothesis changes one controllable audience-facing idea and names the expected audience response and why it should relieve the diagnosed constraint.
- Metrics, followers, medium, format, imagery, layout, motion, timing, and audio are outcomes or execution variables, not hypothesis axes.
- Every content belongs to one active-leaf hypothesis.
- A node must remain one stable intervention. A generation-affecting message or copywriting change requires a child hypothesis; results from materially different versions must not be pooled as one direct test.
- New roots are created only when no existing active leaf represents the proposed intervention. Prefer continuing or branching an existing leaf over accumulating unrelated roots.
- Delayed observations remain separate from interpretation. One checkpoint is diagnostic evidence, not causal proof.

## Research

`docs/research-loop.md` owns selection, evidence, review, admission, notification, and withdrawal policy. `scripts/research_store.py` is the sole Research DB lifecycle writer.

- Research runs only for `content_preflight`, a newly inserted `result_review`, or an explicit `manual` request.
- Select zero questions when accepted evidence is sufficient; otherwise select at most three independent questions that could change a current decision.
- A URL-only user message is a manual candidate-knowledge review. Inspect the original first and independently corroborate or contradict its material claims.
- Accepted findings update exactly one valid owner. Unbounded evidence, provenance, results, events, and history accumulate in SQLite, not Markdown logs.
- Research may propose a hypothesis but cannot mutate hypothesis lineage outside the content decision loop.

## Production

`context/production-formats.json` is the sole owner of the global production gate and closed medium/format allowlist. New production requires `production_enabled: true` and one valid allowed pair. Before project or content-record creation, run:

```bash
python3 scripts/system_integrity.py --selected-medium <medium> --selected-format-id <format-id>
```

Every allowed format must have its format namespace, immutable used copywriting version, and designated raw reference evidence. References supply execution grammar, not wording, claims, production assets, or proof of transferability. Inspect all designated references and at most three relevant same-medium same-format projects before designing a new project.

The renderer receives an already selected medium, format, final copy, and content-specific composition. It owns editing, validation, storage, and rendering only. New native projects live at:

```text
renderer/<medium>/formats/<format-id>/contents/<format-id>-<project-name>.json
```

Validate the project, render the full artifact, inspect every slideshow page or representative video segment, repair defects, and only then create the publication-ready content record. Deliver exact slideshow PNGs in order or the exact video file. If AI-generated media is present, include a separate publisher-only note to enable TikTok's AI-generated-content setting.

Do not invent product features, user evidence, performance, scientific support, or private analytics. Use only product truth and accepted evidence. If a required fact, asset, or reference is missing, skip the slot and report the exact blocker.

## Measurement

`scripts/collect_due_content_results.py` is the sole collector for public 24h, 48h, and 72h post checkpoints. `scripts/collect_account_followers.py` owns public follower observations with a 24-hour freshness guard. `scripts/manual_analytics_store.py` owns typed requests and supplied TikTok Studio observations.

Public content metrics are observations, not audience qualification or attribution. Followers diagnose progress toward the current link-access constraint only. Never infer profile views, watch quality, audience composition, bio-link clicks, or App Store views from public engagement.

## Owners

| Owner | Responsibility |
| --- | --- |
| `AGENTS.md` | Objective, authority, phase contract, high-level operating loop, and ownership map |
| `docs/marketing-funnel.md` | Funnel, measurement contract, responsibility boundary, bottleneck diagnosis |
| `docs/hypothesis-loop.md` | Hypothesis decisions, lineage, delayed evidence, adoption |
| `docs/research-loop.md` | Research lifecycle and admission policy |
| `context/product.md` and `context/product-details/` | Product truth and supported structures |
| `context/imagery.md` | Current account-wide imagery policy |
| `context/production-formats.json` | Production gate and allowed medium/format identities |
| `messages/` | Versioned message strategies |
| format `copywriting/` and `imagery.md` | Format-specific language and visual grammar |
| format `references/` | Ordered raw execution evidence |
| renderer Project JSON and local assets | Retained content-specific execution |
| `db/hypothesis-loop.sqlite` | Hypotheses, content copy snapshots, publication, results, private observations |
| `db/research.sqlite` | Research lifecycle, provenance, accepted knowledge, notification outbox |
| `db/schema.sql`, `db/research-schema.sql` | Exact database structures and constraints |
| Hermes cron record | Exact schedules, prompts, skills, workdirs, delivery, runtime status |

Consumers reference these owners instead of restating their exact values or schemas.

## Engineering invariants

Every internal change must preserve:

1. **MECE coverage:** real cases are covered without overlapping authority.
2. **One owner:** every rule, datum, artifact, and transition has one final owner.
3. **Logical consistency:** affected producers, consumers, policy, runtime, and tests agree.
4. **Database accumulation:** growing evidence and history live in SQLite.

Prefer deleting duplication and obsolete paths over adding compatibility layers. This is a personal, non-deployed workspace.

Before mutation, gather the relevant owner and call-path context. Before reporting completion, run the focused tests, `npm run test`, `npm run build`, `python3 scripts/system_integrity.py`, database integrity/foreign-key checks, and an independent review. Commit and push only the verified final snapshot. Never commit credentials, runtime databases, local projects, assets, or rendered outputs.

## Keep it small

Do not add workflow builders, n8n, Docker orchestration, generic registries, prompt-composition frameworks, reusable visual templates, automatic TikTok publication, speculative taxonomies, or helper layers without repeated demonstrated need.
