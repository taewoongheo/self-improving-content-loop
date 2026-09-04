# Self-Improving Content Loop

A reusable content loop that uses research and observed performance to improve future content decisions. LIFT CODE is its first application: during prelaunch, the current configuration builds a relevant U.S. strength-training audience with standalone TikTok content that neither promotes the unreleased app nor asks the audience to act.

## Flow

```text
funnel observations
→ nearest actionable constraint
→ only necessary research
→ one message or copywriting hypothesis
→ one validated slideshow or video
→ manual TikTok publication
→ 24h / 48h / 72h results
→ continue, branch, close, or adopt the hypothesis
```

The agent owns every internal decision, implementation change, render, repository commit, and scheduler adjustment. The user only publishes to TikTok, returns the URL, and handles credentials, spend, destructive external actions, or account-trust decisions.

## Operating model

- `docs/marketing-funnel.md` defines the funnel and how the current bottleneck is diagnosed.
- `docs/hypothesis-loop.md` defines message/copywriting hypotheses and delayed learning.
- `docs/research-loop.md` defines bounded event-driven research and admission.
- `context/production-formats.json` enables or pauses new production and lists the only formats eligible for publication-ready output.
- `db/hypothesis-loop.sqlite` stores hypotheses, content, publication, results, and private analytics observations.
- `db/research.sqlite` stores research provenance and accepted reusable knowledge.
- Hermes cron records own exact schedules, prompts, workdirs, delivery, and runtime status.

New production and delayed measurement are independent. Pausing production never pauses result collection for already published content. Expired research leases are recovered by the next research run instead of permanently blocking automation.

## Main commands

```bash
npm run test
npm run build
python3 scripts/system_integrity.py
python3 scripts/system_integrity.py \
  --selected-medium <medium> \
  --selected-format-id <format-id>
python3 -m viewer.hypothesis_tree.app
```

## Main owners

| Owner | Responsibility |
| --- | --- |
| `AGENTS.md` | Objective, authority, launch contract, high-level loop, owner map |
| `context/product.md` | Product truth and target audience |
| `context/imagery.md` | Account-wide imagery policy |
| `context/production-formats.json` | Production gate and format allowlist |
| `messages/` | Versioned message strategies |
| `renderer/<medium>/formats/<format-id>/` | Format grammar, references, and local projects |
| `scripts/research_store.py` | Sole Research DB lifecycle writer |
| `scripts/collect_due_content_results.py` | Due public post checkpoints |
| `scripts/collect_account_followers.py` | Freshness-guarded follower observations |
| `scripts/manual_analytics_store.py` | Typed TikTok Studio requests and observations |
| `scripts/system_integrity.py` | Deterministic structural and operational checks |

Runtime databases, credentials, editable projects, production assets, reference media, and renders are local and Git-ignored. TikTok publication is never automated.
