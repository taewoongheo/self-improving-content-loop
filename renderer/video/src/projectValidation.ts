import { CANVAS_PRESETS, clamp, type AudioLayer, type TextLayer, type VideoClip, type VideoProject } from "./projectModel.ts";

export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
export const MAX_CLIPS = 100;
export const MAX_TEXT_LAYERS = 100;
export const MAX_AUDIO_LAYERS = 100;
const ASSET_PATH = /^\/assets\/[\p{Letter}\p{Number}._-]+$/u;
const FORMAT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const number = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;

export function assertVideoProject(value: unknown): asserts value is VideoProject {
  if (!isRecord(value) || value.type !== "lift-code-video-project") throw new Error("Project must be a lift-code-video-project object.");
  if (typeof value.formatId !== "string" || !FORMAT_ID_PATTERN.test(value.formatId)) throw new Error("Project must include a lowercase format identity.");
  const preset = value.preset;
  if (!isRecord(preset) || !CANVAS_PRESETS.some((candidate) => candidate.id === preset.id)) throw new Error("Project layout is invalid.");
  if (!Array.isArray(value.clips) || value.clips.length > MAX_CLIPS) throw new Error(`Project must contain at most ${MAX_CLIPS} clips.`);
  if (!Array.isArray(value.textLayers) || value.textLayers.length > MAX_TEXT_LAYERS) throw new Error(`Project must contain at most ${MAX_TEXT_LAYERS} text layers.`);
  if (value.audioLayers !== undefined && (!Array.isArray(value.audioLayers) || value.audioLayers.length > MAX_AUDIO_LAYERS)) throw new Error(`Project must contain at most ${MAX_AUDIO_LAYERS} audio layers.`);
  for (const clip of value.clips) {
    if (!isRecord(clip) || typeof clip.src !== "string" || !ASSET_PATH.test(clip.src)) throw new Error("Clip source must be a local /assets/ path.");
  }
  if (Array.isArray(value.audioLayers)) {
    for (const audio of value.audioLayers) {
      if (!isRecord(audio) || typeof audio.src !== "string" || !ASSET_PATH.test(audio.src)) throw new Error("Audio source must be a local /assets/ path.");
    }
  }
}

export const normalizeProject = (value: unknown): VideoProject => {
  assertVideoProject(value);
  const preset = CANVAS_PRESETS.find((candidate) => candidate.id === value.preset.id) ?? CANVAS_PRESETS[1];
  const fps = clamp(Math.round(number(value.fps, 30)), 1, 60);
  const clips = value.clips.map((raw, index) => {
    const clip = raw as unknown as Record<string, unknown>;
    const sourceDurationInFrames = Math.max(1, Math.round(number(clip.sourceDurationInFrames, fps)));
    const sourceWidth = Math.max(1, Math.round(number(clip.sourceWidth, preset.width)));
    const sourceHeight = Math.max(1, Math.round(number(clip.sourceHeight, preset.height)));
    const trimStart = clamp(Math.round(number(clip.trimStart, 0)), 0, sourceDurationInFrames - 1);
    const trimEnd = clamp(Math.round(number(clip.trimEnd, sourceDurationInFrames)), trimStart + 1, sourceDurationInFrames);
    return {
      id: text(clip.id, `clip-${index + 1}`),
      name: text(clip.name, `Clip ${index + 1}`),
      src: text(clip.src),
      sourceDurationInFrames,
      sourceWidth,
      sourceHeight,
      trimStart,
      trimEnd,
      volume: clamp(number(clip.volume, 1), 0, 1),
      fit: clip.fit === "contain" ? "contain" as const : "cover" as const,
      cropX: clamp(number(clip.cropX, 50), 0, 100),
      cropY: clamp(number(clip.cropY, 50), 0, 100),
      x: Math.round(number(clip.x, 0)),
      y: Math.round(number(clip.y, 0)),
      width: clamp(Math.round(number(clip.width, preset.width)), 1, preset.width * 2),
      height: clamp(Math.round(number(clip.height, preset.height)), 1, preset.height * 2),
    } satisfies VideoClip;
  });
  const textLayers = value.textLayers.map((raw, index) => {
    const layer = raw as unknown as Record<string, unknown>;
    return {
      id: text(layer.id, `text-${index + 1}`),
      name: text(layer.name, `Text ${index + 1}`),
      text: text(layer.text, "Text"),
      from: Math.max(0, Math.round(number(layer.from, 0))),
      durationInFrames: Math.max(1, Math.round(number(layer.durationInFrames, fps))),
      x: Math.round(number(layer.x, 90)),
      y: Math.round(number(layer.y, 180)),
      width: clamp(Math.round(number(layer.width, preset.width - 180)), 1, preset.width * 2),
      fontFamily: text(layer.fontFamily, "Inter"),
      fontSize: clamp(Math.round(number(layer.fontSize, 84)), 8, 400),
      fontWeight: clamp(Math.round(number(layer.fontWeight, 800)), 100, 900),
      color: text(layer.color, "#ffffff"),
      align: layer.align === "left" || layer.align === "right" ? layer.align : "center",
      backgroundColor: text(layer.backgroundColor, "#000000"),
      backgroundOpacity: clamp(number(layer.backgroundOpacity, 0), 0, 1),
      opacity: clamp(number(layer.opacity, 1), 0, 1),
    } satisfies TextLayer;
  });
  const audioLayers = (Array.isArray(value.audioLayers) ? value.audioLayers : []).map((raw, index) => {
    const layer = raw as unknown as Record<string, unknown>;
    const sourceDurationInFrames = Math.max(1, Math.round(number(layer.sourceDurationInFrames, fps)));
    const trimStart = clamp(Math.round(number(layer.trimStart, 0)), 0, sourceDurationInFrames - 1);
    const trimEnd = clamp(Math.round(number(layer.trimEnd, sourceDurationInFrames)), trimStart + 1, sourceDurationInFrames);
    return {
      id: text(layer.id, `audio-${index + 1}`),
      name: text(layer.name, `Audio ${index + 1}`),
      src: text(layer.src),
      sourceDurationInFrames,
      trimStart,
      trimEnd,
      from: Math.max(0, Math.round(number(layer.from, 0))),
      volume: clamp(number(layer.volume, 1), 0, 1),
    } satisfies AudioLayer;
  });
  return {
    type: "lift-code-video-project",
    version: 1,
    formatId: value.formatId,
    id: text(value.id) || undefined,
    name: text(value.name),
    fps,
    preset,
    backgroundColor: text(value.backgroundColor, "#000000"),
    clips,
    textLayers,
    audioLayers,
    updatedAt: text(value.updatedAt) || undefined,
  };
};
