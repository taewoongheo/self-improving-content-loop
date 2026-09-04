# Expertise

## Purpose

This file defines the project-wide policy and retrieval contract for strength-training domain knowledge used to create accurate and useful LIFT CODE content. Unbounded admitted entries live in `expertise_entries` in `db/research.sqlite` and are not tied to one format, message, or post.

Read this file first, then query only the relevant accepted database entries before creating content that uses strength-training facts or advice.

## Ownership boundary

This file owns:

- the ownership, evidence, and content-use rules for strength-training domain knowledge;
- the map of useful collection areas;
- the required database retrieval and use contract.

`expertise_entries` in `db/research.sqlite` owns:

- admitted strength-training facts and mechanisms that can inform content across formats and platforms;
- their provenance and evidence status;
- practical meaning, scope conditions, exceptions, and safe content-use limits;
- corrections when stronger evidence becomes available;
- links through the originating finding to source provenance and review history.

This file does not own:

- LIFT CODE capabilities, implementation status, positioning, or claim boundaries: `context/product.md`;
- raw audience expressions and their provenance: `audience_language_entries` in `db/research.sqlite`;
- the target situation, belief shift, and persuasion logic being tested: `messages/`;
- wording, hook, progression, CTA, title, or caption rules: format copywriting versions;
- image direction: `context/imagery.md`;
- final post copy or visual composition: the content record and project;
- performance observations or hypothesis interpretations: `db/hypothesis-loop.sqlite`.

A domain fact belongs in one `expertise_entries` row even when it is first discovered while producing one format. A format may decide how to express relevant expertise, but it must not become a second owner of the underlying knowledge.

## Evidence rules

- Record a source or explicit provenance for every externally checkable factual claim.
- Distinguish direct research, systematic review or position stand, professional guidance, practitioner consensus, product-design assumption, and explicitly user-provided practical material.
- A URL-only user message enters the candidate-knowledge workflow in `docs/research-loop.md`. Explicit user provision establishes relevance for review, but adoption still requires original-source inspection and active investigation of independent corroborating or contradicting evidence; it does not turn the material into verified scientific evidence.
- Describe what the source supports, not what a headline or secondary summary implies.
- Preserve material limitations, population, training status, exercise context, measurement uncertainty, and meaningful exceptions.
- Do not use `science-backed`, `proven`, `optimal`, `safe`, or equivalent authority language unless the cited evidence supports that exact scope.
- Do not convert an engagement result, audience comment, competitor feature, product requirement, or message hypothesis into domain expertise.
- Do not provide diagnosis, injury treatment, rehabilitation, or individualized medical advice.
- When evidence conflicts, state the disagreement and usable boundary instead of manufacturing one universal rule.
- Correct active knowledge in place when it is wrong or materially incomplete. Preserve superseded provenance only when needed to explain a live disagreement or content limitation.

## Content-use rules

- Use only entries relevant to the selected message and audience situation.
- Keep the content claim narrower than or equal to the supporting expertise entry.
- Translate technical knowledge into an observable training decision or consequence without overstating certainty.
- Domain advice introduced in copy must be traceable to an admitted `expertise_entries` row. Product facts and audience language remain traceable to their separate owners.
- Absence from `expertise_entries` is not evidence that a claim is false; it means the project has not yet admitted that claim as reusable expertise.
- If valid content requires missing domain knowledge, run the research loop and admit the bounded entry before drafting rather than importing an ad-hoc tip directly into copy.

## Current knowledge state

The live knowledge state is the current set of `expertise_entries`; do not restate its count here. When no relevant row exists, content may still use verified product truth, sourced audience language, and explicitly framed message hypotheses from their existing owners, but it must not present unsourced training guidance as expert fact.

## Knowledge map

These are collection areas, not approved claims:

- progression models and load-or-rep adjustment;
- RIR meaning, use, and reporting uncertainty;
- exercise-specific progression constraints;
- free-weight, machine-stack, plate, and micro-load increments;
- autoregulation and same-session adjustment;
- fatigue, maintenance, reduction, deload, and missed-target handling;
- rep ranges and strength or hypertrophy programming context;
- warm-up Set selection and load calculation;
- Rep Tempo, cadence, and practical cueing;
- Estimated 1RM equations, comparison use, and limitations;
- training Volume and Set-count interpretation;
- Program adherence, logging friction, and progression decision burden.

## Retrieval contract

Query accepted entries by the current training topic rather than loading the whole research history:

```bash
sqlite3 -json db/research.sqlite \
  "SELECT finding_id, topic, claim, mechanism, practical_application, scope_conditions, limitations, evidence_status, content_use FROM expertise_entries WHERE topic LIKE '%progression%';"
```

Open the linked `research_findings` and `research_finding_sources` rows only when checking provenance, limitations, contradiction, or a claim correction. Do not load full papers or unrelated research records into content reasoning.
