import type { CanvasPreset } from "./editorModel";

const REFERENCE_CANVAS_WIDTH = 1080;

export const BRAND_BADGE = {
  text: "LIFT CODE",
  width: 168,
  height: 42,
  x: 70,
  bottom: 68,
  cornerRadius: 21,
  fill: "#171715",
  textFill: "#ffffff",
  fontFamily: "Inter",
  fontSize: 18,
  fontWeight: "800",
  letterSpacing: 2.2,
  textOffsetY: 1,
} as const;

export const getBrandBadgeGeometry = (canvas: CanvasPreset) => {
  const scale = canvas.width / REFERENCE_CANVAS_WIDTH;
  const width = BRAND_BADGE.width * scale;
  const height = BRAND_BADGE.height * scale;

  return {
    x: BRAND_BADGE.x * scale,
    y: canvas.height - BRAND_BADGE.bottom * scale - height,
    width,
    height,
    cornerRadius: BRAND_BADGE.cornerRadius * scale,
    fontSize: BRAND_BADGE.fontSize * scale,
    letterSpacing: BRAND_BADGE.letterSpacing * scale,
    textOffsetY: BRAND_BADGE.textOffsetY * scale,
  };
};
