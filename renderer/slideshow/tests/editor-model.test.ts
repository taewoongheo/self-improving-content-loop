import assert from "node:assert/strict";
import test from "node:test";

import {
  getShapeRenderGeometry,
  isShapeLayer,
  normalizeCanvasPreset,
  normalizeShapeLayer,
  normalizeSlideLayer,
  scaleLayerForCanvas,
} from "../src/editorModel.ts";

test("normalization discards legacy template property locks", () => {
  const textLayer = normalizeSlideLayer({
    type: "text",
    text: "Editable text",
    templateRules: { aiEditableProperties: ["text"] },
  });
  const imageLayer = normalizeSlideLayer({
    type: "image",
    src: "data:image/png;base64,AA==",
    naturalWidth: 1,
    naturalHeight: 1,
    templateRules: { aiEditableProperties: ["src"] },
  });

  assert.equal("templateRules" in textLayer, false);
  assert.equal("templateRules" in imageLayer, false);
});

test("canvas normalization rejects unsafe custom dimensions", () => {
  for (const preset of [
    { width: -1, height: 400 },
    { width: 4097, height: 400 },
    { width: 64, height: 320 },
  ]) {
    assert.throws(() => normalizeCanvasPreset(preset), /canvas|aspect ratio/i);
  }
});

test("shape normalization preserves upstream rectangle and circle behavior", () => {
  const rectangle = normalizeShapeLayer({
    shape: "rectangle",
    width: 200,
    height: 120,
    borderRadius: 999,
  }, false);
  const circle = normalizeSlideLayer({
    type: "shape",
    shape: "circle",
    width: 180,
    height: 90,
  }, false);

  assert.equal(rectangle.type, "shape");
  assert.equal(rectangle.borderRadius, 60);
  assert.equal(isShapeLayer(circle), true);
  if (!isShapeLayer(circle)) throw new Error("Expected a shape layer.");
  assert.equal(circle.shape, "circle");
  assert.equal(circle.width, 180);
  assert.equal(circle.height, 180);
});

test("circle rendering rotates around the same top-left group origin in editor and export", () => {
  const circle = normalizeShapeLayer({
    shape: "circle",
    x: 120,
    y: 240,
    width: 180,
    rotation: 35,
  }, false);
  const geometry = getShapeRenderGeometry(circle);

  assert.deepEqual(geometry.group, { x: 120, y: 240, rotation: 35, opacity: 1 });
  assert.deepEqual(geometry.circle, { x: 90, y: 90, radiusX: 90, radiusY: 90 });
});

test("anisotropic canvas changes keep circles circular", () => {
  const circle = normalizeShapeLayer({
    shape: "circle",
    x: 100,
    y: 200,
    width: 300,
  }, false);
  const scaled = scaleLayerForCanvas(circle, 1, 1920 / 1350, { width: 1080, height: 1920 });

  assert.equal(isShapeLayer(scaled), true);
  if (!isShapeLayer(scaled)) throw new Error("Expected a shape layer.");
  assert.equal(scaled.x, 100);
  assert.equal(scaled.y, 284);
  assert.equal(scaled.width, 300);
  assert.equal(scaled.height, 300);
});
