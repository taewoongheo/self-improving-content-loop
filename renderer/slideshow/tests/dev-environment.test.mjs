import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

test("development server overrides a production parent environment", () => {
  assert.match(packageJson.scripts.dev, /^NODE_ENV=development\s+/);
});
