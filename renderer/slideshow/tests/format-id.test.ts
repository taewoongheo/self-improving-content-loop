import assert from "node:assert/strict";
import test from "node:test";

import * as editorModel from "../src/editorModel.ts";

test("format IDs use a stable lowercase namespace", () => {
  assert.equal(typeof editorModel.normalizeFormatId, "function");
  assert.equal(editorModel.normalizeFormatId("denzel"), "denzel");
  assert.equal(editorModel.normalizeFormatId("strength-cards"), "strength-cards");
});

test("missing or unsafe format IDs are rejected", () => {
  assert.equal(typeof editorModel.normalizeFormatId, "function");
  for (const value of [undefined, "", "Denzel", "../denzel", "denzel/reference", "denzel space"]) {
    assert.throws(() => editorModel.normalizeFormatId(value), /format/i);
  }
});
