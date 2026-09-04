# Marketing Funnel Operating Model

This document owns the marketing-funnel stages, measurement contract, responsibility boundary, and bottleneck-selection model. `AGENTS.md` owns the agent operating contract, `docs/hypothesis-loop.md` owns hypothesis lineage and delayed evidence, and `db/schema.sql` owns exact storage.

## Objective and responsibility

```text
Ultimate business purpose
└── Increase LIFT CODE app revenue
    └── Direct responsibility of this marketing workspace
        └── Increase qualified App Store inflow
            └── Operating objective
                └── Repeatedly identify and improve the funnel bottleneck
                    that most limits qualified App Store inflow
```

Revenue is the reason this workspace exists, but it is not the result that marketing alone controls. Download conversion, activation, retention, pricing, and payment also depend on the product and App Store presence. This workspace directly owns marketing through qualified arrival at the App Store product page. Downstream outcomes may be read as feedback about traffic quality and message-market fit, but they do not make this workspace solely responsible for revenue.

**Qualified App Store inflow** means App Store product-page views attributable to a LIFT CODE-operated marketing path whose source content targets the primary audience in `context/product.md` and whose latest available aggregate audience evidence supports U.S. target-market relevance. Attribution and qualification are separate dimensions: path or campaign attribution establishes the source of a product-page view, while account- or channel-level audience evidence supports target relevance. If that audience evidence is unavailable or materially contradictory, report `attributed App Store inflow`, not `qualified App Store inflow`. Unless a source directly joins those dimensions, do not claim that an individual visitor was qualified.

During prelaunch there is no operational App Store path, so qualified App Store inflow is not applicable. Audience-fit evidence collected now prepares the channel for later acquisition but is not itself App Store inflow. Downloads, activation, retention, payment, and revenue remain downstream quality feedback rather than part of the marketing-owned conversion.

## Funnel

The acquisition funnel contains only user events:

```text
TikTok content view
→ TikTok profile view
→ bio-link click
→ App Store product-page view
```

The three transitions are:

```text
profile views ÷ content views
bio-link clicks ÷ profile views
product-page views ÷ bio-link clicks
```

Calculate a conversion rate only when its numerator and denominator have compatible windows, scope, and event semantics. A ratio between unjoined account-level and content-level aggregates is directional, not user-level attribution.

The current 1,000-follower requirement is a channel-access constraint on exposing the bio link, not a funnel event or independent goal. Likes, comments, shares, saves, watch quality, retention, follows, and audience composition are diagnostics. They may explain an event or transition but must not be inserted as extra funnel steps or collapsed into an unsupported composite score.

Downloads, activation, retention, payment, and revenue are downstream product outcomes. They provide quality feedback after the marketing handoff but do not extend the acquisition funnel owned here.

## Bottleneck diagnosis

The bottleneck is the observable transition or enabling constraint whose improvement is currently expected to produce the largest meaningful increase in qualified App Store inflow. It is not mechanically the lowest reported conversion rate.

For every production cycle that has new relevant evidence, the assistant evaluates:

1. **Causal position:** whether the stage actually limits progress to App Store inflow.
2. **Volume:** whether enough people reach the stage for a downstream conversion rate to be meaningful.
3. **Evidence quality:** whether the metric directly observes the stage or is only a proxy.
4. **Actionability:** whether the assistant can change a marketing output that plausibly affects it now.
5. **Expected leverage:** the likely effect on qualified App Store inflow, not only on the local metric.
6. **Launch and channel constraints:** whether later stages currently exist and can be acted on.
7. **Confounders:** topic, publication conditions, attribution gaps, product readiness, and other plausible causes.
8. **Downstream quality:** whether improving the stage appears compatible with later product and revenue outcomes when those observations exist.

A missing metric is a measurement gap, not automatic proof that the corresponding stage is the bottleneck. Add instrumentation only when the missing observation prevents a meaningful decision about the nearest actionable constraint.

The current diagnosis is recomputed from normalized observations each production cycle; SQLite does not store a second durable diagnosis record. The observations remain in their source tables, while each new hypothesis stores one immutable `decision_reason` explaining why the diagnosis, evidence, and limitations justified that action at creation time. Account-level observations may inform the diagnosis without becoming direct evidence that one content caused the account-level change.

## Phase-aware operation

The product is pre-development and unreleased. Current TikTok content does not mention or promote the app or its planned capabilities and contains no audience-facing call to action, including prompts to follow, visit the profile, comment, save, share, or take another next step. Each post must deliver standalone value without asking the audience to act. Bio-link clicks, App Store product-page views, and their conversion rates are therefore not yet applicable.

Current event applicability is:

- content views and profile views may occur;
- bio-link clicks and App Store product-page views are inactive, not zero;
- the 1,000-follower link requirement is an enabling constraint, not a conversion;
- useful strength-training content must preserve target-audience relevance while improving the nearest observable and actionable constraint;
- engagement and follower movement remain diagnostics and cannot be reported as downstream acquisition.

## Measurement contract

Every admitted funnel observation must identify:

- the exact event or count observed;
- its funnel stage;
- numerator and denominator when a rate is calculated;
- collection source and timestamp/window;
- attribution scope;
- whether it is a direct measure or proxy;
- missing dimensions and known limitations;
- whether the stage is currently applicable and actionable.

Never infer an unavailable event by silently substituting another metric. Keep observations separate from interpretations and from the current bottleneck judgment.

### Current capability matrix

| Type | Event or diagnostic | Current normalized observation | Operational limit |
| --- | --- | --- | --- |
| Funnel event | TikTok content view | `content_results.views` at 24h, 48h, and 72h | Public cumulative counter; does not establish audience qualification or message consumption |
| Funnel event | TikTok profile view | `manual_analytics_observations` when supplied from TikTok Studio | Request the exact scope and window through Telegram when this observation blocks a decision; otherwise keep the measurement gap |
| Funnel event | Bio-link click | Inactive | No operational App Store path during prelaunch |
| Funnel event | App Store product-page view | Inactive | No operational App Store destination during prelaunch |
| Channel diagnostic | Followers | `account_results.followers` | Progress toward the reported link-access constraint only |
| Content diagnostics | Likes, comments, shares, saves | `content_results` at 24h, 48h, and 72h | Separate response signals; interpretation must match the tested hypothesis |
| Content diagnostics | Watch depth, completion, retention, per-post follows | `manual_analytics_observations` when supplied from TikTok Studio | Request only the metric, scope, and window needed for the current decision; do not infer from public views or engagement |
| Audience diagnostic | Viewer and follower composition | `manual_analytics_observations` when supplied from TikTok Studio | Preserve the reported breakdown, source evidence, window, and limitations |

For a needed private observation, create or reuse a pending `measurement_requests` row through `scripts/manual_analytics_store.py`, then ask through Telegram for the exact metric, account/content scope, reporting window, TikTok Studio location, and decision it unlocks. Record the supplied value and Telegram evidence through the same writer, which fulfills the request atomically. Do not repeat a matching pending request.

Add only the narrowest reliable source needed for the current decision. New credentials, external cost, privacy impact, or structural changes remain subject to the project authorization rules.

## Relationship to hypothesis evidence

Content metrics may directly support or contradict a message/copywriting hypothesis only when they observe the response named in that hypothesis with adequate comparison quality. Account and funnel observations can determine which bottleneck deserves attention without becoming direct evidence that one content caused the account-level change.

Examples:

- Follower growth can show movement toward link access but cannot identify which content or axis caused it by itself.
- Saves may support a utility-oriented expected response but do not directly measure profile views or App Store product-page views.
- Profile views observe the second event but do not prove bio-link clicks.
- Product-page views measure inflow only within their stated attribution scope; unattributed traffic cannot be credited to TikTok or a hypothesis.

When the available metric is only a proxy, the hypothesis statement, interpretation, and limitations must say so.