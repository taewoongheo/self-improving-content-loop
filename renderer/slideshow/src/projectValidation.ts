export const MAX_PROJECT_BYTES = 32 * 1024 * 1024;
export const MAX_PROJECT_SLIDES = 20;
export const MAX_LAYERS_PER_SLIDE = 100;
export const MAX_LEGACY_BACKGROUNDS = 4;
export const MIN_CANVAS_DIMENSION = 64;
export const MAX_CANVAS_DIMENSION = 4096;
export const MAX_CANVAS_ASPECT_RATIO = 4;

const FORMAT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMBEDDED_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;
const ASSET_PATH_PATTERN = /^\/?assets\/[a-z0-9._~!$&'()+,;=@/-]+$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const assertCanvasBounds = (value: unknown, label: string) => {
  if (value === undefined) return;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);

  const { width, height } = value;
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || (width as number) < MIN_CANVAS_DIMENSION
    || (height as number) < MIN_CANVAS_DIMENSION
    || (width as number) > MAX_CANVAS_DIMENSION
    || (height as number) > MAX_CANVAS_DIMENSION
  ) {
    throw new Error(
      `${label} dimensions must be integers from ${MIN_CANVAS_DIMENSION} to ${MAX_CANVAS_DIMENSION}.`,
    );
  }

  const aspectRatio = Math.max(width as number, height as number) / Math.min(width as number, height as number);
  if (aspectRatio > MAX_CANVAS_ASPECT_RATIO) {
    throw new Error(`${label} aspect ratio must not exceed ${MAX_CANVAS_ASPECT_RATIO}:1.`);
  }
};

export const normalizeProjectImageSource = (value: unknown) => {
  if (typeof value !== "string") throw new Error("Image source must be a string.");
  const source = value.trim();
  if (EMBEDDED_IMAGE_PATTERN.test(source)) return source;

  const assetPath = source.startsWith("assets/") ? `/${source}` : source;
  if (
    ASSET_PATH_PATTERN.test(assetPath)
    && !assetPath.split("/").some((segment) => segment === ".." || segment === ".")
  ) {
    return assetPath;
  }

  throw new Error("Image sources must be embedded PNG/JPEG/WebP data URLs or /assets/ paths.");
};

const validateImageInput = (value: unknown) => {
  if (typeof value === "string") {
    normalizeProjectImageSource(value);
    return;
  }
  if (isRecord(value) && "src" in value) normalizeProjectImageSource(value.src);
};

export function assertBoundedProject(value: unknown): asserts value is Record<string, unknown> & {
  formatId: string;
  slides: Record<string, unknown>[];
} {
  if (!isRecord(value) || value.type !== "tiktok-slide-project") {
    throw new Error("Project must be a tiktok-slide-project object.");
  }
  if (typeof value.formatId !== "string" || !FORMAT_ID_PATTERN.test(value.formatId)) {
    throw new Error("Project must include a lowercase format identity.");
  }
  if (!Array.isArray(value.slides) || value.slides.length === 0) {
    throw new Error("Project must include at least one slide.");
  }
  if (value.slides.length > MAX_PROJECT_SLIDES) {
    throw new Error(`Project must not exceed ${MAX_PROJECT_SLIDES} slides.`);
  }

  assertCanvasBounds(value.preset, "Project canvas");
  for (const [slideIndex, slideValue] of value.slides.entries()) {
    if (!isRecord(slideValue)) throw new Error(`Slide ${slideIndex + 1} must be an object.`);
    assertCanvasBounds(slideValue.canvas, `Slide ${slideIndex + 1} canvas`);

    if (slideValue.layers !== undefined && !Array.isArray(slideValue.layers)) {
      throw new Error(`Slide ${slideIndex + 1} layers must be an array.`);
    }
    const layers = Array.isArray(slideValue.layers) ? slideValue.layers : [];
    for (const layer of layers) {
      if (isRecord(layer) && layer.type === "image") normalizeProjectImageSource(layer.src);
    }

    let legacyBackgroundCount = 0;
    if (Array.isArray(slideValue.backgrounds) && slideValue.backgrounds.length > 0) {
      if (slideValue.backgrounds.length > MAX_LEGACY_BACKGROUNDS) {
        throw new Error(
          `Slide ${slideIndex + 1} must not exceed ${MAX_LEGACY_BACKGROUNDS} legacy backgrounds.`,
        );
      }
      legacyBackgroundCount = slideValue.backgrounds.length;
      for (const background of slideValue.backgrounds) validateImageInput(background);
    } else if (
      typeof slideValue.background === "string"
      || (isRecord(slideValue.background) && slideValue.background.type !== "color")
    ) {
      legacyBackgroundCount = 1;
      validateImageInput(slideValue.background);
    }
    if (layers.length + legacyBackgroundCount > MAX_LAYERS_PER_SLIDE) {
      throw new Error(
        `Slide ${slideIndex + 1} must not exceed ${MAX_LAYERS_PER_SLIDE} normalized layers.`,
      );
    }
  }
}
