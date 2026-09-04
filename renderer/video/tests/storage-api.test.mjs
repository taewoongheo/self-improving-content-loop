import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "vite";

const rendererRoot = path.resolve(import.meta.dirname, "..");

async function withServer(run) {
  const server = await createServer({
    root: rendererRoot,
    configFile: path.join(rendererRoot, "vite.config.ts"),
    logLevel: "silent",
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    assert.ok(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await server.close();
  }
}

test("storage middleware owns project, asset, and render routes", async () => {
  const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
  assert.match(source, /\/api\/projects/);
  assert.match(source, /\/api\/assets/);
  assert.match(source, /\/api\/render/);
  assert.match(source, /\/api\/renders\//);
  assert.match(source, /normalizeVideo/);
  assert.match(source, /fps=30/);
  assert.match(source, /filename\*=UTF-8/);
  assert.doesNotMatch(source, /\^\[a-z0-9-\]\+/);
  assert.match(source, /\.mp3/);
  assert.match(source, /\.m4a/);
});

test("video storage is scoped by the validated project format", async () => {
  const source = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");

  assert.match(source, /formatsDirectory/);
  assert.match(source, /getContentsDirectory\(project\.formatId\)/);
  assert.match(source, /Unknown format:/);
  assert.match(source, /\/api\/projects\//);
  assert.match(source, /getContentsDirectory\(formatId\)/);
  assert.doesNotMatch(source, /path\.join\(root, "contents"\)/);
});

test("video storage API rejects cross-origin browser mutations", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Origin: "https://attacker.example",
      },
      body: "{}",
    });

    assert.equal(response.status, 403);
  });
});

test("video storage API reports invalid project input as a client error", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    assert.equal(response.status, 400);
  });
});

test("video storage API reports malformed JSON as a client error", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });

    assert.equal(response.status, 400);
  });
});

test("video storage API rejects a normalized project larger than its readable limit", async () => {
  const formatId = `test-size-${process.pid}`;
  const formatRoot = path.join(rendererRoot, "formats", formatId);
  await mkdir(formatRoot, { recursive: true });
  try {
    await withServer(async (origin) => {
      const name = "oversized-normalized-project";
      const project = {
        type: "lift-code-video-project",
        version: 1,
        formatId,
        name,
        fps: 30,
        preset: { id: "tiktok_9_16" },
        clips: [],
        textLayers: Array.from({ length: 100 }, (_, index) => ({
          id: `text-${index}`,
          text: "x".repeat(20_800),
        })),
      };
      const body = JSON.stringify(project);
      assert.ok(Buffer.byteLength(body) < 2 * 1024 * 1024);

      try {
        const response = await fetch(`${origin}/api/projects`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        assert.equal(response.status, 413);
      } finally {
        await fetch(`${origin}/api/projects/${encodeURIComponent(formatId)}/${name}`, {
          method: "DELETE",
        });
      }
    });
  } finally {
    await rm(formatRoot, { recursive: true, force: true });
  }
});

test("render CLI consumes the shared project validator", async () => {
  const source = await readFile(new URL("../scripts/render-project.mjs", import.meta.url), "utf8");

  assert.match(source, /normalizeProject/);
  assert.doesNotMatch(source, /project\.type !== "lift-code-video-project"/);
});

test("video editor selects a format and sends it through project lifecycle requests", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(source, /fetch\("\/api\/formats"\)/);
  assert.match(source, /project\.formatId/);
  assert.match(source, /encodeURIComponent\([^)]*\.formatId\)/);
  assert.match(source, /formatId: saved\.formatId/);
});
