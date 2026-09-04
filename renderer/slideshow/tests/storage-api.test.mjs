import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";

import { createServer } from "vite";

import { MAX_PROJECT_BYTES } from "../src/projectValidation.ts";

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

test("storage API rejects remote project images", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/contents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tiktok-slide-project",
        version: 2,
        formatId: "denzel",
        name: "Unsafe remote image",
        slides: [{
          canvas: { width: 320, height: 400 },
          layers: [{ type: "image", src: "http://127.0.0.1/private" }],
        }],
      }),
    });

    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /image source/i);
  });
});

test("storage API rejects cross-origin browser mutations", async () => {
  await withServer(async (origin) => {
    const response = await fetch(`${origin}/api/contents`, {
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

test("storage API rejects oversized content lengths before reading the body", async () => {
  await withServer(async (origin) => {
    const url = new URL("/api/contents", origin);
    const response = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Length": String(MAX_PROJECT_BYTES + 1),
          "Content-Type": "application/json",
        },
      }, resolve);
      request.on("error", reject);
      request.end();
    });

    assert.equal(response.statusCode, 413);
    response.resume();
  });
});

test("storage API rejects a serialized project that exceeds the byte limit", async () => {
  const formatId = `test-size-${process.pid}`;
  const formatRoot = path.join(rendererRoot, "formats", formatId);
  await mkdir(formatRoot, { recursive: true });
  try {
    await withServer(async (origin) => {
      const project = {
        type: "tiktok-slide-project",
        version: 2,
        formatId,
        name: "Near limit",
        slides: [{
          canvas: { width: 320, height: 400 },
          layers: [{ type: "text", text: "" }],
        }],
      };
      const compactBytes = Buffer.byteLength(JSON.stringify(project));
      project.slides[0].layers[0].text = "x".repeat(MAX_PROJECT_BYTES - compactBytes - 1);
      const body = JSON.stringify(project);
      assert.equal(Buffer.byteLength(body), MAX_PROJECT_BYTES - 1);

      const response = await fetch(`${origin}/api/contents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

      assert.equal(response.status, 413);
      assert.match((await response.json()).error, /stored content/i);
    });
  } finally {
    await rm(formatRoot, { recursive: true, force: true });
  }
});
