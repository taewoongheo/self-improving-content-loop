import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("renderer launch scripts bind mutation APIs to localhost only", () => {
  assert.equal(
    packageJson.scripts["renderer:slideshow"],
    "npm --prefix renderer/slideshow run dev -- --host 127.0.0.1",
  );
  assert.equal(
    packageJson.scripts["renderer:video"],
    "npm --prefix renderer/video run dev -- --host 127.0.0.1",
  );
});
