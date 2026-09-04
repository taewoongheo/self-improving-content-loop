export type CanvasPreset = {
  id: "tiktok_4_5" | "tiktok_9_16";
  name: string;
  width: number;
  height: number;
};

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: "tiktok_4_5", name: "TikTok 4:5", width: 1080, height: 1350 },
  { id: "tiktok_9_16", name: "TikTok 9:16", width: 1080, height: 1920 },
];

export type VideoClip = {
  id: string;
  name: string;
  src: string;
  sourceDurationInFrames: number;
  sourceWidth: number;
  sourceHeight: number;
  trimStart: number;
  trimEnd: number;
  volume: number;
  fit: "cover" | "contain";
  cropX: number;
  cropY: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextLayer = {
  id: string;
  name: string;
  text: string;
  from: number;
  durationInFrames: number;
  x: number;
  y: number;
  width: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: "left" | "center" | "right";
  backgroundColor: string;
  backgroundOpacity: number;
  opacity: number;
};

export type AudioLayer = {
  id: string;
  name: string;
  src: string;
  sourceDurationInFrames: number;
  trimStart: number;
  trimEnd: number;
  from: number;
  volume: number;
};

export type VideoProject = {
  type: "lift-code-video-project";
  version: 1;
  formatId: string;
  id?: string;
  name: string;
  fps: number;
  preset: CanvasPreset;
  backgroundColor: string;
  clips: VideoClip[];
  textLayers: TextLayer[];
  audioLayers: AudioLayer[];
  updatedAt?: string;
};

export type Selection = { type: "clip" | "text" | "audio"; id: string } | null;

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const clipDuration = (clip: VideoClip) => Math.max(1, clip.trimEnd - clip.trimStart);
export const audioDuration = (audio: AudioLayer) => Math.max(1, audio.trimEnd - audio.trimStart);
export const getCoverPlacement = (clip: VideoClip, canvas: CanvasPreset) => {
  const sourceRatio = clip.sourceWidth / clip.sourceHeight;
  const canvasRatio = canvas.width / canvas.height;
  const cropX = clamp(clip.cropX, 0, 100) / 100;
  const cropY = clamp(clip.cropY, 0, 100) / 100;

  if (sourceRatio > canvasRatio) {
    const height = canvas.height;
    const width = height * sourceRatio;
    return { left: -(width - canvas.width) * cropX, top: 0, width, height };
  }

  const width = canvas.width;
  const height = width / sourceRatio;
  return { left: 0, top: -(height - canvas.height) * cropY, width, height };
};
export const projectDuration = (project: Pick<VideoProject, "clips" | "textLayers"> & Partial<Pick<VideoProject, "audioLayers">>) => {
  const clipsDuration = project.clips.reduce((sum, clip) => sum + clipDuration(clip), 0);
  const textDuration = project.textLayers.reduce((max, layer) => Math.max(max, layer.from + layer.durationInFrames), 0);
  const audioLayers = project.audioLayers ?? [];
  const audioEnd = audioLayers.reduce((max, layer) => Math.max(max, layer.from + audioDuration(layer)), 0);
  return Math.max(2, clipsDuration, textDuration, audioEnd);
};

export const createProject = (): VideoProject => ({
  type: "lift-code-video-project",
  version: 1,
  formatId: "",
  name: "",
  fps: 30,
  preset: CANVAS_PRESETS[1],
  backgroundColor: "#000000",
  clips: [],
  textLayers: [],
  audioLayers: [],
});

export const createTextLayer = (project: VideoProject): TextLayer => ({
  id: uid("text"),
  name: `Text ${project.textLayers.length + 1}`,
  text: "Your text",
  from: 0,
  durationInFrames: projectDuration(project),
  x: 90,
  y: Math.round(project.preset.height * 0.15),
  width: project.preset.width - 180,
  fontFamily: "Inter",
  fontSize: 84,
  fontWeight: 800,
  color: "#ffffff",
  align: "center",
  backgroundColor: "#000000",
  backgroundOpacity: 0,
  opacity: 1,
});

export const moveItem = <T,>(items: T[], index: number, direction: -1 | 1) => {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

export const splitClip = (clip: VideoClip, localFrame: number): [VideoClip, VideoClip] | null => {
  const duration = clipDuration(clip);
  const splitAt = clamp(Math.round(localFrame), 1, duration - 1);
  if (duration < 2 || splitAt <= 0 || splitAt >= duration) return null;
  const sourceSplit = clip.trimStart + splitAt;
  return [
    { ...clip, id: uid("clip"), name: `${clip.name} A`, trimEnd: sourceSplit },
    { ...clip, id: uid("clip"), name: `${clip.name} B`, trimStart: sourceSplit },
  ];
};

export type ResizeEdge = "start" | "end";

export const resizeClipEdge = (clip: VideoClip, edge: ResizeEdge, deltaFrames: number): VideoClip => edge === "start"
  ? { ...clip, trimStart: clamp(clip.trimStart + Math.round(deltaFrames), 0, clip.trimEnd - 1) }
  : { ...clip, trimEnd: clamp(clip.trimEnd + Math.round(deltaFrames), clip.trimStart + 1, clip.sourceDurationInFrames) };

export const resizeTextEdge = (layer: TextLayer, edge: ResizeEdge, deltaFrames: number): TextLayer => {
  if (edge === "end") return { ...layer, durationInFrames: Math.max(1, layer.durationInFrames + Math.round(deltaFrames)) };
  const end = layer.from + layer.durationInFrames;
  const from = clamp(layer.from + Math.round(deltaFrames), 0, end - 1);
  return { ...layer, from, durationInFrames: end - from };
};

export const resizeAudioEdge = (layer: AudioLayer, edge: ResizeEdge, deltaFrames: number): AudioLayer => {
  const delta = Math.round(deltaFrames);
  if (edge === "end") {
    return { ...layer, trimEnd: clamp(layer.trimEnd + delta, layer.trimStart + 1, layer.sourceDurationInFrames) };
  }
  const applied = clamp(delta, -Math.min(layer.from, layer.trimStart), audioDuration(layer) - 1);
  return { ...layer, from: layer.from + applied, trimStart: layer.trimStart + applied };
};

export const getTextTimelineRows = (
  layers: Pick<TextLayer, "id" | "from" | "durationInFrames">[],
) => {
  const rowEnds: number[] = [];
  const rows: Record<string, number> = {};
  [...layers]
    .sort((left, right) => left.from - right.from || left.durationInFrames - right.durationInFrames)
    .forEach((layer) => {
      let row = rowEnds.findIndex((end) => end <= layer.from);
      if (row === -1) row = rowEnds.length;
      rowEnds[row] = layer.from + layer.durationInFrames;
      rows[layer.id] = row;
    });
  return { rows, rowCount: rowEnds.length };
};

export const moveTextOnCanvas = (layer: TextLayer, deltaX: number, deltaY: number, canvas: CanvasPreset): TextLayer => ({
  ...layer,
  x: Math.round(clamp(layer.x + deltaX, 0, Math.max(0, canvas.width - Math.min(layer.width, canvas.width)))),
  y: Math.round(clamp(layer.y + deltaY, 0, Math.max(0, canvas.height - layer.fontSize))),
});

export type CanvasSnapGuide = { orientation: "vertical" | "horizontal"; position: number };

const getAxisSnap = (origin: number, size: number, guides: number[], threshold: number) => {
  let best: { delta: number; guide: number; distance: number } | null = null;
  for (const guide of guides) {
    for (const anchor of [origin, origin + size / 2, origin + size]) {
      const delta = guide - anchor;
      const distance = Math.abs(delta);
      if (distance <= threshold && (!best || distance < best.distance)) best = { delta, guide, distance };
    }
  }
  return best;
};

export const snapTextOnCanvas = (
  layer: Pick<TextLayer, "x" | "y" | "width">,
  height: number,
  canvas: CanvasPreset,
  threshold = 12,
) => {
  const safeInsetX = Math.round(canvas.width * 0.067);
  const safeTop = Math.round(canvas.height * 0.115);
  const safeBottom = Math.round(canvas.height * 0.177);
  const xSnap = getAxisSnap(layer.x, layer.width, [safeInsetX, Math.round(canvas.width / 2), canvas.width - safeInsetX], threshold);
  const ySnap = getAxisSnap(layer.y, height, [safeTop, Math.round(canvas.height / 2), canvas.height - safeBottom], threshold);
  const guides: CanvasSnapGuide[] = [];
  if (xSnap) guides.push({ orientation: "vertical", position: xSnap.guide });
  if (ySnap) guides.push({ orientation: "horizontal", position: ySnap.guide });
  return {
    x: Math.round(clamp(layer.x + (xSnap?.delta ?? 0), 0, Math.max(0, canvas.width - layer.width))),
    y: Math.round(clamp(layer.y + (ySnap?.delta ?? 0), 0, Math.max(0, canvas.height - height))),
    guides,
  };
};

export const resizeTextOnCanvas = (layer: TextLayer, deltaX: number, canvas: CanvasPreset): TextLayer => ({
  ...layer,
  width: Math.round(clamp(layer.width + deltaX, 80, Math.max(80, canvas.width - layer.x))),
});
