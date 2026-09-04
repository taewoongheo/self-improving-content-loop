import { assertCanvasBounds, MAX_LEGACY_BACKGROUNDS } from "./projectValidation.ts";

export type CanvasPreset = {
  id: string;
  name: string;
  width: number;
  height: number;
};

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: "portrait_4_5", name: "Portrait 4:5", width: 1080, height: 1350 },
  { id: "story_9_16", name: "Story 9:16", width: 1080, height: 1920 },
];

export const DEFAULT_CANVAS_PRESET = CANVAS_PRESETS[0];
export const DEFAULT_TEXT_WIDTH = 420;
export const DEFAULT_LABEL_WIDTH = 320;
export const DEFAULT_BACKGROUND_FILL = "#ffffff";
export const FIXED_WEIGHT_FONTS = new Set(["Arial Black", "Impact"]);

export type Align = "left" | "center" | "right";

export type BackgroundLayer = {
  id: string;
  src: string;
  name: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  scale: number;
  opacity: number;
  overlay: {
    enabled: boolean;
    fill: string;
    opacity: number;
  };
};

export type TextLayerModel = {
  id: string;
  type: "text";
  name: string;
  text: string;
  marks: TextMark[];
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  align: Align;
  lineHeight: number;
  letterSpacing: number;
  opacity: number;
  rotation: number;
  box: {
    enabled: boolean;
    fill: string;
    radius: number;
    paddingX: number;
    paddingY: number;
  };
};

export type TextMark = {
  start: number;
  end: number;
  underline?: boolean;
};

export type ImageLayerModel = {
  id: string;
  type: "image";
  name: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  crop?: ImageLayerCrop;
  placement?: ImageLayerPlacement;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation: number;
};

export type ShapeLayerModel = {
  id: string;
  type: "shape";
  shape: "rectangle" | "circle";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  borderRadius: number;
  opacity: number;
  rotation: number;
};

export type ImageLayerCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImagePlacementMode = "grid-2x2" | "rows-3";

export type ImageLayerPlacement = {
  mode: ImagePlacementMode;
  slotIndex: number;
};

export type SlideLayerModel = TextLayerModel | ImageLayerModel | ShapeLayerModel;

export type SlideBackground = {
  type: "color";
  fill: string;
};

export type Slide = {
  id: string;
  name: string;
  canvas: CanvasPreset;
  background: SlideBackground;
  layers: SlideLayerModel[];
};

export type ProjectFile = {
  type: "tiktok-slide-project";
  version: 2;
  formatId: string;
  id?: string;
  name?: string;
  updatedAt?: string;
  preset: CanvasPreset;
  slides: Slide[];
};

export type Selection = "background" | string | null;

const FORMAT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const normalizeFormatId = (value: unknown) => {
  if (typeof value !== "string" || !FORMAT_ID_PATTERN.test(value)) {
    throw new Error("A lowercase format ID is required.");
  }
  return value;
};

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;


const normalizeRangeBoundary = (value: unknown, textLength: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return clamp(Math.round(value), 0, textLength);
};

export const normalizeTextMarks = (marks: unknown, textLength: number): TextMark[] => {
  if (!Array.isArray(marks)) return [];

  const underlineMarks = marks
    .filter((mark): mark is Record<string, unknown> => isRecord(mark) && mark.underline === true)
    .map((mark) => {
      const start = normalizeRangeBoundary(mark.start, textLength);
      const end = normalizeRangeBoundary(mark.end, textLength);
      return {
        start: Math.min(start, end),
        end: Math.max(start, end),
        underline: true,
      };
    })
    .filter((mark) => mark.end > mark.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: TextMark[] = [];
  for (const mark of underlineMarks) {
    const previous = merged[merged.length - 1];
    if (previous && previous.end >= mark.start) {
      previous.end = Math.max(previous.end, mark.end);
    } else {
      merged.push({ ...mark });
    }
  }

  return merged;
};

export const isTextRangeUnderlined = (marks: TextMark[], start: number, end: number) => {
  if (end <= start) return false;

  let cursor = start;
  for (const mark of marks) {
    if (!mark.underline || mark.end <= cursor) continue;
    if (mark.start > cursor) return false;
    cursor = Math.max(cursor, mark.end);
    if (cursor >= end) return true;
  }

  return false;
};

export const toggleUnderlineMark = (marks: TextMark[], start: number, end: number, textLength: number) => {
  const normalizedStart = normalizeRangeBoundary(start, textLength);
  const normalizedEnd = normalizeRangeBoundary(end, textLength);
  const rangeStart = Math.min(normalizedStart, normalizedEnd);
  const rangeEnd = Math.max(normalizedStart, normalizedEnd);
  if (rangeEnd <= rangeStart) return normalizeTextMarks(marks, textLength);

  const normalizedMarks = normalizeTextMarks(marks, textLength);
  if (!isTextRangeUnderlined(normalizedMarks, rangeStart, rangeEnd)) {
    return normalizeTextMarks(
      [...normalizedMarks, { start: rangeStart, end: rangeEnd, underline: true }],
      textLength,
    );
  }

  return normalizeTextMarks(
    normalizedMarks.flatMap((mark) => {
      if (!mark.underline || mark.end <= rangeStart || mark.start >= rangeEnd) return [mark];

      const nextMarks: TextMark[] = [];
      if (mark.start < rangeStart) nextMarks.push({ start: mark.start, end: rangeStart, underline: true });
      if (mark.end > rangeEnd) nextMarks.push({ start: rangeEnd, end: mark.end, underline: true });
      return nextMarks;
    }),
    textLength,
  );
};

export const MAX_BACKGROUNDS = MAX_LEGACY_BACKGROUNDS;

export type BackgroundRenderArea = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
};

export const BACKGROUND_QUADRANTS = [
  { label: "Q2", column: 0, row: 0 },
  { label: "Q1", column: 1, row: 0 },
  { label: "Q3", column: 0, row: 1 },
  { label: "Q4", column: 1, row: 1 },
] as const;

export const normalizeCanvasPreset = (preset?: Partial<CanvasPreset>): CanvasPreset => {
  if (!preset) return DEFAULT_CANVAS_PRESET;

  const matchedById = CANVAS_PRESETS.find((candidate) => candidate.id === preset.id);
  if (matchedById) return matchedById;

  const matchedBySize = CANVAS_PRESETS.find(
    (candidate) => candidate.width === preset.width && candidate.height === preset.height,
  );
  if (matchedBySize) return matchedBySize;

  if (typeof preset.width === "number" && typeof preset.height === "number") {
    assertCanvasBounds(preset, "Canvas preset");
    return {
      id: preset.id ?? `custom-${preset.width}x${preset.height}`,
      name: preset.name ?? `${preset.width}x${preset.height}`,
      width: preset.width,
      height: preset.height,
    };
  }

  return DEFAULT_CANVAS_PRESET;
};

export const defaultTextLayer = (): TextLayerModel => ({
  id: uid("text"),
  type: "text",
  name: "Hook text",
  text: "",
  marks: [],
  x: 100,
  y: 760,
  width: DEFAULT_TEXT_WIDTH,
  fontSize: 82,
  fontFamily: "Inter",
  fontWeight: "900",
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 10,
  align: "center",
  lineHeight: 1.14,
  letterSpacing: 0,
  opacity: 1,
  rotation: 0,
  box: {
    enabled: false,
    fill: "#ffffff",
    radius: 28,
    paddingX: 36,
    paddingY: 18,
  },
});

export const defaultLabelLayer = (): TextLayerModel => ({
  id: uid("label"),
  type: "text",
  name: "Pill label",
  text: "Label",
  marks: [],
  x: 350,
  y: 620,
  width: DEFAULT_LABEL_WIDTH,
  fontSize: 58,
  fontFamily: "Inter",
  fontWeight: "700",
  fill: "#050505",
  stroke: "#050505",
  strokeWidth: 0,
  align: "center",
  lineHeight: 1,
  letterSpacing: 0,
  opacity: 1,
  rotation: 0,
  box: {
    enabled: true,
    fill: "#ffffff",
    radius: 26,
    paddingX: 34,
    paddingY: 18,
  },
});

export const createSlide = (index: number): Slide => ({
  id: uid("slide"),
  name: `Slide ${index}`,
  canvas: DEFAULT_CANVAS_PRESET,
  background: { type: "color", fill: DEFAULT_BACKGROUND_FILL },
  layers: [],
});

export const normalizeSlideBackground = (background?: Partial<SlideBackground>): SlideBackground => ({
  type: "color",
  fill: typeof background?.fill === "string" ? background.fill : DEFAULT_BACKGROUND_FILL,
});

export const normalizeTextLayer = (layer: Partial<TextLayerModel>, resetId = true): TextLayerModel => {
  const fallback = defaultTextLayer();
  const normalizedLayer = { ...layer } as Partial<TextLayerModel> & { templateRules?: unknown };
  delete normalizedLayer.templateRules;
  const text = String(layer.text ?? fallback.text);
  return {
    ...fallback,
    ...normalizedLayer,
    id: resetId ? uid("text") : String(layer.id ?? fallback.id),
    type: "text",
    text,
    marks: normalizeTextMarks(layer.marks, text.length),
    letterSpacing: layer.letterSpacing ?? 0,
    box: {
      ...fallback.box,
      ...(layer.box ?? {}),
    },
  };
};

export const normalizeImageLayer = (layer: Partial<ImageLayerModel>, resetId = true): ImageLayerModel => {
  const naturalWidth = typeof layer.naturalWidth === "number" && Number.isFinite(layer.naturalWidth) ? layer.naturalWidth : 1;
  const naturalHeight = typeof layer.naturalHeight === "number" && Number.isFinite(layer.naturalHeight) ? layer.naturalHeight : 1;
  const rawCrop = isRecord(layer.crop) ? layer.crop : null;
  const cropX = rawCrop
    ? clamp(typeof rawCrop.x === "number" && Number.isFinite(rawCrop.x) ? rawCrop.x : 0, 0, naturalWidth - 1)
    : 0;
  const cropY = rawCrop
    ? clamp(typeof rawCrop.y === "number" && Number.isFinite(rawCrop.y) ? rawCrop.y : 0, 0, naturalHeight - 1)
    : 0;
  const crop = rawCrop
    ? {
        x: cropX,
        y: cropY,
        width: clamp(
          typeof rawCrop.width === "number" && Number.isFinite(rawCrop.width) ? rawCrop.width : naturalWidth,
          1,
          naturalWidth - cropX,
        ),
        height: clamp(
          typeof rawCrop.height === "number" && Number.isFinite(rawCrop.height) ? rawCrop.height : naturalHeight,
          1,
          naturalHeight - cropY,
        ),
      }
    : undefined;
  const rawPlacement = isRecord(layer.placement) ? layer.placement : null;
  const placement =
    rawPlacement &&
    (rawPlacement.mode === "grid-2x2" || rawPlacement.mode === "rows-3") &&
    typeof rawPlacement.slotIndex === "number" &&
    Number.isFinite(rawPlacement.slotIndex)
      ? {
          mode: rawPlacement.mode,
          slotIndex: Math.max(0, Math.round(rawPlacement.slotIndex)),
      }
    : undefined;
  const width = typeof layer.width === "number" && Number.isFinite(layer.width) ? layer.width : naturalWidth;
  const height =
    !crop && !placement
      ? Math.round(width * (naturalHeight / naturalWidth))
      : typeof layer.height === "number" && Number.isFinite(layer.height)
        ? layer.height
        : naturalHeight;

  return {
    id: resetId ? uid("image") : String(layer.id ?? uid("image")),
    type: "image",
    name: String(layer.name ?? "Image"),
    src: String(layer.src ?? ""),
    naturalWidth,
    naturalHeight,
    crop,
    placement,
    x: typeof layer.x === "number" && Number.isFinite(layer.x) ? layer.x : 0,
    y: typeof layer.y === "number" && Number.isFinite(layer.y) ? layer.y : 0,
    width,
    height,
    opacity: clamp(layer.opacity ?? 1, 0, 1),
    rotation: typeof layer.rotation === "number" && Number.isFinite(layer.rotation) ? layer.rotation : 0,
  };
};

export const defaultShapeLayer = (shape: ShapeLayerModel["shape"]): ShapeLayerModel => ({
  id: uid("shape"),
  type: "shape",
  shape,
  name: shape === "circle" ? "Circle" : "Rectangle",
  x: 390,
  y: 555,
  width: 300,
  height: 300,
  fill: "#26e07f",
  stroke: "#101210",
  strokeWidth: 0,
  borderRadius: 0,
  opacity: 1,
  rotation: 0,
});

export const normalizeShapeLayer = (layer: Partial<ShapeLayerModel>, resetId = true): ShapeLayerModel => {
  const shape = layer.shape === "circle" ? "circle" : "rectangle";
  const fallback = defaultShapeLayer(shape);
  const width = clamp(Number.isFinite(layer.width) ? Number(layer.width) : fallback.width, 24, 10000);
  const rawHeight = clamp(Number.isFinite(layer.height) ? Number(layer.height) : fallback.height, 24, 10000);
  return {
    ...fallback,
    ...layer,
    id: resetId ? uid("shape") : String(layer.id ?? fallback.id),
    type: "shape",
    shape,
    name: String(layer.name ?? fallback.name),
    x: Number.isFinite(layer.x) ? Number(layer.x) : fallback.x,
    y: Number.isFinite(layer.y) ? Number(layer.y) : fallback.y,
    width,
    height: shape === "circle" ? width : rawHeight,
    fill: typeof layer.fill === "string" ? layer.fill : fallback.fill,
    stroke: typeof layer.stroke === "string" ? layer.stroke : fallback.stroke,
    strokeWidth: clamp(Number.isFinite(layer.strokeWidth) ? Number(layer.strokeWidth) : fallback.strokeWidth, 0, 1000),
    borderRadius: shape === "rectangle"
      ? clamp(Number.isFinite(layer.borderRadius) ? Number(layer.borderRadius) : fallback.borderRadius, 0, Math.min(width, rawHeight) / 2)
      : 0,
    opacity: clamp(Number.isFinite(layer.opacity) ? Number(layer.opacity) : fallback.opacity, 0, 1),
    rotation: Number.isFinite(layer.rotation) ? Number(layer.rotation) : fallback.rotation,
  };
};

export const getShapeRenderGeometry = (layer: ShapeLayerModel) => ({
  group: {
    x: layer.x,
    y: layer.y,
    rotation: layer.rotation,
    opacity: layer.opacity,
  },
  style: {
    fill: layer.fill,
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
  },
  circle: {
    x: layer.width / 2,
    y: layer.height / 2,
    radiusX: layer.width / 2,
    radiusY: layer.height / 2,
  },
  rectangle: {
    width: layer.width,
    height: layer.height,
    cornerRadius: layer.borderRadius,
  },
});

export const scaleLayerForCanvas = (
  layer: SlideLayerModel,
  xRatio: number,
  yRatio: number,
  nextCanvas: Pick<CanvasPreset, "width" | "height">,
): SlideLayerModel => {
  const scaledPosition = {
    x: Math.round(layer.x * xRatio),
    y: Math.round(layer.y * yRatio),
    width: clamp(Math.round(layer.width * xRatio), 24, nextCanvas.width * 2),
  };

  if (isImageLayer(layer)) {
    return normalizeImageLayer({
      ...layer,
      ...scaledPosition,
      height: clamp(Math.round(layer.height * yRatio), 24, nextCanvas.height * 2),
    }, false);
  }
  if (isShapeLayer(layer)) {
    return normalizeShapeLayer({
      ...layer,
      ...scaledPosition,
      height: clamp(Math.round(layer.height * yRatio), 24, nextCanvas.height * 2),
    }, false);
  }
  return normalizeTextLayer({ ...layer, ...scaledPosition }, false);
};

export const isTextLayer = (layer: SlideLayerModel): layer is TextLayerModel => layer.type === "text";

export const isImageLayer = (layer: SlideLayerModel): layer is ImageLayerModel => layer.type === "image";

export const isShapeLayer = (layer: SlideLayerModel): layer is ShapeLayerModel => layer.type === "shape";

export const normalizeSlideLayer = (layer: unknown, resetId = true): SlideLayerModel => {
  if (isRecord(layer) && layer.type === "image") return normalizeImageLayer(layer as Partial<ImageLayerModel>, resetId);
  if (isRecord(layer) && layer.type === "shape") return normalizeShapeLayer(layer as Partial<ShapeLayerModel>, resetId);
  return normalizeTextLayer(isRecord(layer) ? (layer as Partial<TextLayerModel>) : {}, resetId);
};

export const makePreset = (preset = DEFAULT_CANVAS_PRESET): ProjectFile["preset"] => normalizeCanvasPreset(preset);

export function calculateCover(naturalWidth: number, naturalHeight: number, canvas: CanvasPreset) {
  return calculateCoverForArea(naturalWidth, naturalHeight, { width: canvas.width, height: canvas.height });
}

export function calculateCoverForArea(
  naturalWidth: number,
  naturalHeight: number,
  area: Pick<BackgroundRenderArea, "width" | "height">,
) {
  const scale = Math.max(area.width / naturalWidth, area.height / naturalHeight);
  return {
    x: (area.width - naturalWidth * scale) / 2,
    y: (area.height - naturalHeight * scale) / 2,
    scale,
  };
}

export function getMinCoverScale(background: BackgroundLayer, canvas: CanvasPreset) {
  return getMinCoverScaleForArea(background, { width: canvas.width, height: canvas.height });
}

export function getMinCoverScaleForArea(
  background: BackgroundLayer,
  area: Pick<BackgroundRenderArea, "width" | "height">,
) {
  return Math.max(area.width / background.naturalWidth, area.height / background.naturalHeight);
}

export function constrainBackground(background: BackgroundLayer, canvas: CanvasPreset): BackgroundLayer {
  return constrainBackgroundToArea(background, { x: 0, y: 0, width: canvas.width, height: canvas.height, label: "Full" });
}

export function constrainBackgroundToArea(background: BackgroundLayer, area: BackgroundRenderArea): BackgroundLayer {
  const scale = Math.max(background.scale, getMinCoverScaleForArea(background, area));
  const renderedWidth = background.naturalWidth * scale;
  const renderedHeight = background.naturalHeight * scale;
  const minX = Math.min(0, area.width - renderedWidth);
  const minY = Math.min(0, area.height - renderedHeight);
  const x = renderedWidth <= area.width ? (area.width - renderedWidth) / 2 : clamp(background.x, minX, 0);
  const y = renderedHeight <= area.height ? (area.height - renderedHeight) / 2 : clamp(background.y, minY, 0);

  return { ...background, x, y, scale, overlay: normalizeBackgroundOverlay(background.overlay) };
}

export function fitBackgroundToCover(background: BackgroundLayer, canvas: CanvasPreset): BackgroundLayer {
  return fitBackgroundToArea(background, { x: 0, y: 0, width: canvas.width, height: canvas.height, label: "Full" });
}

export function fitBackgroundToArea(background: BackgroundLayer, area: BackgroundRenderArea): BackgroundLayer {
  return constrainBackgroundToArea(
    {
      ...background,
      ...calculateCoverForArea(background.naturalWidth, background.naturalHeight, area),
    },
    area,
  );
}

export function normalizeBackgroundOverlay(overlay?: Partial<BackgroundLayer["overlay"]>): BackgroundLayer["overlay"] {
  return {
    enabled: overlay?.enabled ?? false,
    fill: overlay?.fill ?? "#000000",
    opacity: clamp(overlay?.opacity ?? 0.35, 0, 1),
  };
}

type LegacyBackgroundSlide = {
  background?: BackgroundLayer;
  backgrounds?: BackgroundLayer[];
  backgroundOverlay?: BackgroundLayer["overlay"];
};

export function getSlideBackgrounds(slide: Pick<LegacyBackgroundSlide, "background" | "backgrounds">) {
  if (Array.isArray(slide.backgrounds) && slide.backgrounds.length > 0) {
    return slide.backgrounds.slice(0, MAX_BACKGROUNDS);
  }
  return slide.background ? [slide.background] : [];
}

export function getBackgroundRenderArea(index: number, canvas: CanvasPreset, backgroundCount: number): BackgroundRenderArea {
  if (backgroundCount <= 1) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height, label: "Full" };
  }

  const quadrant = BACKGROUND_QUADRANTS[index] ?? BACKGROUND_QUADRANTS[BACKGROUND_QUADRANTS.length - 1];
  const width = canvas.width / 2;
  const height = canvas.height / 2;
  return {
    x: quadrant.column * width,
    y: quadrant.row * height,
    width,
    height,
    label: quadrant.label,
  };
}

export function getSlideBackgroundOverlay(slide: LegacyBackgroundSlide) {
  const backgrounds = getSlideBackgrounds(slide);
  if (backgrounds[0]) return normalizeBackgroundOverlay(backgrounds[0].overlay);
  if (slide.backgroundOverlay) return normalizeBackgroundOverlay(slide.backgroundOverlay);
  return undefined;
}
