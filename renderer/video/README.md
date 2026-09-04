# Video Renderer

This package edits, validates, stores, and renders native video projects. It does not choose the message, medium, format, copy, or audiovisual direction. Those decisions belong to the content workflow in the repository `AGENTS.md`.

## Format boundary

Every usable video format is a namespace with this shape:

```text
formats/<format-id>/
├── copywriting/
│   └── v<version>.md
├── references/
└── contents/
```

- `copywriting/` owns versioned format-specific language grammar.
- `references/` owns user-designated raw video or ordered-frame execution evidence.
- `contents/` stores local editable projects generated in that format.
- A format directory is not a reusable scene or timeline template and contains no reusable Project JSON.

A content-loop Project must use the same lowercase `formatId` as its containing format directory. Publication-ready projects belong only under `formats/<format-id>/contents/` and are Git-ignored. Uploaded production media remains local under `public/assets/`; assets may be removed only when no retained project references them.

## Project and validation contract

A native video project has type `lift-code-video-project`. It owns its canvas and fps, clip order and trims, crop and fit, text-layer geometry and timing, audio layers and levels, and references to local production assets.

`src/projectValidation.ts` is the sole runtime safety owner for accepted Project JSON. The editor loader, storage middleware, and render CLI must consume that validation instead of restating limits.

## Requirements and commands

The renderer requires Node.js dependencies and `ffmpeg`/`ffprobe` for media inspection, normalization, and MP4 rendering.

Run from `renderer/video/`:

```sh
npm install
npm run dev
npm run build
npm run render -- --project <project.json> --out <video.mp4>
```

## Integration contract

The content workflow supplies an already selected format, approved on-screen and spoken copy, complete content-specific composition, and required production assets. This package returns a validated native Project and its rendered MP4. It does not read or write hypothesis, message, publication, or performance records.

Local projects and unreferenced assets may later be pruned under `AGENTS.md`. Their DB path and hash remain provenance but do not reconstruct deleted bytes.
