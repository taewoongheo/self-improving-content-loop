import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  FileJson,
  Film,
  Layers,
  Music2,
  Plus,
  Scissors,
  Trash2,
  Type,
  Upload,
} from "lucide-react";
import { VideoComposition } from "./VideoComposition";
import {
  CANVAS_PRESETS,
  audioDuration,
  clamp,
  clipDuration,
  createProject,
  createTextLayer,
  getTextTimelineRows,
  moveItem,
  moveTextOnCanvas,
  projectDuration,
  resizeClipEdge,
  resizeAudioEdge,
  resizeTextEdge,
  resizeTextOnCanvas,
  snapTextOnCanvas,
  type CanvasSnapGuide,
  splitClip,
  uid,
  type CanvasPreset,
  type AudioLayer,
  type ResizeEdge,
  type Selection,
  type TextLayer,
  type VideoClip,
  type VideoProject,
} from "./projectModel";
import { MAX_PROJECT_BYTES, normalizeProject } from "./projectValidation";

type TimelineResize = {
  pointerId: number;
  type: "clip" | "text" | "audio";
  id: string;
  edge: ResizeEdge;
  startX: number;
  lastClientX: number;
  startScrollLeft: number;
  blockedScrollDelta: number;
  animationFrame: number;
  framesPerPixel: number;
  clip?: VideoClip;
  text?: TextLayer;
  audio?: AudioLayer;
};

type CanvasTextDrag = {
  pointerId: number;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  scale: number;
  height: number;
  layer: TextLayer;
};

const TIMELINE_PIXELS_PER_SECOND = 72;
const MIN_TIMELINE_WIDTH = 640;
const TIMELINE_TICK_SECONDS = 5;

const formatTime = (frame: number, fps: number) => {
  const seconds = Math.max(0, frame / fps);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, "0")}`;
};

const readJsonFile = async (file: File) => {
  if (file.size > MAX_PROJECT_BYTES) throw new Error("Project JSON is too large.");
  return normalizeProject(JSON.parse(await file.text()));
};

const readVideoMetadata = (file: File) => new Promise<{ duration: number; width: number; height: number }>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.onloadedmetadata = () => {
    const metadata = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    URL.revokeObjectURL(url);
    if (!Number.isFinite(metadata.duration) || metadata.duration <= 0 || metadata.width <= 0 || metadata.height <= 0) reject(new Error("Video metadata could not be read."));
    else resolve(metadata);
  };
  video.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("Video metadata could not be read."));
  };
  video.src = url;
});

const readAudioDuration = (file: File) => new Promise<number>((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.onloadedmetadata = () => {
    const duration = audio.duration;
    URL.revokeObjectURL(url);
    if (!Number.isFinite(duration) || duration <= 0) reject(new Error("Audio metadata could not be read."));
    else resolve(duration);
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error("Audio metadata could not be read."));
  };
  audio.src = url;
});

function NumberField({ label, value, min, max, step = 1, onChange }: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Number.isFinite(value) ? value : 0));
  const [isEditing, setIsEditing] = useState(false);
  const cancelCommitRef = useRef(false);

  useEffect(() => {
    if (!isEditing) setDraft(String(Number.isFinite(value) ? value : 0));
  }, [isEditing, value]);

  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next)) onChange(next);
    else setDraft(String(Number.isFinite(value) ? value : 0));
    setIsEditing(false);
  };

  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        onFocus={() => setIsEditing(true)}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraft(nextDraft);
          const next = Number(nextDraft);
          if (
            nextDraft.trim() &&
            Number.isFinite(next) &&
            (min === undefined || next >= min) &&
            (max === undefined || next <= max)
          ) onChange(next);
        }}
        onBlur={() => {
          if (cancelCommitRef.current) {
            cancelCommitRef.current = false;
            setDraft(String(Number.isFinite(value) ? value : 0));
            setIsEditing(false);
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            cancelCommitRef.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="color-field">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </label>
  );
}

export default function App() {
  const [project, setProject] = useState<VideoProject>(() => createProject());
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [formatIds, setFormatIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection>(null);
  const [status, setStatus] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isAudioUploading, setIsAudioUploading] = useState(false);
  const [isVideoDragging, setIsVideoDragging] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [showGuides, setShowGuides] = useState(true);
  const playerRef = useRef<PlayerRef>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const timelineResizeRef = useRef<TimelineResize | null>(null);
  const canvasTextDragRef = useRef<CanvasTextDrag | null>(null);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const [resizingKey, setResizingKey] = useState<string | null>(null);
  const [canvasDraggingId, setCanvasDraggingId] = useState<string | null>(null);
  const [activeCanvasSnapGuides, setActiveCanvasSnapGuides] = useState<CanvasSnapGuide[]>([]);
  const [canvasScale, setCanvasScale] = useState(1);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);

  const durationInFrames = projectDuration(project);
  const frameWidth = (frames: number) => frames / project.fps * TIMELINE_PIXELS_PER_SECOND;
  const timelineWidth = Math.max(MIN_TIMELINE_WIDTH, frameWidth(durationInFrames));
  const timelineScrollableWidth = timelineWidth + timelineViewportWidth / 2;
  const hasTimelineContent = project.clips.length > 0 || project.textLayers.length > 0 || project.audioLayers.length > 0;
  const selectedClip = selection?.type === "clip" ? project.clips.find((clip) => clip.id === selection.id) ?? null : null;
  const selectedText = selection?.type === "text" ? project.textLayers.find((layer) => layer.id === selection.id) ?? null : null;
  const selectedAudio = selection?.type === "audio" ? project.audioLayers.find((layer) => layer.id === selection.id) ?? null : null;

  useEffect(() => {
    let active = true;
    void fetch("/api/projects")
      .then(async (response) => response.ok ? response.json() as Promise<{ projects: VideoProject[] }> : null)
      .then((data) => { if (active && data) setProjects(data.projects); })
      .catch(() => undefined);
    void fetch("/api/formats")
      .then(async (response) => response.ok ? response.json() as Promise<{ formatIds: string[] }> : null)
      .then((data) => {
        if (!active || !data) return;
        setFormatIds(data.formatIds);
        setProject((current) => current.formatId || !data.formatIds[0]
          ? current
          : { ...current, formatId: data.formatIds[0] });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onFrameUpdate = (event: { detail: { frame: number } }) => setCurrentFrame(event.detail.frame);
    player.addEventListener("frameupdate", onFrameUpdate);
    return () => player.removeEventListener("frameupdate", onFrameUpdate);
  }, [project.preset.id, durationInFrames]);

  useEffect(() => {
    const frame = playerFrameRef.current;
    if (!frame) return;
    const updateScale = () => setCanvasScale(frame.clientWidth / project.preset.width);
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [project.preset.id, project.preset.width]);

  useEffect(() => {
    const scroller = timelineScrollRef.current;
    if (!scroller) return;
    const updateWidth = () => setTimelineViewportWidth(scroller.clientWidth);
    const handleWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
        ? event.deltaX
        : event.shiftKey ? event.deltaY : 0;
      if (delta === 0) return;
      event.preventDefault();
      scroller.scrollLeft = clamp(scroller.scrollLeft + delta, 0, scroller.scrollWidth - scroller.clientWidth);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(scroller);
    scroller.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    if (currentFrame >= durationInFrames) {
      const frame = durationInFrames - 1;
      playerRef.current?.seekTo(frame);
      setCurrentFrame(frame);
    }
  }, [currentFrame, durationInFrames]);

  useEffect(() => {
    if (hasTimelineContent) return;
    playerRef.current?.pause();
    playerRef.current?.seekTo(0);
    setCurrentFrame(0);
  }, [hasTimelineContent]);

  const updateClip = (id: string, update: Partial<VideoClip>) => {
    setProject((current) => ({
      ...current,
      clips: current.clips.map((clip) => clip.id === id ? { ...clip, ...update } : clip),
    }));
  };

  const updateText = (id: string, update: Partial<TextLayer>) => {
    setProject((current) => ({
      ...current,
      textLayers: current.textLayers.map((layer) => layer.id === id ? { ...layer, ...update } : layer),
    }));
  };

  const updateAudio = (id: string, update: Partial<AudioLayer>) => {
    setProject((current) => ({
      ...current,
      audioLayers: current.audioLayers.map((layer) => layer.id === id ? { ...layer, ...update } : layer),
    }));
  };

  const loadProject = (next: VideoProject) => {
    const normalized = normalizeProject(next);
    setProject(normalized);
    setSelection(normalized.clips[0] ? { type: "clip", id: normalized.clips[0].id } : normalized.textLayers[0] ? { type: "text", id: normalized.textLayers[0].id } : normalized.audioLayers[0] ? { type: "audio", id: normalized.audioLayers[0].id } : null);
    setCurrentFrame(0);
    requestAnimationFrame(() => playerRef.current?.seekTo(0));
    setStatus(`Loaded "${normalized.name || "Untitled project"}".`);
  };

  const uploadVideo = async (file?: File) => {
    if (!file) return;
    setIsUploading(true);
    setStatus("");
    try {
      const metadata = await readVideoMetadata(file);
      const response = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await response.json() as { src?: string; error?: string };
      if (!response.ok || !data.src) throw new Error(data.error || "Video upload failed.");
      const sourceDurationInFrames = Math.max(1, Math.round(metadata.duration * project.fps));
      const clip: VideoClip = {
        id: `clip-${Math.random().toString(36).slice(2, 10)}`,
        name: file.name.replace(/\.[^.]+$/, ""),
        src: data.src,
        sourceDurationInFrames,
        sourceWidth: metadata.width,
        sourceHeight: metadata.height,
        trimStart: 0,
        trimEnd: sourceDurationInFrames,
        volume: 1,
        fit: "cover",
        cropX: 50,
        cropY: 50,
        x: 0,
        y: 0,
        width: project.preset.width,
        height: project.preset.height,
      };
      setProject((current) => ({ ...current, clips: [...current.clips, clip] }));
      setSelection({ type: "clip", id: clip.id });
      setStatus(`Added "${clip.name}".`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Video upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const uploadVideos = async (files: File[]) => {
    for (const file of files) await uploadVideo(file);
  };

  const uploadAudio = async (file?: File) => {
    if (!file) return;
    setIsAudioUploading(true);
    setStatus("");
    try {
      const duration = await readAudioDuration(file);
      const response = await fetch(`/api/assets?name=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      const data = await response.json() as { src?: string; error?: string };
      if (!response.ok || !data.src) throw new Error(data.error || "Audio upload failed.");
      const sourceDurationInFrames = Math.max(1, Math.round(duration * project.fps));
      const layer: AudioLayer = {
        id: uid("audio"),
        name: file.name.replace(/\.[^.]+$/, ""),
        src: data.src,
        sourceDurationInFrames,
        trimStart: 0,
        trimEnd: sourceDurationInFrames,
        from: 0,
        volume: 1,
      };
      setProject((current) => ({ ...current, audioLayers: [...current.audioLayers, layer] }));
      setSelection({ type: "audio", id: layer.id });
      setStatus(`Added "${layer.name}".`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Audio upload failed.");
    } finally {
      setIsAudioUploading(false);
    }
  };

  const uploadAudios = async (files: File[]) => {
    for (const file of files) await uploadAudio(file);
  };

  const isFileDrag = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");

  const handleVideoDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsVideoDragging(true);
  };

  const handleVideoDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleVideoDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!isFileDrag(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsVideoDragging(false);
  };

  const handleVideoDrop = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsVideoDragging(false);
    const files = Array.from(event.dataTransfer.files);
    const videoExtensions = [".mp4", ".mov", ".m4v", ".webm"];
    const audioExtensions = [".mp3", ".wav", ".m4a", ".aac", ".ogg"];
    const videos = files.filter((candidate) =>
      candidate.type.startsWith("video/") || videoExtensions.some((extension) => candidate.name.toLowerCase().endsWith(extension)),
    );
    const audios = files.filter((candidate) =>
      candidate.type.startsWith("audio/") || audioExtensions.some((extension) => candidate.name.toLowerCase().endsWith(extension)),
    );
    if (videos.length === 0 && audios.length === 0) {
      setStatus("Drop a supported video or audio file.");
      return;
    }
    void Promise.all([uploadVideos(videos), uploadAudios(audios)]);
  };

  const addText = () => {
    const layer = createTextLayer(project);
    setProject((current) => ({ ...current, textLayers: [...current.textLayers, layer] }));
    setSelection({ type: "text", id: layer.id });
  };

  const deleteSelection = () => {
    if (!selection) return;
    setProject((current) => {
      if (selection.type === "clip") return { ...current, clips: current.clips.filter((clip) => clip.id !== selection.id) };
      if (selection.type === "text") return { ...current, textLayers: current.textLayers.filter((layer) => layer.id !== selection.id) };
      return { ...current, audioLayers: current.audioLayers.filter((layer) => layer.id !== selection.id) };
    });
    setSelection(null);
  };

  const moveSelection = (direction: -1 | 1) => {
    if (!selection) return;
    setProject((current) => {
      if (selection.type === "clip") {
        const index = current.clips.findIndex((clip) => clip.id === selection.id);
        return { ...current, clips: moveItem(current.clips, index, direction) };
      }
      if (selection.type === "audio") {
        const index = current.audioLayers.findIndex((layer) => layer.id === selection.id);
        return { ...current, audioLayers: moveItem(current.audioLayers, index, direction) };
      }
      const index = current.textLayers.findIndex((layer) => layer.id === selection.id);
      return { ...current, textLayers: moveItem(current.textLayers, index, direction) };
    });
  };

  const duplicateSelection = () => {
    if (selectedClip) {
      const copy: VideoClip = { ...selectedClip, id: uid("clip"), name: `${selectedClip.name} copy` };
      setProject((current) => {
        const index = current.clips.findIndex((clip) => clip.id === selectedClip.id);
        const clips = [...current.clips];
        clips.splice(index + 1, 0, copy);
        return { ...current, clips };
      });
      setSelection({ type: "clip", id: copy.id });
      return;
    }
    if (selectedText) {
      const copy: TextLayer = {
        ...selectedText,
        id: uid("text"),
        name: `${selectedText.name} copy`,
        x: Math.round(clamp(selectedText.x + 36, 0, Math.max(0, project.preset.width - selectedText.width))),
        y: Math.round(clamp(selectedText.y + 36, 0, Math.max(0, project.preset.height - selectedText.fontSize))),
      };
      setProject((current) => ({ ...current, textLayers: [...current.textLayers, copy] }));
      setSelection({ type: "text", id: copy.id });
      return;
    }
    if (selectedAudio) {
      const copy: AudioLayer = { ...selectedAudio, id: uid("audio"), name: `${selectedAudio.name} copy` };
      setProject((current) => ({ ...current, audioLayers: [...current.audioLayers, copy] }));
      setSelection({ type: "audio", id: copy.id });
    }
  };

  const splitSelectedClip = () => {
    if (!selectedClip) return;
    const clipStart = project.clips.slice(0, project.clips.findIndex((clip) => clip.id === selectedClip.id)).reduce((sum, clip) => sum + clipDuration(clip), 0);
    const cursor = currentFrame > clipStart && currentFrame < clipStart + clipDuration(selectedClip)
      ? currentFrame - clipStart
      : Math.floor(clipDuration(selectedClip) / 2);
    const parts = splitClip(selectedClip, cursor);
    if (!parts) return;
    setProject((current) => ({
      ...current,
      clips: current.clips.flatMap((clip) => clip.id === selectedClip.id ? parts : [clip]),
    }));
    setSelection({ type: "clip", id: parts[1].id });
  };

  const applyTimelineResize = (resize: TimelineResize) => {
    const scrollDelta = (timelineScrollRef.current?.scrollLeft ?? resize.startScrollLeft) - resize.startScrollLeft;
    const deltaFrames = Math.round(
      (resize.lastClientX - resize.startX + scrollDelta + resize.blockedScrollDelta) * resize.framesPerPixel,
    );
    setProject((current) => {
      if (resize.type === "clip" && resize.clip) {
        const next = resizeClipEdge(resize.clip, resize.edge, deltaFrames);
        return { ...current, clips: current.clips.map((clip) => clip.id === resize.id ? next : clip) };
      }
      if (resize.type === "text" && resize.text) {
        const next = resizeTextEdge(resize.text, resize.edge, deltaFrames);
        return { ...current, textLayers: current.textLayers.map((layer) => layer.id === resize.id ? next : layer) };
      }
      if (resize.type === "audio" && resize.audio) {
        const next = resizeAudioEdge(resize.audio, resize.edge, deltaFrames);
        return { ...current, audioLayers: current.audioLayers.map((layer) => layer.id === resize.id ? next : layer) };
      }
      return current;
    });
  };

  const autoScrollTimelineResize = () => {
    const resize = timelineResizeRef.current;
    const scroller = timelineScrollRef.current;
    if (!resize || !scroller) return;
    const bounds = scroller.getBoundingClientRect();
    const edgeSize = 64;
    let speed = 0;
    if (resize.lastClientX < bounds.left + edgeSize) {
      speed = -Math.ceil((bounds.left + edgeSize - resize.lastClientX) / edgeSize * 14);
    } else if (resize.lastClientX > bounds.right - edgeSize) {
      speed = Math.ceil((resize.lastClientX - (bounds.right - edgeSize)) / edgeSize * 14);
    }
    if (speed !== 0) {
      const before = scroller.scrollLeft;
      scroller.scrollLeft = clamp(before + speed, 0, scroller.scrollWidth - scroller.clientWidth);
      resize.blockedScrollDelta += speed - (scroller.scrollLeft - before);
      applyTimelineResize(resize);
    }
    resize.animationFrame = requestAnimationFrame(autoScrollTimelineResize);
  };

  const startTimelineResize = (
    event: ReactPointerEvent<HTMLSpanElement>,
    type: "clip" | "text" | "audio",
    id: string,
    edge: ResizeEdge,
  ) => {
    const clip = type === "clip" ? project.clips.find((candidate) => candidate.id === id) : undefined;
    const text = type === "text" ? project.textLayers.find((candidate) => candidate.id === id) : undefined;
    const audio = type === "audio" ? project.audioLayers.find((candidate) => candidate.id === id) : undefined;
    if (!clip && !text && !audio) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const resize: TimelineResize = {
      pointerId: event.pointerId,
      type,
      id,
      edge,
      startX: event.clientX,
      lastClientX: event.clientX,
      startScrollLeft: timelineScrollRef.current?.scrollLeft ?? 0,
      blockedScrollDelta: 0,
      animationFrame: 0,
      framesPerPixel: project.fps / TIMELINE_PIXELS_PER_SECOND,
      clip: clip ? { ...clip } : undefined,
      text: text ? { ...text } : undefined,
      audio: audio ? { ...audio } : undefined,
    };
    timelineResizeRef.current = resize;
    resize.animationFrame = requestAnimationFrame(autoScrollTimelineResize);
    setSelection({ type, id });
    setResizingKey(`${type}:${id}:${edge}`);
  };

  const moveTimelineResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = timelineResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    resize.lastClientX = event.clientX;
    applyTimelineResize(resize);
  };

  const endTimelineResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const resize = timelineResizeRef.current;
    if (resize?.pointerId !== event.pointerId) return;
    cancelAnimationFrame(resize.animationFrame);
    timelineResizeRef.current = null;
    setResizingKey(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const startCanvasTextDrag = (
    event: ReactPointerEvent<HTMLElement>,
    layer: TextLayer,
    mode: CanvasTextDrag["mode"],
  ) => {
    if (canvasScale <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    playerRef.current?.pause();
    event.currentTarget.setPointerCapture(event.pointerId);
    canvasTextDragRef.current = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      scale: canvasScale,
      height: event.currentTarget.getBoundingClientRect().height / canvasScale,
      layer: { ...layer },
    };
    setSelection({ type: "text", id: layer.id });
    setCanvasDraggingId(layer.id);
  };

  const moveCanvasTextDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = canvasTextDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = (event.clientX - drag.startX) / drag.scale;
    const deltaY = (event.clientY - drag.startY) / drag.scale;
    const moved = moveTextOnCanvas(drag.layer, deltaX, deltaY, project.preset);
    const snapped = drag.mode === "move" ? snapTextOnCanvas(moved, drag.height, project.preset) : null;
    const next = drag.mode === "move"
      ? { ...moved, x: snapped!.x, y: snapped!.y }
      : resizeTextOnCanvas(drag.layer, deltaX, project.preset);
    setActiveCanvasSnapGuides(snapped?.guides ?? []);
    setProject((current) => ({
      ...current,
      textLayers: current.textLayers.map((layer) => layer.id === drag.layer.id ? next : layer),
    }));
  };

  const endCanvasTextDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (canvasTextDragRef.current?.pointerId !== event.pointerId) return;
    canvasTextDragRef.current = null;
    setCanvasDraggingId(null);
    setActiveCanvasSnapGuides([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const changePreset = (preset: CanvasPreset) => {
    const xRatio = preset.width / project.preset.width;
    const yRatio = preset.height / project.preset.height;
    setProject((current) => ({
      ...current,
      preset,
      clips: current.clips.map((clip) => ({
        ...clip,
        x: Math.round(clip.x * xRatio),
        y: Math.round(clip.y * yRatio),
        width: Math.round(clip.width * xRatio),
        height: Math.round(clip.height * yRatio),
      })),
      textLayers: current.textLayers.map((layer) => ({
        ...layer,
        x: Math.round(layer.x * xRatio),
        y: Math.round(layer.y * yRatio),
        width: Math.round(layer.width * xRatio),
        fontSize: Math.round(layer.fontSize * Math.min(xRatio, yRatio)),
      })),
    }));
  };

  const saveProject = async () => {
    const projectToSave = { ...project, name: project.name.trim() || "Video project" };
    setIsSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectToSave),
      });
      const data = await response.json() as { project?: VideoProject; projects?: VideoProject[]; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "Project could not be saved.");
      setProject(data.project);
      if (data.projects) setProjects(data.projects);
      setStatus(`Saved to formats/${data.project.formatId}/contents/${data.project.id}.json.`);
      return data.project;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project could not be saved.");
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProject = async (projectToDelete: VideoProject) => {
    if (!projectToDelete.id) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(projectToDelete.formatId)}/${encodeURIComponent(projectToDelete.id)}`, { method: "DELETE" });
      const data = await response.json() as { projects?: VideoProject[]; error?: string };
      if (!response.ok || !data.projects) throw new Error(data.error || "Project could not be deleted.");
      setProjects(data.projects);
      setStatus(`Deleted "${projectToDelete.id}".`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project could not be deleted.");
    }
  };

  const renderProject = async () => {
    setIsRendering(true);
    setStatus("Saving project…");
    try {
      const saved = await saveProject();
      if (!saved?.id) return;
      setStatus("Rendering MP4…");
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: saved.id, formatId: saved.formatId }),
      });
      const data = await response.json() as { downloadUrl?: string; error?: string };
      if (!response.ok || !data.downloadUrl) throw new Error(data.error || "Render failed.");
      const anchor = document.createElement("a");
      anchor.href = data.downloadUrl;
      anchor.download = `${saved.id}.mp4`;
      anchor.click();
      setStatus(`Rendered renders/${saved.formatId}/${saved.id}.mp4.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Render failed.");
    } finally {
      setIsRendering(false);
    }
  };

  const importProject = async (file?: File) => {
    if (!file) return;
    try {
      loadProject(await readJsonFile(file));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project load failed.");
    }
  };

  const clipStarts = useMemo(() => {
    let cursor = 0;
    return project.clips.map((clip) => {
      const start = cursor;
      cursor += clipDuration(clip);
      return start;
    });
  }, [project.clips]);

  const textTimelineLayout = useMemo(() => getTextTimelineRows(project.textLayers), [project.textLayers]);
  const textLaneHeight = Math.max(46, 14 + textTimelineLayout.rowCount * 34);
  const audioTimelineItems = useMemo(() => project.audioLayers.map((layer) => ({
    id: layer.id,
    from: layer.from,
    durationInFrames: audioDuration(layer),
  })), [project.audioLayers]);
  const audioTimelineLayout = useMemo(() => getTextTimelineRows(audioTimelineItems), [audioTimelineItems]);
  const audioLaneHeight = Math.max(46, 14 + audioTimelineLayout.rowCount * 34);

  const timelineTicks = useMemo(() => {
    const durationSeconds = durationInFrames / project.fps;
    return Array.from(
      { length: Math.floor(durationSeconds / TIMELINE_TICK_SECONDS) + 1 },
      (_, index) => index * TIMELINE_TICK_SECONDS,
    );
  }, [durationInFrames, project.fps]);

  const seekToFrame = (frame: number) => {
    if (!hasTimelineContent) return;
    const nextFrame = clamp(Math.round(frame), 0, durationInFrames - 1);
    playerRef.current?.seekTo(nextFrame);
    setCurrentFrame(nextFrame);
  };

  const seekTimelineAt = (clientX: number, canvas: HTMLElement) => {
    const bounds = canvas.getBoundingClientRect();
    const x = clamp(clientX - bounds.left, 0, timelineWidth);
    seekToFrame(x / TIMELINE_PIXELS_PER_SECOND * project.fps);
  };

  const playerElement = useMemo(() => (
    <Player
      key={project.preset.id}
      ref={playerRef}
      component={VideoComposition}
      inputProps={{ project }}
      durationInFrames={durationInFrames}
      fps={project.fps}
      compositionWidth={project.preset.width}
      compositionHeight={project.preset.height}
      acknowledgeRemotionLicense
      numberOfSharedAudioTags={0}
      controls={hasTimelineContent}
      loop={hasTimelineContent}
      style={{ width: "100%", height: "100%" }}
    />
  ), [durationInFrames, hasTimelineContent, project]);

  return (
    <main className="app-shell">
      <input ref={videoInputRef} className="hidden-input" type="file" accept="video/mp4,video/quicktime,video/webm,.m4v" multiple onChange={(event) => {
        void uploadVideos(Array.from(event.target.files ?? []));
        event.currentTarget.value = "";
      }} />
      <input ref={audioInputRef} className="hidden-input" type="file" accept="audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg,.mp3,.wav,.m4a,.aac,.ogg" onChange={(event) => {
        void uploadAudio(event.target.files?.[0]);
        event.currentTarget.value = "";
      }} />
      <input ref={projectInputRef} className="hidden-input" type="file" accept="application/json" onChange={(event) => {
        void importProject(event.target.files?.[0]);
        event.currentTarget.value = "";
      }} />

      <header className="topbar">
        <div className="brand-block">
          <div className="mark">TV</div>
          <div>
            <h1>TikTok Video Editor</h1>
            <p>{project.preset.name} · {project.preset.width}×{project.preset.height} · {project.fps} fps</p>
          </div>
        </div>
        <div className="toolbar">
          <button aria-label="Add video file" onClick={() => videoInputRef.current?.click()} disabled={isUploading}><Film size={17} />{isUploading ? "Adding" : "Video"}</button>
          <button aria-label="Add audio file" onClick={() => audioInputRef.current?.click()} disabled={isAudioUploading}><Music2 size={17} />{isAudioUploading ? "Adding" : "Audio"}</button>
          <button onClick={addText}><Type size={17} />Text</button>
          <button onClick={() => void saveProject()} disabled={isSaving}><FileJson size={17} />{isSaving ? "Saving" : "Save Project"}</button>
          <button onClick={() => projectInputRef.current?.click()}><Upload size={17} />Load Project</button>
          <div className="divider" />
          <button className="render-button" onClick={() => void renderProject()} disabled={isRendering || isSaving}><Download size={17} />{isRendering ? "Rendering" : "MP4"}</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-title"><FileJson size={17} />Projects</div>
          <label className="field"><span>Format</span><select value={project.formatId} onChange={(event) => setProject((current) => ({ ...current, formatId: event.target.value }))}>
            <option value="" disabled>Select a format</option>
            {formatIds.map((formatId) => <option key={formatId} value={formatId}>{formatId}</option>)}
          </select></label>
          <label className="field project-name"><span>Project name</span><input value={project.name} placeholder="Video project" onChange={(event) => setProject((current) => ({ ...current, name: event.target.value }))} /></label>
          <div className="project-list">
            {projects.length ? projects.map((item) => (
              <div className="project-row" key={`${item.formatId}/${item.id}`}>
                <button className="project-card" onClick={() => loadProject(item)}>
                  <strong>{item.name || item.id}</strong>
                  <small>{item.formatId} · {item.preset.name} · {item.clips.length} clips · {formatTime(projectDuration(item), item.fps)}</small>
                </button>
                <button className="item-delete-button" title={`Delete ${item.name}`} onClick={() => void deleteProject(item)}><Trash2 size={15} /></button>
              </div>
            )) : <div className="empty-state">No saved projects.</div>}
          </div>
          {status ? <div className="status" role="status" aria-live="polite">{status}</div> : null}

          <div className="panel-title section-title"><Layers size={17} />Clips</div>
          <div className="layer-list">
            {project.clips.map((clip, index) => (
              <button key={clip.id} className={`layer-row ${selection?.type === "clip" && selection.id === clip.id ? "active" : ""}`} onClick={() => setSelection({ type: "clip", id: clip.id })}>
                <span className="layer-index">{index + 1}</span><span><strong>{clip.name}</strong><small>{formatTime(clipDuration(clip), project.fps)}</small></span>
              </button>
            ))}
          </div>

          <div className="panel-title section-title"><Type size={17} />Text</div>
          <div className="layer-list">
            {project.textLayers.map((layer) => (
              <button key={layer.id} className={`layer-row ${selection?.type === "text" && selection.id === layer.id ? "active" : ""}`} onClick={() => setSelection({ type: "text", id: layer.id })}>
                <span className="text-dot" /><span><strong>{layer.name}</strong><small>{formatTime(layer.from, project.fps)} → {formatTime(layer.from + layer.durationInFrames, project.fps)}</small></span>
              </button>
            ))}
          </div>

          <div className="panel-title section-title"><Music2 size={17} />Audio</div>
          <div className="layer-list">
            {project.audioLayers.map((layer) => (
              <button key={layer.id} className={`layer-row ${selection?.type === "audio" && selection.id === layer.id ? "active" : ""}`} onClick={() => setSelection({ type: "audio", id: layer.id })}>
                <span className="audio-dot" /><span><strong>{layer.name}</strong><small>{formatTime(layer.from, project.fps)} → {formatTime(layer.from + audioDuration(layer), project.fps)}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <section
          className={`editor-area ${isVideoDragging ? "dragging-video" : ""}`}
          onDragEnter={handleVideoDragEnter}
          onDragOver={handleVideoDragOver}
          onDragLeave={handleVideoDragLeave}
          onDrop={handleVideoDrop}
        >
          {isVideoDragging ? (
            <div className="video-drop-overlay" aria-hidden="true">
              <div><Upload size={22} /><strong>Drop video or audio to add</strong></div>
            </div>
          ) : null}
          <div className="canvas-toolbar">
            <div className="preset-switcher">
              {CANVAS_PRESETS.map((preset) => <button key={preset.id} className={project.preset.id === preset.id ? "active" : ""} onClick={() => changePreset(preset)}><strong>{preset.name}</strong><span>{preset.width}×{preset.height}</span></button>)}
            </div>
            <label className="guide-toggle"><input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} />Safe guides</label>
          </div>

          <div className="preview-wrap">
            <div ref={playerFrameRef} className={`player-frame preset-${project.preset.id}`}>
              {playerElement}
              <div
                className="canvas-interaction-layer"
                style={{
                  width: project.preset.width,
                  height: project.preset.height,
                  transform: `scale(${canvasScale})`,
                }}
              >
                {activeCanvasSnapGuides.map((guide) => (
                  <span
                    key={`${guide.orientation}-${guide.position}`}
                    className={`canvas-snap-guide ${guide.orientation}`}
                    aria-hidden="true"
                    style={guide.orientation === "vertical"
                      ? { left: guide.position, width: 2 / canvasScale }
                      : { top: guide.position, height: 2 / canvasScale }}
                  />
                ))}
                {project.textLayers
                  .filter((layer) => currentFrame >= layer.from && currentFrame < layer.from + layer.durationInFrames)
                  .map((layer, index) => {
                    const isSelected = selection?.type === "text" && selection.id === layer.id;
                    const isDragging = canvasDraggingId === layer.id;
                    return (
                      <div
                        key={layer.id}
                        className={`canvas-text-box ${isSelected ? "selected" : ""} ${isDragging ? "dragging" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-label={`Select ${layer.name} text layer`}
                        style={{
                          left: layer.x,
                          top: layer.y,
                          width: layer.width,
                          minHeight: layer.fontSize * 1.08,
                          padding: "0.14em 0.22em",
                          fontFamily: layer.fontFamily,
                          fontSize: layer.fontSize,
                          fontWeight: layer.fontWeight,
                          lineHeight: 1.08,
                          textAlign: layer.align,
                          zIndex: index + 1,
                          outlineWidth: isSelected ? 1.5 / canvasScale : 0,
                          outlineOffset: 2 / canvasScale,
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelection({ type: "text", id: layer.id });
                          }
                        }}
                        onPointerDown={(event) => startCanvasTextDrag(event, layer, "move")}
                        onPointerMove={moveCanvasTextDrag}
                        onPointerUp={endCanvasTextDrag}
                        onPointerCancel={endCanvasTextDrag}
                      >
                        {layer.text || "Text"}
                        {isSelected ? (
                          <span
                            className="canvas-width-handle"
                            aria-hidden="true"
                            style={{
                              width: 18 / canvasScale,
                              right: -9 / canvasScale,
                            }}
                            onPointerDown={(event) => startCanvasTextDrag(event, layer, "resize")}
                            onPointerMove={moveCanvasTextDrag}
                            onPointerUp={endCanvasTextDrag}
                            onPointerCancel={endCanvasTextDrag}
                          >
                            <span style={{ width: 10 / canvasScale, height: 10 / canvasScale, borderWidth: 2 / canvasScale }} />
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
              </div>
              {!hasTimelineContent ? <div className="empty-preview">Drop an MP4 or use the Video button</div> : null}
              {showGuides ? <div className="safe-guides"><div className="safe-box" /><div className="center-line vertical" /><div className="center-line horizontal" /></div> : null}
            </div>
          </div>

          <div className="timeline-panel">
            <div className="timeline-header">
              <strong>Timeline</strong>
              <span>{formatTime(hasTimelineContent ? currentFrame : 0, project.fps)} / {formatTime(hasTimelineContent ? durationInFrames : 0, project.fps)}</span>
            </div>
            <div className="timeline-body">
              <div className="timeline-labels" style={{ gridTemplateRows: `24px 46px ${textLaneHeight}px ${audioLaneHeight}px` }} aria-hidden="true">
                <span>TIME</span>
                <span>VIDEO</span>
                <span className="multiline-track-label">TEXT</span>
                <span className="multiline-track-label">AUDIO</span>
              </div>
              <div ref={timelineScrollRef} className="timeline-scroll">
                <div
                  className="timeline-canvas"
                  style={{ width: timelineScrollableWidth }}
                  role="region"
                  tabIndex={0}
                  aria-label={`Timeline position ${formatTime(currentFrame, project.fps)} of ${formatTime(durationInFrames, project.fps)}`}
                  onClick={(event) => seekTimelineAt(event.clientX, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const step = event.shiftKey ? project.fps : 1;
                    seekToFrame(currentFrame + (event.key === "ArrowRight" ? step : -step));
                  }}
                >
                  <div className="timeline-ruler" style={{ width: timelineWidth }} aria-hidden="true">
                    {timelineTicks.map((seconds) => (
                      <span key={seconds} className="timeline-tick" style={{ left: seconds * TIMELINE_PIXELS_PER_SECOND }}>
                        <span>{formatTime(seconds * project.fps, project.fps)}</span>
                      </span>
                    ))}
                  </div>
                  <div className="track-content timeline-lane" style={{ width: timelineWidth }}>
                    {project.clips.length ? project.clips.map((clip, index) => (
                      <button
                        key={clip.id}
                        className={`clip-block ${selection?.type === "clip" && selection.id === clip.id ? "active" : ""} ${resizingKey?.startsWith(`clip:${clip.id}:`) ? "resizing" : ""}`}
                        style={{ flex: `0 0 ${Math.max(24, frameWidth(clipDuration(clip)))}px` }}
                        title={`${formatTime(clipStarts[index], project.fps)} · ${clip.name}`}
                        onClick={() => setSelection({ type: "clip", id: clip.id })}
                      >
                        <span className="resize-handle start" aria-hidden="true" onPointerDown={(event) => startTimelineResize(event, "clip", clip.id, "start")} onPointerMove={moveTimelineResize} onPointerUp={endTimelineResize} onPointerCancel={endTimelineResize} />
                        <span className="block-label">{clip.name}</span>
                        <span className="resize-handle end" aria-hidden="true" onPointerDown={(event) => startTimelineResize(event, "clip", clip.id, "end")} onPointerMove={moveTimelineResize} onPointerUp={endTimelineResize} onPointerCancel={endTimelineResize} />
                      </button>
                    )) : <div className="track-empty">Add a video to start.</div>}
                  </div>
                  <div className="track-content timeline-lane layered" style={{ width: timelineWidth, height: textLaneHeight }}>
                    {project.textLayers.map((layer) => (
                      <button
                        key={layer.id}
                        className={`text-block ${selection?.type === "text" && selection.id === layer.id ? "active" : ""} ${resizingKey?.startsWith(`text:${layer.id}:`) ? "resizing" : ""}`}
                        style={{
                          left: frameWidth(layer.from),
                          top: 7 + (textTimelineLayout.rows[layer.id] ?? 0) * 34,
                          width: Math.max(24, frameWidth(layer.durationInFrames)),
                        }}
                        onClick={() => setSelection({ type: "text", id: layer.id })}
                      >
                        <span className="resize-handle start" aria-hidden="true" onPointerDown={(event) => startTimelineResize(event, "text", layer.id, "start")} onPointerMove={moveTimelineResize} onPointerUp={endTimelineResize} onPointerCancel={endTimelineResize} />
                        <span className="block-label">{layer.name}</span>
                        <span className="resize-handle end" aria-hidden="true" onPointerDown={(event) => startTimelineResize(event, "text", layer.id, "end")} onPointerMove={moveTimelineResize} onPointerUp={endTimelineResize} onPointerCancel={endTimelineResize} />
                      </button>
                    ))}
                  </div>
                  <div className="track-content timeline-lane layered" style={{ width: timelineWidth, height: audioLaneHeight }}>
                    {project.audioLayers.map((layer) => (
                      <button
                        key={layer.id}
                        className={`audio-block ${selection?.type === "audio" && selection.id === layer.id ? "active" : ""} ${resizingKey?.startsWith(`audio:${layer.id}:`) ? "resizing" : ""}`}
                        style={{
                          left: frameWidth(layer.from),
                          top: 7 + (audioTimelineLayout.rows[layer.id] ?? 0) * 34,
                          width: Math.max(24, frameWidth(audioDuration(layer))),
                        }}
                        onClick={() => setSelection({ type: "audio", id: layer.id })}
                      >
                        <span className="resize-handle start" aria-hidden="true" onPointerDown={(event) => startTimelineResize(event, "audio", layer.id, "start")} onPointerMove={moveTimelineResize} onPointerUp={endTimelineResize} onPointerCancel={endTimelineResize} />
                        <span className="block-label">{layer.name}</span>
                        <span className="resize-handle end" aria-hidden="true" onPointerDown={(event) => startTimelineResize(event, "audio", layer.id, "end")} onPointerMove={moveTimelineResize} onPointerUp={endTimelineResize} onPointerCancel={endTimelineResize} />
                      </button>
                    ))}
                  </div>
                  <div className="timeline-playhead" style={{ left: frameWidth(currentFrame) }} aria-hidden="true"><span /></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="inspector">
          <div className="panel-title"><Layers size={17} />Properties</div>
          {selection ? <div className="inspector-actions">
            <button aria-label="Move selected item left" title="Move left" onClick={() => moveSelection(-1)}><ArrowLeft size={15} /></button>
            <button aria-label="Move selected item right" title="Move right" onClick={() => moveSelection(1)}><ArrowRight size={15} /></button>
            {selectedClip ? <button aria-label="Split selected video at playhead" title="Split at playhead" onClick={splitSelectedClip}><Scissors size={15} /></button> : null}
            <button aria-label={`Duplicate selected ${selection.type}`} title="Duplicate" onClick={duplicateSelection}><Copy size={15} /></button>
            <button className="danger" aria-label={`Delete selected ${selection.type}`} title="Delete" onClick={deleteSelection}><Trash2 size={15} /></button>
          </div> : null}

          {selectedClip ? <div className="inspector-stack">
            <div className="selection-card"><strong>{selectedClip.name}</strong><span>Video clip · {formatTime(clipDuration(selectedClip), project.fps)}</span></div>
            <label className="field"><span>Name</span><input value={selectedClip.name} onChange={(event) => updateClip(selectedClip.id, { name: event.target.value })} /></label>
            <div className="field-grid"><NumberField label="Trim start" value={selectedClip.trimStart} min={0} max={selectedClip.trimEnd - 1} onChange={(value) => updateClip(selectedClip.id, { trimStart: clamp(Math.round(value), 0, selectedClip.trimEnd - 1) })} /><NumberField label="Trim end" value={selectedClip.trimEnd} min={selectedClip.trimStart + 1} max={selectedClip.sourceDurationInFrames} onChange={(value) => updateClip(selectedClip.id, { trimEnd: clamp(Math.round(value), selectedClip.trimStart + 1, selectedClip.sourceDurationInFrames) })} /></div>
            <label className="field"><span>Fit</span><select value={selectedClip.fit} onChange={(event) => updateClip(selectedClip.id, { fit: event.target.value as VideoClip["fit"] })}><option value="cover">Fill frame</option><option value="contain">Fit inside</option></select></label>
            <label className="field"><span>Volume · {Math.round(selectedClip.volume * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={selectedClip.volume} onChange={(event) => updateClip(selectedClip.id, { volume: Number(event.target.value) })} /></label>
            {selectedClip.fit === "cover" ? (
              <div className="field-grid"><NumberField label="Crop X (%)" value={selectedClip.cropX} min={0} max={100} onChange={(value) => updateClip(selectedClip.id, { cropX: clamp(value, 0, 100) })} /><NumberField label="Crop Y (%)" value={selectedClip.cropY} min={0} max={100} onChange={(value) => updateClip(selectedClip.id, { cropY: clamp(value, 0, 100) })} /></div>
            ) : (
              <div className="field-grid"><NumberField label="X" value={selectedClip.x} onChange={(value) => updateClip(selectedClip.id, { x: Math.round(value) })} /><NumberField label="Y" value={selectedClip.y} onChange={(value) => updateClip(selectedClip.id, { y: Math.round(value) })} /><NumberField label="Width" value={selectedClip.width} min={1} onChange={(value) => updateClip(selectedClip.id, { width: Math.max(1, Math.round(value)) })} /><NumberField label="Height" value={selectedClip.height} min={1} onChange={(value) => updateClip(selectedClip.id, { height: Math.max(1, Math.round(value)) })} /></div>
            )}
          </div> : null}

          {selectedText ? <div className="inspector-stack">
            <div className="selection-card"><strong>{selectedText.name}</strong><span>Text layer</span></div>
            <label className="field"><span>Name</span><input value={selectedText.name} onChange={(event) => updateText(selectedText.id, { name: event.target.value })} /></label>
            <label className="field"><span>Text</span><textarea rows={4} value={selectedText.text} onChange={(event) => updateText(selectedText.id, { text: event.target.value })} /></label>
            <div className="field-grid"><NumberField label="Start frame" value={selectedText.from} min={0} onChange={(value) => updateText(selectedText.id, { from: Math.max(0, Math.round(value)) })} /><NumberField label="Duration" value={selectedText.durationInFrames} min={1} onChange={(value) => updateText(selectedText.id, { durationInFrames: Math.max(1, Math.round(value)) })} /></div>
            <div className="field-grid"><NumberField label="X" value={selectedText.x} onChange={(value) => updateText(selectedText.id, { x: Math.round(value) })} /><NumberField label="Y" value={selectedText.y} onChange={(value) => updateText(selectedText.id, { y: Math.round(value) })} /><NumberField label="Width" value={selectedText.width} min={1} onChange={(value) => updateText(selectedText.id, { width: Math.max(1, Math.round(value)) })} /><NumberField label="Font size" value={selectedText.fontSize} min={8} max={400} onChange={(value) => updateText(selectedText.id, { fontSize: clamp(Math.round(value), 8, 400) })} /></div>
            <label className="field"><span>Font</span><select value={selectedText.fontFamily} onChange={(event) => updateText(selectedText.id, { fontFamily: event.target.value })}><option value="Inter">Inter</option><option value="Arial Black">Arial Black</option><option value="Impact">Impact</option><option value="Georgia">Georgia</option></select></label>
            <label className="field"><span>Weight</span><select value={selectedText.fontWeight} onChange={(event) => updateText(selectedText.id, { fontWeight: Number(event.target.value) })}>{[400, 600, 700, 800, 900].map((weight) => <option key={weight} value={weight}>{weight}</option>)}</select></label>
            <div className="align-control"><button className={selectedText.align === "left" ? "active" : ""} onClick={() => updateText(selectedText.id, { align: "left" })}><AlignLeft size={16} /></button><button className={selectedText.align === "center" ? "active" : ""} onClick={() => updateText(selectedText.id, { align: "center" })}><AlignCenter size={16} /></button><button className={selectedText.align === "right" ? "active" : ""} onClick={() => updateText(selectedText.id, { align: "right" })}><AlignRight size={16} /></button></div>
            <ColorField label="Text color" value={selectedText.color} onChange={(value) => updateText(selectedText.id, { color: value })} />
            <ColorField label="Background" value={selectedText.backgroundColor} onChange={(value) => updateText(selectedText.id, { backgroundColor: value })} />
            <label className="field"><span>Background opacity · {Math.round(selectedText.backgroundOpacity * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={selectedText.backgroundOpacity} onChange={(event) => updateText(selectedText.id, { backgroundOpacity: Number(event.target.value) })} /></label>
            <label className="field"><span>Opacity · {Math.round(selectedText.opacity * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={selectedText.opacity} onChange={(event) => updateText(selectedText.id, { opacity: Number(event.target.value) })} /></label>
          </div> : null}

          {selectedAudio ? <div className="inspector-stack">
            <div className="selection-card"><strong>{selectedAudio.name}</strong><span>Audio layer · {formatTime(audioDuration(selectedAudio), project.fps)}</span></div>
            <label className="field"><span>Name</span><input value={selectedAudio.name} onChange={(event) => updateAudio(selectedAudio.id, { name: event.target.value })} /></label>
            <NumberField label="Start frame" value={selectedAudio.from} min={0} onChange={(value) => updateAudio(selectedAudio.id, { from: Math.max(0, Math.round(value)) })} />
            <div className="field-grid"><NumberField label="Trim start" value={selectedAudio.trimStart} min={0} max={selectedAudio.trimEnd - 1} onChange={(value) => updateAudio(selectedAudio.id, { trimStart: clamp(Math.round(value), 0, selectedAudio.trimEnd - 1) })} /><NumberField label="Trim end" value={selectedAudio.trimEnd} min={selectedAudio.trimStart + 1} max={selectedAudio.sourceDurationInFrames} onChange={(value) => updateAudio(selectedAudio.id, { trimEnd: clamp(Math.round(value), selectedAudio.trimStart + 1, selectedAudio.sourceDurationInFrames) })} /></div>
            <label className="field"><span>Volume · {Math.round(selectedAudio.volume * 100)}%</span><input type="range" min="0" max="1" step="0.01" value={selectedAudio.volume} onChange={(event) => updateAudio(selectedAudio.id, { volume: Number(event.target.value) })} /></label>
          </div> : null}

          {!selection ? <div className="inspector-stack">
            <div className="selection-card"><strong>Project</strong><span>Select a clip, text, or audio layer to edit it.</span></div>
            <ColorField label="Canvas background" value={project.backgroundColor} onChange={(value) => setProject((current) => ({ ...current, backgroundColor: value }))} />
          </div> : null}
        </aside>
      </section>
    </main>
  );
}
