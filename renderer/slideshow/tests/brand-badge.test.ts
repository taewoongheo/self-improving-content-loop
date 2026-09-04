import assert from "node:assert/strict";
import test from "node:test";

import { getBrandBadgeGeometry } from "../src/brandBadge.ts";

test("brand badge matches the 1080 by 1350 reference placement", () => {
  assert.deepEqual(
    getBrandBadgeGeometry({ id: "reference", name: "Reference", width: 1080, height: 1350 }),
    {
      x: 70,
      y: 1240,
      width: 168,
      height: 42,
      cornerRadius: 21,
      fontSize: 18,
      letterSpacing: 2.2,
      textOffsetY: 1,
    },
  );
});

test("brand badge scales from canvas width while preserving its bottom offset", () => {
  assert.deepEqual(
    getBrandBadgeGeometry({ id: "double", name: "Double", width: 2160, height: 2700 }),
    {
      x: 140,
      y: 2480,
      width: 336,
      height: 84,
      cornerRadius: 42,
      fontSize: 36,
      letterSpacing: 4.4,
      textOffsetY: 2,
    },
  );
});
