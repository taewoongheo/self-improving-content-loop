import assert from "node:assert/strict";
import test from "node:test";

import {
  assertBoundedProject,
  MAX_LAYERS_PER_SLIDE,
  MAX_LEGACY_BACKGROUNDS,
  MAX_PROJECT_SLIDES,
} from "../src/projectValidation.ts";

const project = (overrides: Record<string, unknown> = {}) => ({
  type: "tiktok-slide-project",
  version: 2,
  formatId: "denzel",
  slides: [{
    id: "slide-1",
    name: "Slide 1",
    canvas: { id: "test", name: "Test", width: 320, height: 400 },
    background: { type: "color", fill: "#ffffff" },
    layers: [],
  }],
  ...overrides,
});

test("bounded projects accept embedded images and public assets", () => {
  for (const src of ["data:image/png;base64,AA==", "/assets/denzel/list/body.jpg", "assets/denzel/list/body.jpg"]) {
    assert.doesNotThrow(() => assertBoundedProject(project({
      slides: [{
        canvas: { width: 320, height: 400 },
        layers: [{ type: "image", src }],
      }],
    })));
  }
});

test("bounded projects reject unsafe image sources", () => {
  for (const src of [
    "http://127.0.0.1/private",
    "https://example.com/image.png",
    "/@fs/etc/passwd",
    "/assets/../secret.png",
    "data:image/svg+xml;base64,AA==",
  ]) {
    assert.throws(() => assertBoundedProject(project({
      slides: [{
        canvas: { width: 320, height: 400 },
        layers: [{ type: "image", src }],
      }],
    })), /image source/i);
  }
  assert.throws(() => assertBoundedProject(project({
    slides: [{
      canvas: { width: 320, height: 400 },
      backgrounds: [],
      background: "http://127.0.0.1/private",
      layers: [],
    }],
  })), /image source/i);
});

test("bounded projects reject excessive slide and layer counts", () => {
  assert.throws(
    () => assertBoundedProject(project({
      slides: Array.from({ length: MAX_PROJECT_SLIDES + 1 }, () => ({ layers: [] })),
    })),
    /slides/i,
  );
  assert.throws(
    () => assertBoundedProject(project({
      slides: [{
        canvas: { width: 320, height: 400 },
        layers: Array.from({ length: MAX_LAYERS_PER_SLIDE + 1 }, () => ({ type: "text" })),
      }],
    })),
    /layers/i,
  );
  assert.throws(
    () => assertBoundedProject(project({
      slides: [{
        canvas: { width: 320, height: 400 },
        backgrounds: [],
        background: "data:image/png;base64,AA==",
        layers: Array.from({ length: MAX_LAYERS_PER_SLIDE }, () => ({ type: "text" })),
      }],
    })),
    /normalized layers/i,
  );
  assert.throws(
    () => assertBoundedProject(project({
      slides: [{
        canvas: { width: 320, height: 400 },
        backgrounds: Array.from(
          { length: MAX_LEGACY_BACKGROUNDS + 1 },
          () => "data:image/png;base64,AA==",
        ),
        layers: [],
      }],
    })),
    /legacy backgrounds/i,
  );
});

test("bounded projects reject unsafe canvas dimensions and aspect ratios", () => {
  for (const canvas of [
    { width: 0, height: 400 },
    { width: -320, height: 400 },
    { width: 4097, height: 400 },
    { width: 320.5, height: 400 },
    { width: 64, height: 320 },
  ]) {
    assert.throws(
      () => assertBoundedProject(project({ slides: [{ canvas, layers: [] }] })),
      /canvas|aspect ratio/i,
    );
  }
});
