import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const rendererRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(rendererRoot, "scripts/render-project.mjs");

test("render CLI documents its project JSON and output arguments", () => {
  const result = spawnSync(process.execPath, [cliPath, "--help"], {
    cwd: rendererRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--project/);
  assert.match(result.stdout, /--out/);
});

const pngDimensions = (payload) => ({
  width: payload.readUInt32BE(16),
  height: payload.readUInt32BE(20),
});

test("render CLI rejects project JSON without a format identity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-render-cli-format-test-"));
  const projectPath = path.join(directory, "project.json");

  try {
    await writeFile(projectPath, JSON.stringify({
      type: "tiktok-slide-project",
      version: 2,
      slides: [{ name: "Slide 1", layers: [] }],
    }));
    const result = spawnSync(process.execPath, [
      cliPath,
      "--project",
      projectPath,
      "--out",
      path.join(directory, "rendered"),
    ], {
      cwd: rendererRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /format/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("render CLI rejects output outside the renderer renders directory", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-render-boundary-test-"));
  const projectPath = path.join(directory, "project.json");

  try {
    await writeFile(projectPath, JSON.stringify({
      type: "tiktok-slide-project",
      version: 2,
      formatId: "denzel",
      name: "Render boundary test",
      slides: [{ name: "Slide 1", layers: [] }],
    }));
    const result = spawnSync(process.execPath, [
      cliPath,
      "--project",
      projectPath,
      "--out",
      path.join(directory, "rendered"),
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-render-symlink-test-"));
  const projectPath = path.join(directory, "project.json");
  const outputDirectory = path.join(rendererRoot, "renders", path.basename(directory));

  try {
    await writeFile(projectPath, JSON.stringify({
      type: "tiktok-slide-project",
      version: 2,
      formatId: "denzel",
      name: "Render symlink test",
      slides: [{ name: "Slide 1", layers: [] }],
    }));
    await symlink(directory, outputDirectory, "dir");
    const result = spawnSync(process.execPath, [
      cliPath,
      "--project",
      projectPath,
      "--out",
      outputDirectory,
    ], {
      cwd: rendererRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /renders directory/i);
  } finally {
    await rm(outputDirectory, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("render CLI creates exact-size slide PNGs and a contact sheet from project JSON", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lift-code-render-cli-test-"));
  const projectPath = path.join(directory, "project.json");
  const outputDirectory = path.join(rendererRoot, "renders", path.basename(directory));

  try {
    await writeFile(projectPath, JSON.stringify({
      type: "tiktok-slide-project",
      version: 2,
      formatId: "denzel",
      id: "render-cli-test",
      name: "Render CLI test",
      slides: [{
        id: "slide-1",
        name: "Test slide",
        canvas: { id: "test", name: "Test", width: 320, height: 400 },
        background: { type: "color", fill: "#ffffff" },
        layers: [
          {
            type: "shape",
            shape: "rectangle",
            name: "Card",
            x: 16,
            y: 24,
            width: 288,
            height: 112,
            fill: "#26e07f",
            borderRadius: 18,
            rotation: 12,
          },
          { type: "text", text: "Project JSON render", x: 24, y: 40, width: 272 },
        ],
      }],
    }));

    const result = spawnSync(process.execPath, [
      cliPath,
      "--project",
      projectPath,
      "--out",
      outputDirectory,
    ], {
      cwd: rendererRoot,
      encoding: "utf8",
      timeout: 60_000,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const slide = await readFile(path.join(outputDirectory, "01-test-slide.png"));
    const contactSheet = await readFile(path.join(outputDirectory, "contact-sheet.png"));
    assert.deepEqual(pngDimensions(slide), { width: 320, height: 400 });
    assert.equal(contactSheet.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
