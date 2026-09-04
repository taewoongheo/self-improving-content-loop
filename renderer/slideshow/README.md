# Slideshow Renderer

This package edits, validates, stores, and renders native slideshow projects. It does not choose the message, medium, format, copy, or visual direction. Those decisions belong to the content workflow in the repository `AGENTS.md`.

The editor implementation is based on [`taewoongheo/image-slideshow`](https://github.com/taewoongheo/image-slideshow) commit `184c58be75a3971bee7925fd34cf67cf5edddf52`. This package keeps the repository-specific format namespace, validation, storage, and render CLI contracts described below; upstream sample projects and assets are not production inputs.

## Format boundary

Every usable slideshow format is a namespace with this shape:

```text
formats/<format-id>/
├── copywriting/
│   └── v<version>.md
├── references/
└── contents/
```

- `copywriting/` owns versioned format-specific language grammar.
- `references/` owns user-designated raw slideshow execution evidence.
- `contents/` stores local editable projects generated in that format.
- A format directory is not a reusable coordinate template and contains no reusable Project JSON.

A stored project must use the same lowercase `formatId` as its containing format directory. Projects belong only under `formats/<format-id>/contents/` and are Git-ignored.

## Project and validation contract

A native slideshow project has type `tiktok-slide-project`. It owns its complete slide count and order, canvas, editable layers, typography, geometry, colors, crops, and image bytes.

`src/projectValidation.ts` is the sole runtime safety owner for accepted Project JSON. The editor loader, storage middleware, and render CLI consume that validation instead of restating limits.

## Commands

Run from `renderer/slideshow/`:

```sh
npm install
npm run dev
npm run build
npm run render -- --project <project.json> --out <directory>
```

The render command writes ordered slide PNGs and a contact sheet to the output directory.

## Integration contract

The content workflow supplies an already selected format, approved copy, and complete content-specific composition. This package returns a validated native Project and its rendered slides. It does not read or write hypothesis, message, publication, or performance records.

Local projects may later be pruned under `AGENTS.md`. Their DB path and hash remain provenance but do not reconstruct deleted bytes.
