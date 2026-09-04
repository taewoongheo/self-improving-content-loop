import { loadHtmlImage } from "./browserFiles";
import {
  getBackgroundRenderArea,
  MAX_BACKGROUNDS,
  createSlide,
  normalizeCanvasPreset,
  normalizeFormatId,
  normalizeImageLayer,
  normalizeSlideBackground,
  normalizeSlideLayer,
  uid,
  type CanvasPreset,
  type ImageLayerModel,
  type ProjectFile,
  type Slide,
  type SlideBackground,
  type SlideLayerModel,
} from "./editorModel";
import { assertBoundedProject, normalizeProjectImageSource } from "./projectValidation.ts";

type ProjectLoadResult = {
  formatId: string;
  slides: Slide[];
  warnings: string[];
};

type DraftBackground = {
  id?: unknown;
  src?: string;
  name?: unknown;
  naturalWidth?: unknown;
  naturalHeight?: unknown;
  opacity?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asNumber = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

const getBackgroundInput = (value: unknown): DraftBackground | undefined => {
  if (typeof value === "string") return { src: value };
  if (!isRecord(value)) return undefined;
  return value as DraftBackground;
};

const getLegacyBackgroundInput = (value: unknown): DraftBackground | undefined => {
  if (typeof value === "string") return { src: value };
  if (!isRecord(value)) return undefined;
  if (value.type === "color") return undefined;
  return value as DraftBackground;
};

const getSlideBackground = (slide: Record<string, unknown>): SlideBackground => {
  const background = slide.background;
  if (isRecord(background) && background.type === "color") {
    return normalizeSlideBackground(background as Partial<SlideBackground>);
  }

  if (typeof slide.backgroundFill === "string") return normalizeSlideBackground({ fill: slide.backgroundFill });
  if (typeof slide.backgroundColor === "string") return normalizeSlideBackground({ fill: slide.backgroundColor });
  return normalizeSlideBackground();
};

async function normalizeLegacyBackgroundAsImageLayer(
  backgroundInput: unknown,
  canvas: CanvasPreset,
  backgroundCount: number,
  index: number,
  warnings: string[],
  slideName: string,
): Promise<ImageLayerModel | undefined> {
  const background = getLegacyBackgroundInput(backgroundInput);
  if (!background?.src) return undefined;

  const src = normalizeProjectImageSource(background.src);
  try {
    const image = await loadHtmlImage(src);
    const naturalWidth = asNumber(background.naturalWidth, image.naturalWidth);
    const naturalHeight = asNumber(background.naturalHeight, image.naturalHeight);
    const area = getBackgroundRenderArea(index, canvas, backgroundCount);

    return normalizeImageLayer({
      id: String(background.id ?? uid("image")),
      src,
      name: String(background.name ?? src.split("/").pop() ?? "Background"),
      naturalWidth,
      naturalHeight,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
      opacity: asNumber(background.opacity, 1),
      rotation: 0,
    }, false);
  } catch {
    warnings.push(`${slideName}: background image not found (${src})`);
    return undefined;
  }
}

async function normalizeLegacyBackgroundLayers(
  slide: Record<string, unknown>,
  canvas: CanvasPreset,
  warnings: string[],
  slideName: string,
) {
  const backgroundInputs =
    Array.isArray(slide.backgrounds) && slide.backgrounds.length > 0
      ? slide.backgrounds.slice(0, MAX_BACKGROUNDS)
      : getLegacyBackgroundInput(slide.background)
        ? [slide.background]
        : [];

  const normalized = await Promise.all(
    backgroundInputs.map((backgroundInput, index) =>
      normalizeLegacyBackgroundAsImageLayer(
        backgroundInput,
        canvas,
        backgroundInputs.length,
        index,
        warnings,
        slideName,
      ),
    ),
  );

  return normalized.filter((layer): layer is ImageLayerModel => Boolean(layer));
}

function normalizeProjectLayer(layer: unknown): SlideLayerModel {
  const normalized = normalizeSlideLayer(layer, false);
  if (normalized.type !== "image") return normalized;

  return normalizeImageLayer(
    {
      ...normalized,
      src: normalizeProjectImageSource(normalized.src),
    },
    false,
  );
}

export async function normalizeProjectFile(parsed: unknown): Promise<ProjectLoadResult> {
  if (!isRecord(parsed) || parsed.type !== "tiktok-slide-project" || !Array.isArray(parsed.slides)) {
    throw new Error("Content JSON 형식이 아닙니다.");
  }
  assertBoundedProject(parsed);

  const project = parsed as Partial<ProjectFile>;
  const formatId = normalizeFormatId(parsed.formatId);
  const projectSlides = parsed.slides as Record<string, unknown>[];
  const projectPreset = normalizeCanvasPreset(project.preset);
  const warnings: string[] = [];

  if (projectSlides.length === 0) {
    return { formatId, slides: [createSlide(1)], warnings: ["Content had no slides. Created one empty slide."] };
  }

  const slides = await Promise.all(
    projectSlides.map(async (slide, index) => {
      const canvas = normalizeCanvasPreset(isRecord(slide.canvas) ? slide.canvas : projectPreset);
      const name = typeof slide.name === "string" ? slide.name : `Slide ${index + 1}`;
      const legacyBackgroundLayers = await normalizeLegacyBackgroundLayers(slide, canvas, warnings, name);
      const layers: SlideLayerModel[] = [
        ...legacyBackgroundLayers,
        ...(Array.isArray(slide.layers) ? slide.layers.map(normalizeProjectLayer) : []),
      ];

      return {
        id: String(slide.id ?? uid("slide")),
        name,
        canvas,
        background: getSlideBackground(slide),
        layers,
      };
    }),
  );

  return { formatId, slides, warnings };
}
