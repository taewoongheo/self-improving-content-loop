import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const rendererRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(rendererRoot, "scripts/render-project.mjs");

test("render CLI rejects output outside the renderer renders directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-video-render-boundary-"));
  const projectPath = path.join(directory, "project.json");

  try {
    await writeFile(projectPath, JSON.stringify({
      type: "lift-code-video-project",
      version: 1,
      formatId: "diary-room",
      name: "Render boundary test",
      fps: 30,
      preset: { id: "tiktok_9_16" },
      clips: [],
      textLayers: [],
    }));
    const result = spawnSync(process.execPath, [
      cliPath,
      "--project",
      projectPath,
      "--out",
      path.join(directory, "video.mp4"),
    ], {
      cwd: rendererRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /renders directory/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("render CLI rejects a final output symlink outside the renderer renders directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-video-render-symlink-"));
  const projectPath = path.join(directory, "project.json");
  const targetPath = path.join(directory, "outside.mp4");
  const outputPath = path.join(rendererRoot, "renders", `${path.basename(directory)}.mp4`);

  try {
    await writeFile(projectPath, JSON.stringify({
      type: "lift-code-video-project",
      version: 1,
      formatId: "diary-room",
      name: "Render symlink test",
      fps: 30,
      preset: { id: "tiktok_9_16" },
      clips: [],
      textLayers: [],
    }));
    await writeFile(targetPath, "");
    await symlink(targetPath, outputPath, "file");
    const result = spawnSync(process.execPath, [
      cliPath,
      "--project",
      projectPath,
      "--out",
      outputPath,
    ], {
      cwd: rendererRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /renders directory/i);
  } finally {
    await rm(outputPath, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});
