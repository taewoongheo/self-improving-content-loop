# TikTok Studio Measurement Blockers

**Status:** Blocked work only. Start on the dedicated MacBook through the approved New York network environment; do not access TikTok or design export-derived storage from the current environment.

**Goal:** Obtain and inspect one real TikTok Studio Analytics export, implement only the normalized observations its verified semantics support, and activate the recurring production and collection jobs required to operate the loop.

---

## B1 — Prepare and migrate to the dedicated New York-environment MacBook

**Problem:** The real TikTok Studio export must be obtained without exposing the U.S./New York-targeted account to a Korean location signal, and the current workspace includes local Git-ignored runtime artifacts that may be required on the new MacBook.

**Required work:**

1. Configure the dedicated MacBook with the stable New York VPN endpoint, kill switch, no split tunneling, U.S. region, `en-US`, and `America/New_York`.
2. Before TikTok login, verify that IP, DNS, WebRTC, and IPv6 expose no Korean network signal.
3. Clone the tracked repository and reinstall dependencies from lockfiles; do not copy `node_modules`, caches, logs, temporary screenshots, `.DS_Store`, or process/lock files.
4. At cutover, copy only the current non-reproducible workspace state:
   - `db/hypothesis-loop.sqlite`;
   - ignored evidence under `renderer/*/formats/*/references/`;
   - retained Project JSON under `renderer/*/formats/*/contents/` and only their referenced local assets;
   - any still-required production assets under `renderer/*/public/assets/`.
5. Create a fresh `marketing-liftcode` Hermes profile on the new MacBook. Copy `SOUL.md`, `memories/MEMORY.md`, `memories/USER.md`, and the three local skills `marketing/organic-content-operations`, `marketing/product-marketing`, and `software-development/database-contract-verification`. Reinstall bundled skills normally.
6. Recreate profile configuration and authenticate providers, image generation, and gateway services on the new MacBook. Do not transfer the repository `.env`, profile `.env`, `auth.json`, session/state databases, caches, or history archives. There are currently no scheduled jobs to migrate.
7. Use one persistent TikTok-only browser profile and keep TikTok session/cookie data outside the repository.

**Completion condition:** The repository and required local runtime state execute on the dedicated MacBook, and TikTok Studio can be accessed through the approved New York environment without a detected leak.

**Safety stop:** Do not access TikTok Studio if any Korean IP, DNS, WebRTC, IPv6, locale, or timezone signal remains unresolved.

---

## B2 — Inspect a real TikTok Studio export

**Problem:** The actual export columns, identifiers, granularity, time semantics, and retention representation are unknown. Designing columns before seeing the export would be speculative.

**Required work:**

1. Export a representative Analytics period from TikTok Studio web on the dedicated MacBook.
2. Record the UI section, selected range, account timezone, export time, and file type.
3. Inventory every file/sheet and exact source column name.
4. Classify each field as account-level, content-level, viewer-level aggregate, snapshot, period value, or cumulative value.
5. Verify whether post identifiers map reliably to `contents.tiktok_url`.
6. Determine the actual availability and representation of:
   - views;
   - profile views;
   - average watch time;
   - completion rate;
   - retention/drop-off;
   - unique and returning viewers;
   - per-post new followers;
   - traffic sources and search terms.
7. Check nullability, rounding, percentage units, duplicate rows, locale-dependent numbers, attribution opacity, and timezone semantics.
8. Do not commit private account exports or preserve credentials/session data.

**Completion condition:** A bounded capability and field mapping is available from the real export. If stable identifiers or time semantics are absent, record the gap and stop instead of guessing a schema.

---

## B3 — Finalize and implement the minimum Studio measurement contract

**Trigger:** Start only after B2 is complete.

**Implementation constraints after the export is understood:**

1. Keep existing TikWM `content_results` checkpoints source-specific unless Studio observations share compatible windows and semantics.
2. Use a separate Studio observation owner when source meaning, update cadence, or granularity differs.
3. Keep account-level profile views separate from content-level observations.
4. Treat views as funnel-entry volume and watch time, completion, retention, engagement, viewer mix, and new followers as diagnostics.
5. Label ratios made from unjoined account/content aggregates as directional, never as user-level conversion rates.
6. Normalize only fields that answer a repeated operating decision; retain bounded raw source data only for provenance and import debugging.
7. Do not add a retention-curve representation unless the export supplies it and a repeated decision requires it.

**Implementation after approval:**

- add the minimal schema to `db/schema.sql`;
- add an offline, idempotent importer under `scripts/`;
- add matching schema and importer tests;
- update viewer queries only for approved operating outputs;
- update the measurement contract from verified source semantics.

**Importer requirements:**

- accept explicit export and database paths;
- make no TikTok network request;
- validate headers, units, dates, percentages, source keys, and post mappings before insertion;
- separate account and content observations;
- preserve windows and timezones;
- make repeated import idempotent;
- fail without a partial commit;
- never print or store credentials, cookies, or session data.

**Verification:**

- `node --test db/tests/schema.test.mjs`;
- `python3 -m unittest discover -s tests -p 'test_*.py'`;
- the existing viewer tests;
- `git diff --check`;
- confirmation that private exports, credentials, runtime databases, and generated local artifacts remain untracked.

---

## B4 — Activate recurring production and collection

**Trigger:** Start after B1 is complete and the collector contracts required by B3 are verified.

**Required work:**

1. Create the recurring content-production job under the `marketing-liftcode` profile using the user-authorized schedule, repository workdir, and Telegram delivery destination. The scheduler job remains the sole owner of exact run times.
2. Create one shared delayed-metric collector job for due 24h, 48h, and 72h public checkpoints. Do not create one collector per funnel event or content.
3. Keep TikTok Studio export manual. Run its offline importer only against an export produced on the dedicated MacBook; the scheduler must not log in to TikTok or automate Studio access.
4. Preserve the existing account-follower refresh cadence inside production operation rather than adding a duplicate follower job.
5. Do not add automatic TikTok publishing, recursive cron creation, catch-up content production outside an exact configured production minute, or duplicate delivery notifications.
6. Exercise each job once, verify its repository workdir, runtime database, delivery route, locking, and failure reporting, then confirm that no duplicate jobs are enabled.

**Completion condition:** `hermes --profile marketing-liftcode cron list --all` shows one enabled production job and one enabled delayed-metric collector job, their controlled verification runs succeed, and the complete content-to-measurement loop operates on the dedicated MacBook without automatic TikTok publication.
