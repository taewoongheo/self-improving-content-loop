# User language

This file defines the policy and retrieval contract for audience language. Unbounded expressions and their source links live in `audience_language_entries` and the associated finding/source rows in `db/research.sqlite`.

The entries are expressions from public sources, often competitor communities or reviews, not statements from LIFT CODE users. Treat them as evidence that a situation was expressed, not proof of prevalence, market size, product fit, willingness to pay, or LIFT CODE performance.

## Provenance limits

- These expressions may describe genuine frustrations and desired outcomes, but they do not establish how common those experiences are.
- They do not validate LIFT CODE's planned implementation, recommendation quality, usability, or willingness to pay.
- Do not present them as testimonials, quote them as LIFT CODE customer language, or remove the competitor-community context when provenance matters.
- Additional language collection should prioritize U.S.-English male lifters who train alone, use an existing Workout or need a Program, and actively discuss next-weight or progression decisions.

## Retrieval contract

Query only expressions relevant to the selected audience situation:

```bash
sqlite3 -json db/research.sqlite \
  "SELECT finding_id, expression, situation, source_context, target_fit FROM audience_language_entries WHERE situation LIKE '%progression%';"
```

Open the linked source and finding rows when exact provenance or interpretation limits matter. Message strategy may interpret admitted expressions but must not become a second owner of the wording or source.