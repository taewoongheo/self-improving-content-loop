# Research loop

## Purpose

The research loop investigates the highest-value unknown that could improve LIFT CODE's business purpose or the reliability of this marketing system. Each question states why it matters now and which decision credible evidence could change.

During prelaunch, research normally creates leverage by helping the target audience choose a suitable Program, judge whether it is working, or reduce recurring progression decisions, and by improving how that value is packaged and distributed. The exact product problem remains owned by `context/product.md`; these are priority applications, not a closed research taxonomy.

## MECE ownership model

Every research object has exactly one durable owner.

| Object | Owner | Not owned here |
| --- | --- | --- |
| Selection, routing, review, and admission policy | This document | Individual findings or sources |
| Runs, questions, sources, findings, review history, user quality feedback, adoption links, delivery outbox, and accepted structured knowledge | `db/research.sqlite` using `db/research-schema.sql` | Hypotheses, content results, exact media bytes |
| Product truth and current bounded brand context | Existing files under `context/` | External research history |
| Message and copywriting strategy | Versioned files under `messages/` and format `copywriting/` | Raw sources or general knowledge |
| Hypotheses, content identities, publication links, results, TikTok Studio requests, and supplied private observations | `db/hypothesis-loop.sqlite` | External-source knowledge |
| Raw format media and native content execution | The selected `renderer/<medium>/` namespace | Source metadata and review state |
| Exact schedule, delivery, workdir, and attached skills | Hermes cron job | Research policy or findings |

Markdown entrypoints such as `context/expertise.md`, `context/user-language.md`, and `context/marketing-methods.md` own bounded policy and retrieval instructions only. They must not accumulate evidence rows that are already owned by the Research DB.

## Open discovery, closed admission

Discovery may investigate any question with a plausible causal path to LIFT CODE revenue or reliable marketing operation. Automatic mutation remains limited to this marketing workspace and its decision rights. Internal owner-map and operating-model changes are autonomous under `AGENTS.md`; verify them under the four invariants and notify the user afterward.

For each run:

1. Read the current funnel diagnosis, launch constraints, active hypotheses, recent content/results, accepted Research DB knowledge, unresolved findings, and recent duplicate/no-finding decisions.
2. Generate candidate questions without selecting from fixed research categories.
3. Prefer questions that can improve a near-term content decision, audience understanding, standalone audience value, expression, or distribution; are materially uncertain and novel relative to stored evidence; and are answerable from credible sources at justified cost.
4. Select no more than three independent questions. The limit controls execution, not subject matter.
5. Investigate each selected question actively with the narrowest suitable live capabilities. Vary appropriate query formulations and source classes until the minimum evidence is met, credible sources are saturated, or a material limitation is established; preserve exact source URLs and limitations.
6. Record one bounded finding per question, or explicitly record `no_finding`, `outside_scope`, `duplicate`, or `failed`.
7. Never force a novel result into the nearest owner. When an in-scope result has no valid marketing owner and an internal owner-map change is the smallest complete remedy, create or restructure that owner autonomously, update every producer and consumer, validate the result, and route the finding to the resulting owner. Use `new_owner_proposal` only when a user-exclusive boundary blocks implementation.

Do not accumulate broad strength-training knowledge merely because credible information is available. A domain question must have a plausible route to the target problem, a near-term content need, or a current marketing decision. When accepted evidence is already sufficient, select zero questions rather than manufacturing work for a trigger.

Research may examine adjacent evidence only when it informs a marketing-owned decision. If the bounded result cannot route to a current valid marketing owner, close the question as `outside_scope` unless an internally authorized owner-map change is the smallest complete remedy. Apply that change autonomously before final routing. If a credential, permission, paid cost, destructive or irreversible change, out-of-scope decision, or unresolved trust or consistency risk blocks implementation, record `new_owner_proposal` and request only that exact user action. A proposal cannot silently change product, pricing, retention, or another non-marketing owner.

## Event triggers and concurrency

- **Content preflight (`content_preflight`):** every interactive or scheduled content cycle checks accepted evidence before making the content decision. It may select zero questions; external search starts only when a credible answer could materially change the content or hypothesis action.
- **Result review (`result_review`):** the shared collector starts research only after it inserts a new 24h, 48h, or 72h checkpoint. A no-op collector tick starts no agent. The run diagnoses what the observation can and cannot distinguish before researching the highest-value uncertainty.
- **Manual (`manual`):** an explicit interactive request may investigate a current marketing decision through the same lifecycle. A message containing only one or more internet URLs implicitly requests evaluation of those URLs as candidate knowledge, with no trigger phrase required. When substantive text accompanies a URL, that text defines the task instead.

`research_runs` owns a singleton lease across all triggers. A new trigger records `skipped` when an unexpired run is active, and an expired lease is failed before another run starts.

Each run starts through `scripts/research_store.py start-run` with the exact event trigger and a decision-specific objective. Every successful run finishes as `completed` or `failed`; a run cannot complete while a selected question is unresolved, and interruption is recovered by lease expiry.

Result-review evidence is diagnostic, not automatic causal attribution. Evaluate exposure/distribution variation, sample maturity, missing funnel metrics, message fit, copywriting, topic, and execution conditions before deciding whether external knowledge is missing. A 24h result is an early signal, 48h gives direction, and 72h is the more mature checkpoint; none alone proves a hypothesis.

## Evidence and deduplication

- Canonical source identities are globally unique. Tracking parameters and fragments are removed only from that identity key.
- `research_source_captures` preserves each access separately, including the original URL, resolved URL, observation time, retrieval method, and optional response status or content checksum. Mutable source evidence is never overwritten by a later access.
- Exact normalized findings are globally fingerprinted. A repeat becomes a `duplicate` question decision and may add genuinely new source support to the existing finding; it does not create a second fact.
- Every finding proposed for adoption must have at least one linked source and a bounded evidence note.
- Preserve contradiction and context links rather than treating every source as support.
- Public metrics, headlines, popularity, and one competitor example do not by themselves establish causality or generality.
- Source records own provenance. Structured knowledge owners reference the finding instead of copying citations into a second store.

### User-provided URL intake

Treat each URL-only message as candidate knowledge, not an instruction to adopt, a designated format reference, or a production asset. Inspect the original URL first and preserve its canonical URL and access capture. Never substitute a search snippet, repost, session history, or a description of the link for the accessible original. If the original cannot be inspected, finish with a plain-language access limitation and make no adoption decision about unseen contents.

After reading the original, split only its material reusable claims into bounded questions under the normal three-question limit. Actively investigate appropriate independent corroborating and contradicting sources before review; do not accept or reject a claim from the submitted URL alone. Judge source authority, directness, recency where material, scope, population or channel context, contradictions, and relevance to a valid LIFT CODE owner. User provision makes the material worth evaluating but does not establish truth, scientific support, prevalence, transferability, or practical safety.

Finish every assessed claim through the normal lifecycle as an adopted finding, duplicate, or not-adopted result (`no_finding`, `outside_scope`, failed verification, or rejected review). Persist the user URL and all material corroborating or contradicting sources with the same provenance rules as autonomous research. Return a concise plain-language decision and reason; do not expose internal labels or require the user to know the trigger or routing model.

## Review and admission

Research admission is always autonomous under standing user authorization. There is no per-finding user-approval mode or mutable authorization flag.

1. The agent reviews every bounded finding first and records one immutable decision with its rationale. A review is not adoption.
2. A supported finding may be adopted only into its exact recorded valid owner. Resolve owner availability before finalizing the finding route: when an internally authorized owner-map change is needed, create or restructure the owner, update every producer and consumer, validate it, then record the supported finding against the resulting valid owner and adopt it.
3. Adoption is a separate immutable receipt. It must match the finding's route, exactly one final owner, and the materialized owner state.
4. After each event run, Telegram receives only the key user-facing result. Internal IDs, lifecycle outcomes, owners, and provenance remain in SQLite.
5. New internal owners and structural or operating-model changes are autonomous when they satisfy the four invariants. Credentials or permissions, paid access, destructive or irreversible data changes, out-of-scope decisions, and unresolved account-trust or consistency risks remain separate Telegram action requests and are never represented as adoptions.
6. Content creation, publication, and hypothesis decisions retain their separate contracts; research admission does not bypass them.
7. Validate the final owner and adoption receipt. Repository verification, commit, and push follow the single autonomous engineering contract in `AGENTS.md`.

If the user later says a notified finding is wrong or should not be used, inspect the live finding, sources, adoption, and current owner before changing anything. Remove the materialized structured owner entry or raw-reference designation, or correct the tracked owner first, then record an immutable `research_withdrawals` receipt through `scripts/research_store.py withdraw`. A user-directed withdrawal must preserve the user's actual reason and a non-secret transport-bound actor-evidence reference. Never rewrite or delete the original finding, review, adoption, or source provenance. An unadopted proposal rejected after user feedback receives a new agent review whose rationale cites that feedback without falsely attributing the review to the user.

`research_notifications` is the durable outbox for adopted owner changes and approved blocked proposals. Adoption and each approved proposal revision enqueue one notification in the same transaction as their state change. Withdrawal cancels an undelivered adoption notification; a later proposal review cancels undelivered older revisions. Each event's attempt token includes the scheduler job ID. At the start of a later event, reconcile a `dispatching` attempt only against that job's unambiguous previous `last_status`, `last_delivery_error`, and `last_run_at`; mark it delivered with a non-secret scheduler receipt or failed so it remains retryable. Never resolve the current event's attempt in the same run.

`research_quality_feedback` is the immutable owner of the user's evaluation of a whole run or one finding. Record `useful`, `weak_evidence`, `irrelevant`, `overstated`, or `correction` with the actual rationale and a non-secret Telegram evidence reference. Later runs read recurring feedback patterns to improve question selection, source sufficiency, scope, and admission. Feedback never rewrites the historical finding or agent review; `correction` also requires the exact withdrawal/correction workflow when materialized knowledge must change.

A `new_owner_proposal` is evidence for a missing or changed owner contract whose implementation is blocked by a user-exclusive credential or permission, paid cost, destructive or irreversible change, out-of-scope decision, or unresolved trust or consistency risk. It records the smallest owner contract, why the current structure is insufficient, what it replaces, and the exact blocked action; the proposal itself is not adoptable. After the blocker is resolved, materialize and validate the change first, then record a supported finding against the resulting valid owner.

## Admission routing

Route by what the accepted result changes, not by the query's topic.

| Accepted result | Final owner |
| --- | --- |
| Reusable strength-training fact | `expertise_entries` |
| Reusable external marketing mechanism or method | `marketing_method_entries` |
| Traceable audience expression | `audience_language_entries` |
| Raw format execution evidence | Media under renderer references plus `format_reference_entries` metadata |
| Current product fact or bounded context correction | Existing canonical context file, linked by `research_adoptions` |
| Message/copywriting strategy worth testing | Confirmed hypothesis/version owner, linked by `research_adoptions` |
| Operating procedure | `AGENTS.md`, this document, or a reusable skill, linked by `research_adoptions` |
| Missing responsibility | Create or restructure the smallest complete internal owner autonomously, then route to it; use `new_owner_proposal` only for a user-exclusive blocker |
| Outside marketing responsibility | `outside_scope` question outcome; no finding or owner |
| Unsupported or immaterial result | Rejected review; no final owner |

One finding has one adoption row. If one source supports several independent facts, create several bounded findings linked to the same source. If one finding appears to require several final owners, split it before review.

## Retrieval before use

The database is not automatically in model context. Before content or strategy work, query only the accepted owners relevant to the current decision. Do not load the entire research history or raw source bodies.

Examples:

```bash
sqlite3 -json db/research.sqlite \
  "SELECT * FROM expertise_entries WHERE topic LIKE '%progression%';"

sqlite3 -json db/research.sqlite \
  "SELECT * FROM marketing_method_entries WHERE application_context LIKE '%TikTok%';"

python3 scripts/research_store.py pending
```

A missing accepted entry means the project has not admitted that knowledge; it does not prove the claim false.

## Event response and system integrity

- Reconcile prior delivery attempts before starting and return one brief Korean update for every completed event run.
- A result update has at most three short bullets: newly observed key metrics, their plain-language meaning, and the one next decision—or that there is not yet enough evidence to change it.
- Keep IDs, trigger names, database outcomes, owner names, file paths, integrity terminology, routine execution detail, and feedback labels out of Telegram. Accept natural-language quality feedback and map it to the stored labels internally.
- If a private TikTok Studio observation materially blocks the decision, use `scripts/manual_analytics_store.py` to create or reuse a request and append one concise line with the exact metric, scope, window, Studio location, and decision purpose.
- If user action is required because of credentials, cost, source access, a destructive data change, an out-of-scope decision, or a blocked owner proposal, return one concise action request.
- A result-review run does not create content. A content-preflight run may continue into the separately authorized content lifecycle but cannot publish to TikTok.

`scripts/system_integrity.py` supplies structural failures and operational-health warnings before mutation. Event research diagnoses warnings from live context and separately inspects semantic ownership, consistency, lifecycle reliability, and missing capabilities. Structural failures block the cycle; warnings identify possible stagnation, missing transitions, accumulation failures, or unexplained concentration without imposing mechanical diversity or volume quotas.
