import assert from "node:assert/strict";
import test from "node:test";

const emptyProject = (formatId = "sample-format") => ({
  type: "lift-code-video-project",
  version: 1,
  formatId,
  name: "Test project",
  fps: 30,
  preset: { id: "tiktok_9_16", name: "TikTok 9:16", width: 1080, height: 1920 },
  backgroundColor: "#000000",
  clips: [],
  textLayers: [],
  audioLayers: [],
});

test("video projects require and preserve a lowercase format identity", async () => {
  const { normalizeProject } = await import("../src/projectValidation.ts");

  assert.equal(normalizeProject(emptyProject()).formatId, "sample-format");
  for (const formatId of ["", "Sample Format", "../sample-format"]) {
    assert.throws(
      () => normalizeProject(emptyProject(formatId)),
      /lowercase format identity/,
    );
  }
});

test("video project source keeps sequential clip timing", async () => {
  const source = await import("../src/projectModel.ts");
  const clip = {
    id: "clip-1",
    name: "Clip",
    src: "/assets/clip.mp4",
    sourceDurationInFrames: 120,
    sourceWidth: 1920,
    sourceHeight: 1080,
    trimStart: 20,
    trimEnd: 80,
    volume: 1,
    fit: "cover",
    cropX: 50,
    cropY: 50,
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
  };
  assert.equal(source.clipDuration(clip), 60);
  assert.equal(source.projectDuration({ clips: [clip, clip], textLayers: [] }), 120);
});

test("splitClip preserves the selected source range", async () => {
  const source = await import("../src/projectModel.ts");
  const clip = {
    id: "clip-1",
    name: "Clip",
    src: "/assets/clip.mp4",
    sourceDurationInFrames: 120,
    sourceWidth: 1920,
    sourceHeight: 1080,
    trimStart: 20,
    trimEnd: 80,
    volume: 1,
    fit: "cover",
    cropX: 50,
    cropY: 50,
    x: 0,
    y: 0,
    width: 1080,
    height: 1920,
  };
  const parts = source.splitClip(clip, 30);
  assert.ok(parts);
  assert.equal(parts[0].trimStart, 20);
  assert.equal(parts[0].trimEnd, 50);
  assert.equal(parts[1].trimStart, 50);
  assert.equal(parts[1].trimEnd, 80);
});

test("timeline edge resizing clamps video trims and preserves the opposite text edge", async () => {
  const source = await import("../src/projectModel.ts");
  const clip = {
    id: "clip-1", name: "Clip", src: "/assets/clip.mp4", sourceDurationInFrames: 120,
    sourceWidth: 1920, sourceHeight: 1080, trimStart: 20, trimEnd: 80, volume: 1,
    fit: "cover", cropX: 50, cropY: 50, x: 0, y: 0, width: 1080, height: 1920,
  };
  assert.equal(source.resizeClipEdge(clip, "start", 70).trimStart, 79);
  assert.equal(source.resizeClipEdge(clip, "end", 70).trimEnd, 120);

  const text = { id: "text-1", name: "Text", text: "Text", from: 30, durationInFrames: 60 };
  const resized = source.resizeTextEdge(text, "start", 20);
  assert.equal(resized.from, 50);
  assert.equal(resized.durationInFrames, 40);
});

test("fill-frame crop pans an oversized video without moving it outside the frame", async () => {
  const source = await import("../src/projectModel.ts");
  const clip = {
    sourceWidth: 1920, sourceHeight: 1080, cropX: 100, cropY: 50,
  };
  const placement = source.getCoverPlacement(clip, { id: "tiktok_9_16", name: "TikTok 9:16", width: 1080, height: 1920 });
  assert.equal(placement.height, 1920);
  assert.ok(placement.width > 1080);
  assert.equal(placement.left, -(placement.width - 1080));
});

test("canvas text manipulation moves and resizes inside the canvas", async () => {
  const source = await import("../src/projectModel.ts");
  const layer = { x: 100, y: 200, width: 400, fontSize: 80 };
  const canvas = { id: "tiktok_9_16", name: "TikTok 9:16", width: 1080, height: 1920 };
  assert.deepEqual(
    { x: source.moveTextOnCanvas(layer, 120, -50, canvas).x, y: source.moveTextOnCanvas(layer, 120, -50, canvas).y },
    { x: 220, y: 150 },
  );
  assert.equal(source.resizeTextOnCanvas(layer, 900, canvas).width, 980);
});

test("canvas text snaps its edges and center to the main safe guides", async () => {
  const source = await import("../src/projectModel.ts");
  const canvas = { id: "tiktok_9_16", name: "TikTok 9:16", width: 1080, height: 1920 };
  const centerSnap = source.snapTextOnCanvas({ x: 335, y: 855, width: 400 }, 200, canvas);
  assert.equal(centerSnap.x, 340);
  assert.equal(centerSnap.y, 860);
  assert.deepEqual(centerSnap.guides, [
    { orientation: "vertical", position: 540 },
    { orientation: "horizontal", position: 960 },
  ]);

  const safeEdgeSnap = source.snapTextOnCanvas({ x: 68, y: 222, width: 400 }, 200, canvas);
  assert.equal(safeEdgeSnap.x, 72);
  assert.equal(safeEdgeSnap.y, 221);
});

test("overlapping text layers use separate timeline rows and reuse free rows", async () => {
  const source = await import("../src/projectModel.ts");
  const layout = source.getTextTimelineRows([
    { id: "first", from: 0, durationInFrames: 60 },
    { id: "overlap", from: 30, durationInFrames: 60 },
    { id: "after", from: 60, durationInFrames: 30 },
  ]);
  assert.equal(layout.rowCount, 2);
  assert.deepEqual(layout.rows, { first: 0, overlap: 1, after: 0 });
});

test("audio duration contributes to the project and timeline edge trimming stays in source bounds", async () => {
  const source = await import("../src/projectModel.ts");
  const audio = {
    id: "audio-1", name: "Music", src: "/assets/music.mp3",
    sourceDurationInFrames: 300, trimStart: 30, trimEnd: 240, from: 60, volume: 1,
  };
  assert.equal(source.audioDuration(audio), 210);
  assert.equal(source.projectDuration({ clips: [], textLayers: [], audioLayers: [audio] }), 270);
  assert.deepEqual(
    (({ from, trimStart }) => ({ from, trimStart }))(source.resizeAudioEdge(audio, "start", -50)),
    { from: 30, trimStart: 0 },
  );
  assert.equal(source.resizeAudioEdge(audio, "end", 100).trimEnd, 300);
});
