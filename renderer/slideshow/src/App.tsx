import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import JSZip from "jszip";
import { Ellipse, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer, Group } from "react-konva";
import type Konva from "konva";
import {
  Copy,
  Download,
  FileJson,
  ImageUp,
  Layers,
  LayoutGrid,
  Plus,
  Rows3,
  Save,
  Circle as CircleIcon,
  Square,
  Trash2,
  Type,
  Underline,
  Upload,
} from "lucide-react";
import {
  dataUrlToBlob,
  downloadDataUrl,
  loadHtmlImage,
  readFileAsDataUrl,
  saveTextFile,
  useLoadedImage,
} from "./browserFiles";
import {
  CANVAS_PRESETS,
  FIXED_WEIGHT_FONTS,
  clamp,
  createSlide,
  defaultLabelLayer,
  defaultShapeLayer,
  defaultTextLayer,
  getShapeRenderGeometry,
  isImageLayer,
  isShapeLayer,
  isTextLayer,
  makePreset,
  normalizeImageLayer,
  normalizeShapeLayer,
  normalizeCanvasPreset,
  normalizeSlideBackground,
  normalizeTextLayer,
  scaleLayerForCanvas,
  isTextRangeUnderlined,
  toggleUnderlineMark,
  uid,
  type Align,
  type CanvasPreset,
  type ImageLayerModel,
  type ImagePlacementMode,
  type ProjectFile,
  type Selection,
  type Slide,
  type SlideLayerModel,
  type ShapeLayerModel,
  type TextLayerModel,
} from "./editorModel";
import { normalizeProjectFile } from "./projectIO";
import { MAX_PROJECT_BYTES } from "./projectValidation.ts";
import { getFittedTextWidth, getTextHeight, getTextUnderlineSegments, renderSlideToDataUrl } from "./slideRenderer";
import { BRAND_BADGE, getBrandBadgeGeometry } from "./brandBadge";

type SnapGuide = {
  orientation: "vertical" | "horizontal";
  position: number;
};

type SnapGuides = {
  vertical: number[];
  horizontal: number[];
};

type TextSelectionRange = {
  layerId: string;
  start: number;
  end: number;
};

type ImageUploadMode = "free" | ImagePlacementMode;

type ImagePlacementSlot = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ImageCrop = NonNullable<ImageLayerModel["crop"]>;

type CropPanState = {
  pointer: {
    x: number;
    y: number;
  };
  crop: ImageCrop;
};

const SNAP_THRESHOLD = 12;

const getImageCoverCrop = (naturalWidth: number, naturalHeight: number, targetWidth: number, targetHeight: number) => {
  const sourceRatio = naturalWidth / naturalHeight;
  const targetRatio = targetWidth / targetHeight;

  if (sourceRatio > targetRatio) {
    const width = naturalHeight * targetRatio;
    return {
      x: Math.round((naturalWidth - width) / 2),
      y: 0,
      width: Math.round(width),
      height: naturalHeight,
    };
  }

  const height = naturalWidth / targetRatio;
  return {
    x: 0,
    y: Math.round((naturalHeight - height) / 2),
    width: naturalWidth,
    height: Math.round(height),
  };
};

const clampImageCrop = (crop: ImageCrop, naturalWidth: number, naturalHeight: number): ImageCrop => {
  const width = clamp(crop.width, 1, naturalWidth);
  const height = clamp(crop.height, 1, naturalHeight);
  return {
    x: clamp(crop.x, 0, Math.max(0, naturalWidth - width)),
    y: clamp(crop.y, 0, Math.max(0, naturalHeight - height)),
    width,
    height,
  };
};

const getLayerCrop = (layer: ImageLayerModel): ImageCrop =>
  clampImageCrop(
    layer.crop ?? getImageCoverCrop(layer.naturalWidth, layer.naturalHeight, layer.width, layer.height),
    layer.naturalWidth,
    layer.naturalHeight,
  );

const getPannedImageCrop = (layer: ImageLayerModel, startCrop: ImageCrop, deltaX: number, deltaY: number) => {
  const nextCrop = {
    ...startCrop,
    x: startCrop.x - deltaX * (startCrop.width / layer.width),
    y: startCrop.y - deltaY * (startCrop.height / layer.height),
  };
  return clampImageCrop(nextCrop, layer.naturalWidth, layer.naturalHeight);
};

const getImagePlacementSlots = (mode: ImagePlacementMode, canvas: CanvasPreset): ImagePlacementSlot[] => {
  if (mode === "grid-2x2") {
    const leftWidth = Math.floor(canvas.width / 2);
    const topHeight = Math.floor(canvas.height / 2);
    const rightWidth = canvas.width - leftWidth;
    const bottomHeight = canvas.height - topHeight;

    return [
      { x: 0, y: 0, width: leftWidth, height: topHeight },
      { x: leftWidth, y: 0, width: rightWidth, height: topHeight },
      { x: 0, y: topHeight, width: leftWidth, height: bottomHeight },
      { x: leftWidth, y: topHeight, width: rightWidth, height: bottomHeight },
    ];
  }

  const firstHeight = Math.floor(canvas.height / 3);
  const secondHeight = Math.floor(canvas.height / 3);
  const thirdHeight = canvas.height - firstHeight - secondHeight;
  return [
    { x: 0, y: 0, width: canvas.width, height: firstHeight },
    { x: 0, y: firstHeight, width: canvas.width, height: secondHeight },
    { x: 0, y: firstHeight + secondHeight, width: canvas.width, height: thirdHeight },
  ];
};

const getTextLayerBoxSize = (layer: TextLayerModel, textHeight: number) => ({
  width: layer.box.enabled ? layer.width + layer.box.paddingX * 2 : layer.width,
  height: layer.box.enabled ? textHeight + layer.box.paddingY * 2 : textHeight,
});

const getAxisSnap = (origin: number, size: number, guides: number[]) => {
  let bestSnap: { delta: number; guide: number; distance: number } | null = null;

  for (const guide of guides) {
    const anchors = [origin, origin + size / 2, origin + size];
    for (const anchor of anchors) {
      const delta = guide - anchor;
      const distance = Math.abs(delta);
      if (distance > SNAP_THRESHOLD) continue;
      if (!bestSnap || distance < bestSnap.distance) {
        bestSnap = { delta, guide, distance };
      }
    }
  }

  return bestSnap;
};

const getSnappedBoxPosition = (
  size: { width: number; height: number },
  x: number,
  y: number,
  guides: SnapGuides,
) => {
  const xSnap = getAxisSnap(x, size.width, guides.vertical);
  const ySnap = getAxisSnap(y, size.height, guides.horizontal);
  const activeGuides: SnapGuide[] = [];

  if (xSnap) activeGuides.push({ orientation: "vertical", position: xSnap.guide });
  if (ySnap) activeGuides.push({ orientation: "horizontal", position: ySnap.guide });

  return {
    x: x + (xSnap?.delta ?? 0),
    y: y + (ySnap?.delta ?? 0),
    activeGuides,
  };
};

const getSnappedTextPosition = (
  layer: TextLayerModel,
  textHeight: number,
  x: number,
  y: number,
  guides: SnapGuides,
) => {
  return getSnappedBoxPosition(getTextLayerBoxSize(layer, textHeight), x, y, guides);
};

const areSnapGuidesEqual = (left: SnapGuide[], right: SnapGuide[]) =>
  left.length === right.length &&
  left.every((guide, index) => {
    const other = right[index];
    return other && guide.orientation === other.orientation && guide.position === other.position;
  });

function TextLayerNode({
  layer,
  isSelected,
  snapGuides,
  onSelect,
  onChange,
  onSnapGuidesChange,
}: {
  layer: TextLayerModel;
  isSelected: boolean;
  snapGuides: SnapGuides;
  onSelect: () => void;
  onChange: (next: Partial<TextLayerModel>) => void;
  onSnapGuidesChange: (guides: SnapGuide[]) => void;
}) {
  const textHeight = useMemo(() => getTextHeight(layer), [layer]);
  const underlineSegments = useMemo(() => getTextUnderlineSegments(layer), [layer]);
  const boxWidth = layer.width + layer.box.paddingX * 2;
  const boxHeight = textHeight + layer.box.paddingY * 2;
  const textOffsetX = layer.box.enabled ? layer.box.paddingX : 0;
  const textOffsetY = layer.box.enabled ? layer.box.paddingY : 0;

  return (
    <Group
      id={layer.id}
      x={layer.x}
      y={layer.y}
      rotation={layer.rotation}
      opacity={layer.opacity}
      draggable
      onClick={(event) => {
        event.cancelBubble = true;
        onSelect();
      }}
      onTap={(event) => {
        event.cancelBubble = true;
        onSelect();
      }}
      onDragStart={() => onSelect()}
      onDragMove={(event) => {
        const snapped = getSnappedTextPosition(layer, textHeight, event.target.x(), event.target.y(), snapGuides);
        event.target.position({ x: snapped.x, y: snapped.y });
        onSnapGuidesChange(snapped.activeGuides);
      }}
      onDragEnd={(event) => {
        const snapped = getSnappedTextPosition(layer, textHeight, event.target.x(), event.target.y(), snapGuides);
        event.target.position({ x: snapped.x, y: snapped.y });
        onSnapGuidesChange([]);
        onChange({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const scaleX = node.scaleX();
        node.scaleX(1);
        node.scaleY(1);
        onChange({
          x: Math.round(node.x()),
          y: Math.round(node.y()),
          rotation: Math.round(node.rotation()),
          width: Math.max(80, Math.round(layer.width * Math.abs(scaleX))),
        });
      }}
    >
      {layer.box.enabled ? (
        <Rect
          width={boxWidth}
          height={boxHeight}
          fill={layer.box.fill}
          cornerRadius={layer.box.radius}
          shadowColor={isSelected ? "#26e07f" : "transparent"}
          shadowBlur={isSelected ? 14 : 0}
        />
      ) : null}
      {layer.strokeWidth > 0 ? (
        <Text
          x={textOffsetX}
          y={textOffsetY}
          text={layer.text}
          width={layer.width}
          fontSize={layer.fontSize}
          fontFamily={layer.fontFamily}
          fontStyle={layer.fontWeight}
          fill={layer.fill}
          stroke={layer.stroke}
          strokeWidth={layer.strokeWidth}
          align={layer.align}
          lineHeight={layer.lineHeight}
          letterSpacing={layer.letterSpacing ?? 0}
        />
      ) : null}
      <Text
        x={textOffsetX}
        y={textOffsetY}
        text={layer.text}
        width={layer.width}
        fontSize={layer.fontSize}
        fontFamily={layer.fontFamily}
        fontStyle={layer.fontWeight}
        fill={layer.fill}
        align={layer.align}
        lineHeight={layer.lineHeight}
        letterSpacing={layer.letterSpacing ?? 0}
      />
      {underlineSegments.map((segment, index) => (
        <Group key={`underline-${index}`} listening={false}>
          {layer.strokeWidth > 0 ? (
            <Line
              points={[
                textOffsetX + segment.x,
                textOffsetY + segment.y,
                textOffsetX + segment.x + segment.width,
                textOffsetY + segment.y,
              ]}
              stroke={layer.stroke}
              strokeWidth={segment.strokeWidth + layer.strokeWidth * 2}
              lineCap="butt"
            />
          ) : null}
          <Line
            points={[
              textOffsetX + segment.x,
              textOffsetY + segment.y,
              textOffsetX + segment.x + segment.width,
              textOffsetY + segment.y,
            ]}
            stroke={layer.fill}
            strokeWidth={segment.strokeWidth}
            lineCap="butt"
          />
        </Group>
      ))}
    </Group>
  );
}

function ImageLayerNode({
  layer,
  isSelected,
  snapGuides,
  onSelect,
  onChange,
  onSnapGuidesChange,
}: {
  layer: ImageLayerModel;
  isSelected: boolean;
  snapGuides: SnapGuides;
  onSelect: () => void;
  onChange: (next: Partial<ImageLayerModel>) => void;
  onSnapGuidesChange: (guides: SnapGuide[]) => void;
}) {
  const image = useLoadedImage(layer.src);
  const cropPanStateRef = useRef<CropPanState | null>(null);
  const isPlacedLayer = Boolean(layer.placement);

  const getLogicalPointer = (node: Konva.Node) => {
    const stage = node.getStage();
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return null;
    return {
      x: pointer.x / (stage.scaleX() || 1),
      y: pointer.y / (stage.scaleY() || 1),
    };
  };

  const getCropFromPointer = (node: Konva.Node) => {
    const cropPanState = cropPanStateRef.current;
    const pointer = getLogicalPointer(node);
    if (!cropPanState || !pointer) return getLayerCrop(layer);
    return getPannedImageCrop(
      layer,
      cropPanState.crop,
      pointer.x - cropPanState.pointer.x,
      pointer.y - cropPanState.pointer.y,
    );
  };

  return (
    <>
      {image ? (
        <KonvaImage
          id={layer.id}
          image={image}
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          crop={layer.crop}
          rotation={layer.rotation}
          opacity={layer.opacity}
          draggable
          onClick={(event) => {
            event.cancelBubble = true;
            onSelect();
          }}
          onTap={(event) => {
            event.cancelBubble = true;
            onSelect();
          }}
          onDragStart={(event) => {
            onSelect();
            if (!isPlacedLayer) return;
            const pointer = getLogicalPointer(event.target);
            cropPanStateRef.current = pointer ? { pointer, crop: getLayerCrop(layer) } : null;
          }}
          onDragMove={(event) => {
            if (isPlacedLayer) {
              const nextCrop = getCropFromPointer(event.target);
              event.target.position({ x: layer.x, y: layer.y });
              event.target.setAttrs({ crop: nextCrop });
              onSnapGuidesChange([]);
              return;
            }

            const snapped = getSnappedBoxPosition(
              { width: layer.width, height: layer.height },
              event.target.x(),
              event.target.y(),
              snapGuides,
            );
            event.target.position({ x: snapped.x, y: snapped.y });
            onSnapGuidesChange(snapped.activeGuides);
          }}
          onDragEnd={(event) => {
            if (isPlacedLayer) {
              const nextCrop = getCropFromPointer(event.target);
              cropPanStateRef.current = null;
              event.target.position({ x: layer.x, y: layer.y });
              event.target.setAttrs({ crop: nextCrop });
              onSnapGuidesChange([]);
              onChange({ crop: nextCrop });
              return;
            }

            const snapped = getSnappedBoxPosition(
              { width: layer.width, height: layer.height },
              event.target.x(),
              event.target.y(),
              snapGuides,
            );
            event.target.position({ x: snapped.x, y: snapped.y });
            onSnapGuidesChange([]);
            onChange({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
          }}
          onTransformEnd={(event) => {
            const node = event.target;
            if (isPlacedLayer) {
              node.scaleX(1);
              node.scaleY(1);
              node.position({ x: layer.x, y: layer.y });
              node.rotation(layer.rotation);
              return;
            }

            const scaleX = node.scaleX();
            const scaleY = node.scaleY();
            node.scaleX(1);
            node.scaleY(1);
            onChange({
              x: Math.round(node.x()),
              y: Math.round(node.y()),
              width: Math.max(24, Math.round(layer.width * Math.abs(scaleX))),
              height: Math.max(24, Math.round(layer.height * Math.abs(scaleY))),
              rotation: Math.round(node.rotation()),
            });
          }}
        />
      ) : (
        <Rect
          id={layer.id}
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          rotation={layer.rotation}
          fill="#2b302a"
          onClick={(event) => {
            event.cancelBubble = true;
            onSelect();
          }}
          onTap={(event) => {
            event.cancelBubble = true;
            onSelect();
          }}
        />
      )}
      {isSelected ? (
        <Rect
          x={layer.x}
          y={layer.y}
          width={layer.width}
          height={layer.height}
          rotation={layer.rotation}
          stroke="#26e07f"
          strokeWidth={6}
          listening={false}
        />
      ) : null}
    </>
  );
}

function ShapeLayerNode({
  layer,
  snapGuides,
  onSelect,
  onChange,
  onSnapGuidesChange,
}: {
  layer: ShapeLayerModel;
  snapGuides: SnapGuides;
  onSelect: () => void;
  onChange: (next: Partial<ShapeLayerModel>) => void;
  onSnapGuidesChange: (guides: SnapGuide[]) => void;
}) {
  const geometry = getShapeRenderGeometry(layer);
  const shared = {
    id: layer.id,
    ...geometry.group,
    draggable: true,
    onClick: (event: Konva.KonvaEventObject<MouseEvent>) => {
      event.cancelBubble = true;
      onSelect();
    },
    onTap: (event: Konva.KonvaEventObject<TouchEvent>) => {
      event.cancelBubble = true;
      onSelect();
    },
    onDragStart: onSelect,
    onDragMove: (event: Konva.KonvaEventObject<Event>) => {
      const snapped = getSnappedBoxPosition(
        { width: layer.width, height: layer.height },
        event.target.x(),
        event.target.y(),
        snapGuides,
      );
      event.target.position({ x: snapped.x, y: snapped.y });
      onSnapGuidesChange(snapped.activeGuides);
    },
    onDragEnd: (event: Konva.KonvaEventObject<Event>) => {
      const snapped = getSnappedBoxPosition(
        { width: layer.width, height: layer.height },
        event.target.x(),
        event.target.y(),
        snapGuides,
      );
      onSnapGuidesChange([]);
      onChange({ x: Math.round(snapped.x), y: Math.round(snapped.y) });
    },
    onTransformEnd: (event: Konva.KonvaEventObject<Event>) => {
      const node = event.target;
      const scaleX = Math.abs(node.scaleX());
      const scaleY = Math.abs(node.scaleY());
      node.scaleX(1);
      node.scaleY(1);
      const width = Math.max(24, Math.round(layer.width * scaleX));
      const height = layer.shape === "circle" ? width : Math.max(24, Math.round(layer.height * scaleY));
      onChange({
        x: Math.round(node.x()),
        y: Math.round(node.y()),
        width,
        height,
        rotation: Math.round(node.rotation()),
      });
    },
  };

  return (
    <Group {...shared}>
      {layer.shape === "circle" ? (
        <Ellipse
          {...geometry.circle}
          {...geometry.style}
        />
      ) : (
        <Rect
          {...geometry.rectangle}
          {...geometry.style}
        />
      )}
    </Group>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumericField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <div className="color-field">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
        <input value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

export default function App() {
  const [slides, setSlides] = useState<Slide[]>([createSlide(1)]);
  const [selectedSlideId, setSelectedSlideId] = useState(() => slides[0].id);
  const [selection, setSelection] = useState<Selection>(slides[0].layers[0]?.id ?? null);
  const [zoom, setZoom] = useState(0.36);
  const [showGuides, setShowGuides] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isImageDragging, setIsImageDragging] = useState(false);
  const [imageUploadMode, setImageUploadMode] = useState<ImageUploadMode>("free");
  const [formatId, setFormatId] = useState("denzel");
  const [contentName, setContentName] = useState("");
  const [contentLibrary, setContentLibrary] = useState<ProjectFile[]>([]);
  const [contentStatus, setContentStatus] = useState("");
  const [isContentSaving, setIsContentSaving] = useState(false);
  const [draggingSlideId, setDraggingSlideId] = useState<string | null>(null);
  const [dragOverSlideId, setDragOverSlideId] = useState<string | null>(null);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [activeSnapGuides, setActiveSnapGuides] = useState<SnapGuide[]>([]);
  const [textSelectionRange, setTextSelectionRange] = useState<TextSelectionRange | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const contentInputRef = useRef<HTMLInputElement>(null);
  const contentTextareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedSlide = slides.find((slide) => slide.id === selectedSlideId) ?? slides[0];
  const selectedCanvas = normalizeCanvasPreset(selectedSlide.canvas);
  const brandBadgeGeometry = getBrandBadgeGeometry(selectedCanvas);
  const selectedLayer =
    selection && selection !== "background"
      ? selectedSlide.layers.find((layer) => layer.id === selection) ?? null
      : null;
  const selectedTextLayer = selectedLayer && isTextLayer(selectedLayer) ? selectedLayer : null;
  const selectedImageLayer = selectedLayer && isImageLayer(selectedLayer) ? selectedLayer : null;
  const selectedShapeLayer = selectedLayer && isShapeLayer(selectedLayer) ? selectedLayer : null;

  useEffect(() => {
    let isCurrent = true;

    const loadLibraries = async () => {
      try {
        const contentResponse = await fetch("/api/contents");
        if (contentResponse.ok) {
          const data = (await contentResponse.json()) as { contents?: ProjectFile[] };
          if (isCurrent && data.contents) setContentLibrary(data.contents);
        }
      } catch {
        // Keep the editor usable when local file storage is unavailable.
      }
    };

    void loadLibraries();
    return () => {
      isCurrent = false;
    };
  }, []);

  useEffect(() => {
    const transformer = transformerRef.current;
    const stage = stageRef.current;
    if (!transformer || !stage || !selection || selection === "background") {
      transformer?.nodes([]);
      return;
    }

    const node = stage.findOne(`#${selection}`);
    if (node) {
      transformer.nodes([node]);
      transformer.getLayer()?.batchDraw();
    }
  }, [selection, selectedSlideId, slides]);

  useEffect(() => {
    if (!selectedTextLayer) {
      setTextSelectionRange(null);
      return;
    }

    setTextSelectionRange((current) => {
      if (!current || current.layerId !== selectedTextLayer.id) return null;
      return {
        layerId: current.layerId,
        start: clamp(current.start, 0, selectedTextLayer.text.length),
        end: clamp(current.end, 0, selectedTextLayer.text.length),
      };
    });
  }, [selectedTextLayer?.id, selectedTextLayer?.text.length]);

  const updateSlide = (slideId: string, updater: (slide: Slide) => Slide) => {
    setSlides((current) => current.map((slide) => (slide.id === slideId ? updater(slide) : slide)));
  };

  const updateCurrentSlide = (updater: (slide: Slide) => Slide) => updateSlide(selectedSlide.id, updater);

  const updateLayer = (
    layerId: string,
    next: Partial<TextLayerModel> | Partial<ImageLayerModel> | Partial<ShapeLayerModel>,
  ) => {
    updateCurrentSlide((slide) => ({
      ...slide,
      layers: slide.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
        if (isImageLayer(layer)) return normalizeImageLayer({ ...layer, ...next } as Partial<ImageLayerModel>, false);
        if (isShapeLayer(layer)) return normalizeShapeLayer({ ...layer, ...next } as Partial<ShapeLayerModel>, false);
        return normalizeTextLayer({ ...layer, ...next } as Partial<TextLayerModel>, false);
      }),
    }));
  };

  const updateLayerBox = (layerId: string, next: Partial<TextLayerModel["box"]>) => {
    updateCurrentSlide((slide) => ({
      ...slide,
      layers: slide.layers.map((layer) =>
        layer.id === layerId && isTextLayer(layer) ? { ...layer, box: { ...layer.box, ...next } } : layer,
      ),
    }));
  };


  const updateTextSelectionRange = () => {
    const textarea = contentTextareaRef.current;
    if (!textarea || !selectedTextLayer) return;
    setTextSelectionRange({
      layerId: selectedTextLayer.id,
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    });
  };

  const getActiveTextRange = () => {
    if (!selectedTextLayer || textSelectionRange?.layerId !== selectedTextLayer.id) return null;
    const start = clamp(Math.min(textSelectionRange.start, textSelectionRange.end), 0, selectedTextLayer.text.length);
    const end = clamp(Math.max(textSelectionRange.start, textSelectionRange.end), 0, selectedTextLayer.text.length);
    return { start, end };
  };

  const toggleSelectedTextUnderline = () => {
    const range = getActiveTextRange();
    if (!selectedTextLayer || !range || range.end <= range.start) return;

    updateLayer(selectedTextLayer.id, {
      marks: toggleUnderlineMark(selectedTextLayer.marks, range.start, range.end, selectedTextLayer.text.length),
    });

    requestAnimationFrame(() => {
      const textarea = contentTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(range.start, range.end);
      setTextSelectionRange({ layerId: selectedTextLayer.id, start: range.start, end: range.end });
    });
  };

  const updateBackgroundFill = (fill: string) => {
    updateCurrentSlide((slide) => ({
      ...slide,
      background: normalizeSlideBackground({ ...slide.background, fill }),
    }));
  };

  const changeCanvasPreset = (preset: CanvasPreset) => {
    updateCurrentSlide((slide) => {
      const currentCanvas = normalizeCanvasPreset(slide.canvas);
      const nextCanvas = normalizeCanvasPreset(preset);
      const xRatio = nextCanvas.width / currentCanvas.width;
      const yRatio = nextCanvas.height / currentCanvas.height;

      return {
        ...slide,
        canvas: nextCanvas,
        layers: slide.layers.map((layer) => {
          if (isImageLayer(layer) && layer.placement) {
            const slot = getImagePlacementSlots(layer.placement.mode, nextCanvas)[layer.placement.slotIndex];
            if (slot) {
              return normalizeImageLayer({
                ...layer,
                x: slot.x,
                y: slot.y,
                width: slot.width,
                height: slot.height,
                crop: getImageCoverCrop(layer.naturalWidth, layer.naturalHeight, slot.width, slot.height),
                rotation: 0,
              }, false);
            }
          }

          return scaleLayerForCanvas(layer, xRatio, yRatio, nextCanvas);
        }),
      };
    });
  };

  const addText = (variant: "hook" | "label") => {
    const newLayer = variant === "hook" ? defaultTextLayer() : defaultLabelLayer();
    updateCurrentSlide((slide) => ({ ...slide, layers: [...slide.layers, newLayer] }));
    setSelection(newLayer.id);
  };

  const addShape = (shape: ShapeLayerModel["shape"]) => {
    const newLayer = defaultShapeLayer(shape);
    updateCurrentSlide((slide) => ({ ...slide, layers: [...slide.layers, newLayer] }));
    setSelection(newLayer.id);
  };

  const duplicateSelectedLayer = () => {
    if (!selectedLayer) return;
    const copyLayer = {
      ...selectedLayer,
      id: uid(selectedLayer.type),
      name: `${selectedLayer.name} copy`,
      x: selectedLayer.x + 36,
      y: selectedLayer.y + 36,
    } as SlideLayerModel;
    updateCurrentSlide((slide) => ({ ...slide, layers: [...slide.layers, copyLayer] }));
    setSelection(copyLayer.id);
  };

  const deleteLayer = (layerId: string) => {
    updateCurrentSlide((slide) => ({
      ...slide,
      layers: slide.layers.filter((layer) => layer.id !== layerId),
    }));
    if (selection === layerId) setSelection(null);
  };

  const deleteSelectedLayer = () => {
    if (selectedLayer) deleteLayer(selectedLayer.id);
  };

  const addSlide = () => {
    const nextSlide = createSlide(slides.length + 1);
    setSlides((current) => [...current, nextSlide]);
    setSelectedSlideId(nextSlide.id);
    setSelection(nextSlide.layers[0]?.id ?? null);
  };


  const duplicateSlide = () => {
    const slideCopy: Slide = {
      ...selectedSlide,
      id: uid("slide"),
      name: `${selectedSlide.name} copy`,
      background: normalizeSlideBackground(selectedSlide.background),
      layers: selectedSlide.layers.map((layer) => ({ ...layer, id: uid(layer.type) })),
    };
    setSlides((current) => [...current, slideCopy]);
    setSelectedSlideId(slideCopy.id);
    setSelection(slideCopy.layers[0]?.id ?? null);
  };

  const deleteSlide = (slideId: string) => {
    if (slides.length <= 1) return;
    const deletedIndex = slides.findIndex((slide) => slide.id === slideId);
    const nextSlides = slides.filter((slide) => slide.id !== slideId);
    setSlides(nextSlides);
    if (selectedSlide.id === slideId) {
      const nextSlide = nextSlides[Math.min(Math.max(deletedIndex, 0), nextSlides.length - 1)];
      setSelectedSlideId(nextSlide.id);
      setSelection(nextSlide.layers[0]?.id ?? null);
    }
  };

  const reorderSlides = (sourceSlideId: string, targetSlideId: string) => {
    if (sourceSlideId === targetSlideId) return;

    setSlides((current) => {
      const sourceIndex = current.findIndex((slide) => slide.id === sourceSlideId);
      const targetIndex = current.findIndex((slide) => slide.id === targetSlideId);
      if (sourceIndex < 0 || targetIndex < 0) return current;

      const nextSlides = [...current];
      const [movedSlide] = nextSlides.splice(sourceIndex, 1);
      nextSlides.splice(targetIndex, 0, movedSlide);
      return nextSlides;
    });
  };

  const handleSlideDragStart = (event: DragEvent<HTMLButtonElement>, slideId: string) => {
    setDraggingSlideId(slideId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", slideId);
  };

  const handleSlideDragOver = (event: DragEvent<HTMLButtonElement>, slideId: string) => {
    const sourceSlideId = draggingSlideId || event.dataTransfer.getData("text/plain");
    if (!sourceSlideId || sourceSlideId === slideId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverSlideId(slideId);
  };

  const handleSlideDrop = (event: DragEvent<HTMLButtonElement>, targetSlideId: string) => {
    event.preventDefault();
    const sourceSlideId = draggingSlideId || event.dataTransfer.getData("text/plain");
    if (sourceSlideId) reorderSlides(sourceSlideId, targetSlideId);
    setDraggingSlideId(null);
    setDragOverSlideId(null);
  };

  const clearSlideDragState = () => {
    setDraggingSlideId(null);
    setDragOverSlideId(null);
  };

  const moveSlide = (slideId: string, direction: -1 | 1) => {
    setSlides((current) => {
      const index = current.findIndex((slide) => slide.id === slideId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;

      const nextSlides = [...current];
      const [movedSlide] = nextSlides.splice(index, 1);
      nextSlides.splice(nextIndex, 0, movedSlide);
      return nextSlides;
    });
  };

  const handleSlideReorderKeyDown = (event: KeyboardEvent<HTMLButtonElement>, slideId: string) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveSlide(slideId, event.key === "ArrowUp" ? -1 : 1);
  };

  const moveLayer = (layerId: string, direction: -1 | 1) => {
    updateCurrentSlide((slide) => {
      const index = slide.layers.findIndex((layer) => layer.id === layerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= slide.layers.length) return slide;

      const nextLayers = [...slide.layers];
      const [movedLayer] = nextLayers.splice(index, 1);
      nextLayers.splice(nextIndex, 0, movedLayer);
      return { ...slide, layers: nextLayers };
    });
  };

  const reorderLayers = (sourceLayerId: string, targetLayerId: string) => {
    if (sourceLayerId === targetLayerId) return;

    updateCurrentSlide((slide) => {
      const sourceIndex = slide.layers.findIndex((layer) => layer.id === sourceLayerId);
      const targetIndex = slide.layers.findIndex((layer) => layer.id === targetLayerId);
      if (sourceIndex < 0 || targetIndex < 0) return slide;

      const nextLayers = [...slide.layers];
      const [movedLayer] = nextLayers.splice(sourceIndex, 1);
      nextLayers.splice(targetIndex, 0, movedLayer);
      return { ...slide, layers: nextLayers };
    });
  };

  const handleLayerDragStart = (event: DragEvent<HTMLButtonElement>, layerId: string) => {
    setDraggingLayerId(layerId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", layerId);
  };

  const handleLayerDragOver = (event: DragEvent<HTMLButtonElement>, layerId: string) => {
    const sourceLayerId = draggingLayerId || event.dataTransfer.getData("text/plain");
    if (!sourceLayerId || sourceLayerId === layerId) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverLayerId(layerId);
  };

  const handleLayerDrop = (event: DragEvent<HTMLButtonElement>, targetLayerId: string) => {
    event.preventDefault();
    const sourceLayerId = draggingLayerId || event.dataTransfer.getData("text/plain");
    if (sourceLayerId) reorderLayers(sourceLayerId, targetLayerId);
    setDraggingLayerId(null);
    setDragOverLayerId(null);
  };

  const clearLayerDragState = () => {
    setDraggingLayerId(null);
    setDragOverLayerId(null);
  };

  const handleLayerReorderKeyDown = (event: KeyboardEvent<HTMLButtonElement>, layerId: string) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    moveLayer(layerId, event.key === "ArrowUp" ? -1 : 1);
  };

  const getImageFiles = (files?: File | FileList | File[]) => {
    if (!files) return [];
    const fileList = files instanceof File ? [files] : Array.from(files);
    return fileList.filter((file) => file.type.startsWith("image/"));
  };

  const prepareImageLayerFromFile = async (
    file: File,
    placement?: { mode: ImagePlacementMode; slot: ImagePlacementSlot; slotIndex: number },
  ): Promise<ImageLayerModel> => {
    const src = await readFileAsDataUrl(file);
    const image = await loadHtmlImage(src);

    if (placement) {
      return normalizeImageLayer({
        id: uid("image"),
        src,
        name: file.name,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        crop: getImageCoverCrop(image.naturalWidth, image.naturalHeight, placement.slot.width, placement.slot.height),
        placement: {
          mode: placement.mode,
          slotIndex: placement.slotIndex,
        },
        x: placement.slot.x,
        y: placement.slot.y,
        width: placement.slot.width,
        height: placement.slot.height,
        opacity: 1,
        rotation: 0,
      }, false);
    }

    const maxWidth = Math.round(selectedCanvas.width * 0.62);
    const maxHeight = Math.round(selectedCanvas.height * 0.42);
    const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
    const width = Math.max(48, Math.round(image.naturalWidth * scale));
    const height = Math.max(48, Math.round(image.naturalHeight * scale));

    return normalizeImageLayer({
      id: uid("image"),
      src,
      name: file.name,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      x: Math.round((selectedCanvas.width - width) / 2),
      y: Math.round((selectedCanvas.height - height) / 2),
      width,
      height,
      opacity: 1,
      rotation: 0,
    }, false);
  };

  const getNextPlacementSlotIndex = (mode: ImagePlacementMode) => {
    const slots = getImagePlacementSlots(mode, selectedCanvas);
    const occupiedSlots = new Set(
      selectedSlide.layers
        .filter((layer): layer is ImageLayerModel => isImageLayer(layer) && layer.placement?.mode === mode)
        .map((layer) => layer.placement?.slotIndex)
        .filter((slotIndex): slotIndex is number => typeof slotIndex === "number"),
    );

    return slots.findIndex((_, index) => !occupiedSlots.has(index));
  };

  const insertImageLayers = (newLayers: ImageLayerModel[], shouldPlaceBehindText: boolean) => {
    updateCurrentSlide((slide) => {
      if (!shouldPlaceBehindText) return { ...slide, layers: [...slide.layers, ...newLayers] };

      const firstTextIndex = slide.layers.findIndex(isTextLayer);
      if (firstTextIndex < 0) return { ...slide, layers: [...slide.layers, ...newLayers] };

      return {
        ...slide,
        layers: [
          ...slide.layers.slice(0, firstTextIndex),
          ...newLayers,
          ...slide.layers.slice(firstTextIndex),
        ],
      };
    });
  };

  const handleImageUpload = async (files?: File | FileList | File[]) => {
    const imageFiles = getImageFiles(files);
    if (imageFiles.length === 0) return;

    try {
      const placementMode = imageUploadMode === "free" ? null : imageUploadMode;
      const slots = placementMode ? getImagePlacementSlots(placementMode, selectedCanvas) : [];
      const startSlotIndex = placementMode ? getNextPlacementSlotIndex(placementMode) : -1;
      const filesToPlace =
        placementMode && startSlotIndex >= 0
          ? imageFiles.slice(0, slots.length - startSlotIndex)
          : imageFiles;
      const newLayers = await Promise.all(
        filesToPlace.map((file, index) => {
          if (!placementMode || startSlotIndex < 0) return prepareImageLayerFromFile(file);
          const slotIndex = startSlotIndex + index;
          return prepareImageLayerFromFile(file, {
            mode: placementMode,
            slot: slots[slotIndex],
            slotIndex,
          });
        }),
      );
      insertImageLayers(newLayers, Boolean(placementMode && startSlotIndex >= 0));
      setSelection(newLayers[0].id);
    } catch {
      // Ignore failed image reads during editing; the user can retry with another file.
    }
  };

  const getDraggedImageFiles = (event: DragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    return files.filter((file) => file.type.startsWith("image/"));
  };

  const handleCanvasDragOver = (event: DragEvent<HTMLElement>) => {
    const hasImage =
      Array.from(event.dataTransfer.items).some((item) => item.kind === "file" && item.type.startsWith("image/")) ||
      getDraggedImageFiles(event).length > 0;

    if (!hasImage) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsImageDragging(true);
  };

  const handleCanvasDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsImageDragging(false);
  };

  const handleCanvasDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsImageDragging(false);
    await handleImageUpload(getDraggedImageFiles(event));
  };

  const fitTextLayerWidth = (layer: TextLayerModel) => {
    updateLayer(layer.id, { width: getFittedTextWidth(layer, selectedCanvas) });
  };

  const coverCanvasWithImage = (imageLayer: ImageLayerModel) => {
    const scale = Math.max(
      selectedCanvas.width / imageLayer.naturalWidth,
      selectedCanvas.height / imageLayer.naturalHeight,
    );
    const width = Math.round(imageLayer.naturalWidth * scale);
    const height = Math.round(imageLayer.naturalHeight * scale);
    updateLayer(imageLayer.id, {
      crop: undefined,
      placement: undefined,
      x: Math.round((selectedCanvas.width - width) / 2),
      y: Math.round((selectedCanvas.height - height) / 2),
      width,
      height,
      rotation: 0,
    });
  };

  const resetImageCrop = (imageLayer: ImageLayerModel) => {
    updateLayer(imageLayer.id, {
      crop: getImageCoverCrop(imageLayer.naturalWidth, imageLayer.naturalHeight, imageLayer.width, imageLayer.height),
    });
  };

  const saveContent = async () => {
    const name = contentName.trim() || slides[0]?.name.trim() || "Untitled content";
    const content: ProjectFile = {
      type: "tiktok-slide-project",
      version: 2,
      formatId,
      name,
      preset: makePreset(selectedCanvas),
      slides,
    };
    setContentName(name);
    setContentStatus("");
    setIsContentSaving(true);

    try {
      const response = await fetch("/api/contents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      });
      const data = (await response.json()) as {
        error?: string;
        content?: ProjectFile;
        contents?: ProjectFile[];
      };
      if (!response.ok || !data.content) throw new Error(data.error || "Content could not be saved.");

      if (data.contents) setContentLibrary(data.contents);
      setContentStatus(`Saved to formats/${data.content.formatId}/contents/${data.content.id}.json.`);
    } catch (error) {
      setContentStatus(error instanceof Error ? error.message : "Content could not be saved.");
    } finally {
      setIsContentSaving(false);
    }
  };

  const deleteContent = async (content: ProjectFile) => {
    if (!content.id || !content.formatId) {
      setContentStatus("Content could not be deleted.");
      return;
    }

    try {
      const response = await fetch(
        `/api/contents/${encodeURIComponent(content.formatId)}/${encodeURIComponent(content.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string; contents?: ProjectFile[] };
      if (!response.ok || !data.contents) throw new Error(data.error || "Content could not be deleted.");

      setContentLibrary(data.contents);
      setContentStatus(`Deleted "${content.name ?? content.id}".`);
    } catch (error) {
      setContentStatus(error instanceof Error ? error.message : "Content could not be deleted.");
    }
  };


  const loadContent = async (content: ProjectFile, fallbackName = "Untitled content") => {
    try {
      const { formatId: importedFormatId, slides: importedSlides, warnings } = await normalizeProjectFile(content);
      setFormatId(importedFormatId);
      setSlides(importedSlides);
      setSelectedSlideId(importedSlides[0].id);
      setSelection(importedSlides[0].layers[0]?.id ?? null);
      setContentName(content.name?.trim() || fallbackName);
      setContentStatus(`Loaded "${content.name?.trim() || fallbackName}".`);
      if (warnings.length > 0) console.warn("Content loaded with warnings.", warnings);
    } catch (error) {
      setContentStatus(error instanceof Error ? error.message : "Content load failed.");
    }
  };

  const importContent = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > MAX_PROJECT_BYTES) {
        throw new Error(`Content JSON must not exceed ${MAX_PROJECT_BYTES} bytes.`);
      }
      const content = JSON.parse(await file.text()) as ProjectFile;
      await loadContent(content, file.name.replace(/\.json$/i, ""));
    } catch (error) {
      setContentStatus(error instanceof Error ? error.message : "Content load failed.");
    }
  };

  const exportCurrentPng = async () => {
    setIsExporting(true);
    try {
      const dataUrl = await renderSlideToDataUrl(selectedSlide);
      downloadDataUrl(`${selectedSlide.name.toLowerCase().replace(/\s+/g, "-")}.png`, dataUrl);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "PNG export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const exportAllPngs = async () => {
    setIsExporting(true);
    try {
      const zip = new JSZip();
      for (const [index, slide] of slides.entries()) {
        const dataUrl = await renderSlideToDataUrl(slide);
        zip.file(`${String(index + 1).padStart(2, "0")}-${slide.name.toLowerCase().replace(/\s+/g, "-")}.png`, dataUrlToBlob(dataUrl));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "tiktok-slides.zip";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "ZIP export failed.");
    } finally {
      setIsExporting(false);
    }
  };

  const stageWidth = selectedCanvas.width * zoom;
  const stageHeight = selectedCanvas.height * zoom;
  const safeInsetX = Math.round(selectedCanvas.width * 0.067);
  const safeTop = Math.round(selectedCanvas.height * 0.115);
  const safeBottom = Math.round(selectedCanvas.height * 0.177);
  const centerX = Math.round(selectedCanvas.width / 2);
  const centerY = Math.round(selectedCanvas.height / 2);
  const snapGuides: SnapGuides = {
    vertical: [safeInsetX, centerX, selectedCanvas.width - safeInsetX],
    horizontal: [safeTop, centerY, selectedCanvas.height - safeBottom],
  };
  const updateActiveSnapGuides = (guides: SnapGuide[]) => {
    setActiveSnapGuides((current) => (areSnapGuidesEqual(current, guides) ? current : guides));
  };
  const activeTextRange = getActiveTextRange();
  const hasActiveTextRange = Boolean(activeTextRange && activeTextRange.end > activeTextRange.start);
  const isActiveTextRangeUnderlined = Boolean(
    selectedTextLayer &&
      activeTextRange &&
      isTextRangeUnderlined(selectedTextLayer.marks, activeTextRange.start, activeTextRange.end),
  );
  const imageUploadModeLabel =
    imageUploadMode === "grid-2x2" ? "2x2 placement" : imageUploadMode === "rows-3" ? "3-row placement" : "free image";

  return (
    <main className="app-shell">
      <input
        ref={imageInputRef}
        className="hidden-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          void handleImageUpload(event.target.files ?? undefined);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={contentInputRef}
        className="hidden-input"
        type="file"
        accept="application/json"
        onChange={(event) => {
          void importContent(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />


      <header className="topbar">
        <div className="brand-block">
          <div className="mark">TS</div>
          <div>
            <h1>TikTok Slide Editor</h1>
            <p>{selectedCanvas.name} · {selectedCanvas.width}×{selectedCanvas.height} export</p>
          </div>
        </div>

        <div className="toolbar">
          <button title={`Upload image (${imageUploadModeLabel})`} onClick={() => imageInputRef.current?.click()}>
            <ImageUp size={17} />
            Image
          </button>
          <button title="Add hook text" onClick={() => addText("hook")}>
            <Type size={17} />
            Text
          </button>
          <button title="Add pill label" onClick={() => addText("label")}>
            <Plus size={17} />
            Label
          </button>
          <button title="Add rectangle" aria-label="Add rectangle" onClick={() => addShape("rectangle")}>
            <Square size={17} />
            Rectangle
          </button>
          <button title="Add circle" aria-label="Add circle" onClick={() => addShape("circle")}>
            <CircleIcon size={17} />
            Circle
          </button>
          <button title="Save content to the contents folder" onClick={saveContent} disabled={isContentSaving}>
            <FileJson size={17} />
            {isContentSaving ? "Saving" : "Save Content"}
          </button>
          <button title="Load content JSON" onClick={() => contentInputRef.current?.click()}>
            <Upload size={17} />
            Load Content
          </button>
          <div className="divider" />
          <button title="Export current slide PNG" onClick={exportCurrentPng} disabled={isExporting}>
            <Download size={17} />
            PNG
          </button>
          <button title="Export all slides as ZIP" onClick={exportAllPngs} disabled={isExporting}>
            <Download size={17} />
            ZIP
          </button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="panel-title">
            <Layers size={17} />
            Slides
          </div>
          <div className="slide-list">
            {slides.map((slide, index) => (
              <div key={slide.id} className="slide-row-group">
                <button
                  className={[
                    "slide-row",
                    slide.id === selectedSlide.id ? "active" : "",
                    slide.id === draggingSlideId ? "dragging" : "",
                    slide.id === dragOverSlideId ? "drag-over" : "",
                  ].filter(Boolean).join(" ")}
                  aria-current={slide.id === selectedSlide.id ? "true" : undefined}
                  aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                  title="Drag to reorder. Press Alt+ArrowUp or Alt+ArrowDown to move with the keyboard."
                  draggable
                  onDragStart={(event) => handleSlideDragStart(event, slide.id)}
                  onDragOver={(event) => handleSlideDragOver(event, slide.id)}
                  onDragLeave={() => {
                    if (dragOverSlideId === slide.id) setDragOverSlideId(null);
                  }}
                  onDrop={(event) => handleSlideDrop(event, slide.id)}
                  onDragEnd={clearSlideDragState}
                  onKeyDown={(event) => handleSlideReorderKeyDown(event, slide.id)}
                  onClick={() => {
                    setSelectedSlideId(slide.id);
                    setSelection(slide.layers[0]?.id ?? null);
                  }}
                >
                  <span className="slide-index">{index + 1}</span>
                  <span>
                    <strong>{slide.name}</strong>
                    <small>{slide.layers.filter(isImageLayer).length} images · {slide.layers.filter(isTextLayer).length} text</small>
                  </span>
                </button>
                <button
                  className="item-delete-button"
                  title={`Delete ${slide.name}`}
                  aria-label={`Delete ${slide.name}`}
                  onClick={() => deleteSlide(slide.id)}
                  disabled={slides.length <= 1}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
          <div className="row-actions" role="group" aria-label="Slide actions">
            <button title="Add slide" onClick={addSlide}>
              <Plus size={16} />
              Add
            </button>
            <button title="Duplicate slide" onClick={duplicateSlide}>
              <Copy size={16} />
              Copy
            </button>
          </div>

          <label className="slide-name-editor">
            <span>Slide name</span>
            <input
              value={selectedSlide.name}
              placeholder="Slide name"
              onChange={(event) => updateCurrentSlide((slide) => ({ ...slide, name: event.target.value }))}
            />
          </label>

          <div className="panel-title content-title">
            <FileJson size={17} />
            Contents
          </div>
          <label className="content-name-field">
            <span>Format</span>
            <input
              value={formatId}
              placeholder="denzel"
              onChange={(event) => setFormatId(event.target.value)}
            />
          </label>
          <label className="content-name-field">
            <span>Content name</span>
            <input
              value={contentName}
              placeholder="Content name"
              onChange={(event) => setContentName(event.target.value)}
            />
          </label>
          <div className="content-list">
            {contentLibrary.length > 0 ? (
              contentLibrary.map((content) => {
                const preset = normalizeCanvasPreset(content.preset ?? content.slides[0]?.canvas);

                return <div key={`${content.formatId}:${content.id ?? content.name}`} className="content-row">
                  <button
                    className="content-card"
                    title={`Load ${content.name ?? content.id} content`}
                    aria-label={`Load ${content.name ?? content.id} content`}
                    onClick={() => void loadContent(content)}
                  >
                    <strong>{content.name ?? content.id}</strong>
                    <small>
                      {content.formatId} · {content.slides.length} slides · {preset.width}×{preset.height}
                    </small>
                  </button>
                  <button
                    className="item-delete-button"
                    title={`Delete ${content.name ?? content.id}`}
                    aria-label={`Delete ${content.name ?? content.id}`}
                    onClick={() => void deleteContent(content)}
                    disabled={!content.id || !content.formatId}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>;
              })
            ) : (
              <div className="content-empty">No saved content.</div>
            )}
          </div>
          {contentStatus ? (
            <div className="content-status" role="status" aria-live="polite">
              {contentStatus}
            </div>
          ) : null}

          <div className="panel-title layer-title">
            <Layers size={17} />
            Layers
          </div>
          <button
            className={`layer-row ${selection === "background" ? "active" : ""}`}
            onClick={() => setSelection("background")}
          >
            <span className="layer-dot background-dot" />
            Background color
          </button>
          {selectedSlide.layers.map((layer, index) => (
            <div key={layer.id} className="media-layer-row-group">
              <button
                className={[
                  "layer-row",
                  "media-layer-row",
                  selection === layer.id ? "active" : "",
                  layer.id === draggingLayerId ? "dragging" : "",
                  layer.id === dragOverLayerId ? "drag-over" : "",
                ].filter(Boolean).join(" ")}
                aria-label={`${layer.name}, ${isImageLayer(layer) ? "image" : isShapeLayer(layer) ? layer.shape : "text"}, layer ${index + 1} of ${selectedSlide.layers.length}`}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                title="Drag to reorder. Press Alt+ArrowUp or Alt+ArrowDown to move with the keyboard."
                draggable
                onDragStart={(event) => handleLayerDragStart(event, layer.id)}
                onDragOver={(event) => handleLayerDragOver(event, layer.id)}
                onDragLeave={() => {
                  if (dragOverLayerId === layer.id) setDragOverLayerId(null);
                }}
                onDrop={(event) => handleLayerDrop(event, layer.id)}
                onDragEnd={clearLayerDragState}
                onKeyDown={(event) => handleLayerReorderKeyDown(event, layer.id)}
                onClick={() => setSelection(layer.id)}
              >
                <span className={`layer-dot ${isImageLayer(layer) ? "image-dot" : isShapeLayer(layer) ? "shape-dot" : ""}`} />
                <span>
                  <strong>{layer.name}</strong>
                  <small>{isImageLayer(layer) ? "image" : isShapeLayer(layer) ? layer.shape : "text"}</small>
                </span>
              </button>
              <button
                className="item-delete-button"
                title={`Delete ${layer.name}`}
                aria-label={`Delete ${layer.name}`}
                onClick={() => deleteLayer(layer.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}

        </aside>

        <section
          className={`canvas-area ${isImageDragging ? "dragging-upload" : ""}`}
          onDragOver={handleCanvasDragOver}
          onDragLeave={handleCanvasDragLeave}
          onDrop={handleCanvasDrop}
        >
          <div className="canvas-toolbar">
            <div className="preset-switcher">
              {CANVAS_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  className={selectedCanvas.id === preset.id ? "active" : ""}
                  title={`${preset.name} ${preset.width}×${preset.height}`}
                  onClick={() => changeCanvasPreset(preset)}
                >
                  <strong>{preset.name}</strong>
                  <span>{preset.width}×{preset.height}</span>
                </button>
              ))}
            </div>
            <div className="placement-switcher" aria-label="Image placement mode">
              <button
                className={imageUploadMode === "free" ? "active" : ""}
                title="Add images as free layers"
                onClick={() => setImageUploadMode("free")}
              >
                <ImageUp size={14} />
                <span>Free</span>
              </button>
              <button
                className={imageUploadMode === "grid-2x2" ? "active" : ""}
                title="Place new images into a 2x2 background grid"
                onClick={() => setImageUploadMode("grid-2x2")}
              >
                <LayoutGrid size={14} />
                <span>2x2</span>
              </button>
              <button
                className={imageUploadMode === "rows-3" ? "active" : ""}
                title="Place new images into three vertical rows"
                onClick={() => setImageUploadMode("rows-3")}
              >
                <Rows3 size={14} />
                <span>3 rows</span>
              </button>
            </div>
            <label className="zoom-control">
              Zoom
              <input
                type="range"
                min="0.22"
                max="0.55"
                step="0.01"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <span>{Math.round(zoom * 100)}%</span>
            </label>
            <label className="guide-toggle">
              <input type="checkbox" checked={showGuides} onChange={(event) => setShowGuides(event.target.checked)} />
              Safe guides
            </label>
          </div>

          {isImageDragging ? <div className="drop-overlay">Drop image to add {imageUploadModeLabel}</div> : null}

          <div className="stage-frame" style={{ width: stageWidth, height: stageHeight }}>
            <Stage
              ref={stageRef}
              width={stageWidth}
              height={stageHeight}
              scaleX={zoom}
              scaleY={zoom}
              onMouseDown={(event) => {
                setActiveSnapGuides([]);
                if (event.target === event.target.getStage()) setSelection(null);
              }}
              onTouchStart={(event) => {
                setActiveSnapGuides([]);
                if (event.target === event.target.getStage()) setSelection(null);
              }}
            >
              <Layer>
                <Rect
                  width={selectedCanvas.width}
                  height={selectedCanvas.height}
                  fill={selectedSlide.background.fill}
                  onClick={(event) => {
                    event.cancelBubble = true;
                    setSelection("background");
                  }}
                  onTap={(event) => {
                    event.cancelBubble = true;
                    setSelection("background");
                  }}
                />

                {showGuides ? (
                  <>
                    <Rect x={safeInsetX} y={safeTop} width={selectedCanvas.width - safeInsetX * 2} height={selectedCanvas.height - safeTop - safeBottom} stroke="#26e07f" strokeWidth={2} dash={[14, 14]} opacity={0.75} listening={false} />
                    <Line points={[centerX, 0, centerX, selectedCanvas.height]} stroke="#26e07f" strokeWidth={1.5} dash={[10, 12]} opacity={0.42} listening={false} />
                    <Line points={[0, centerY, selectedCanvas.width, centerY]} stroke="#26e07f" strokeWidth={1.5} dash={[10, 12]} opacity={0.42} listening={false} />
                    <Rect x={0} y={0} width={selectedCanvas.width} height={safeTop} fill="#0b0f0c" opacity={0.18} listening={false} />
                    <Rect x={0} y={selectedCanvas.height - safeBottom} width={selectedCanvas.width} height={safeBottom} fill="#0b0f0c" opacity={0.18} listening={false} />
                  </>
                ) : null}

                {selectedSlide.layers.map((layer) =>
                  isImageLayer(layer) ? (
                    <ImageLayerNode
                      key={layer.id}
                      layer={layer}
                      isSelected={selection === layer.id}
                      snapGuides={snapGuides}
                      onSelect={() => setSelection(layer.id)}
                      onChange={(next) => updateLayer(layer.id, next)}
                      onSnapGuidesChange={updateActiveSnapGuides}
                    />
                  ) : isShapeLayer(layer) ? (
                    <ShapeLayerNode
                      key={layer.id}
                      layer={layer}
                      snapGuides={snapGuides}
                      onSelect={() => setSelection(layer.id)}
                      onChange={(next) => updateLayer(layer.id, next)}
                      onSnapGuidesChange={updateActiveSnapGuides}
                    />
                  ) : (
                    <TextLayerNode
                      key={layer.id}
                      layer={layer}
                      isSelected={selection === layer.id}
                      snapGuides={snapGuides}
                      onSelect={() => setSelection(layer.id)}
                      onChange={(next) => updateLayer(layer.id, next)}
                      onSnapGuidesChange={updateActiveSnapGuides}
                    />
                  ),
                )}
                <Group
                  x={brandBadgeGeometry.x}
                  y={brandBadgeGeometry.y}
                  listening={false}
                >
                  <Rect
                    width={brandBadgeGeometry.width}
                    height={brandBadgeGeometry.height}
                    cornerRadius={brandBadgeGeometry.cornerRadius}
                    fill={BRAND_BADGE.fill}
                  />
                  <Text
                    y={brandBadgeGeometry.textOffsetY}
                    text={BRAND_BADGE.text}
                    width={brandBadgeGeometry.width}
                    height={brandBadgeGeometry.height}
                    align="center"
                    verticalAlign="middle"
                    fontFamily={BRAND_BADGE.fontFamily}
                    fontSize={brandBadgeGeometry.fontSize}
                    fontStyle={BRAND_BADGE.fontWeight}
                    letterSpacing={brandBadgeGeometry.letterSpacing}
                    fill={BRAND_BADGE.textFill}
                  />
                </Group>
                {activeSnapGuides.map((guide) => (
                  <Line
                    key={`${guide.orientation}-${guide.position}`}
                    points={
                      guide.orientation === "vertical"
                        ? [guide.position, 0, guide.position, selectedCanvas.height]
                        : [0, guide.position, selectedCanvas.width, guide.position]
                    }
                    stroke="#26e07f"
                    strokeWidth={4}
                    opacity={0.95}
                    listening={false}
                  />
                ))}
                <Transformer
                  ref={transformerRef}
                  enabledAnchors={
                    selectedImageLayer?.placement
                      ? []
                      : selectedImageLayer || selectedShapeLayer
                      ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                      : ["middle-left", "middle-right"]
                  }
                  rotateEnabled={!selectedImageLayer?.placement}
                  flipEnabled={false}
                  keepRatio={Boolean(
                    (selectedImageLayer && !selectedImageLayer.placement) || selectedShapeLayer?.shape === "circle",
                  )}
                  borderStroke="#26e07f"
                  anchorStroke="#26e07f"
                  anchorFill="#121512"
                  anchorSize={16}
                  boundBoxFunc={(oldBox, newBox) => {
                    if (newBox.width < 80 || newBox.height < 24) return oldBox;
                    return newBox;
                  }}
                />
              </Layer>
            </Stage>
          </div>
        </section>

        <aside className="inspector">
          <div className="panel-title">Inspector</div>
          {selection === "background" ? (
            <div className="inspector-stack">
              <div className="selection-card">
                <strong>Background color</strong>
                <span>{selectedSlide.background.fill}</span>
              </div>
              <ColorField label="Fill" value={selectedSlide.background.fill} onChange={updateBackgroundFill} />
              <div className="swatch-row">
                {["#ffffff", "#000000", "#f2f0e8", "#101210", "#26e07f"].map((fill) => (
                  <button
                    key={fill}
                    className={selectedSlide.background.fill.toLowerCase() === fill ? "active" : ""}
                    title={fill}
                    style={{ backgroundColor: fill }}
                    onClick={() => updateBackgroundFill(fill)}
                  />
                ))}
              </div>
            </div>
          ) : selectedImageLayer ? (
            <div className="inspector-stack">
              <div className="selection-card">
                <strong>{selectedImageLayer.name}</strong>
                <span>source {selectedImageLayer.naturalWidth}×{selectedImageLayer.naturalHeight}</span>
                <span>layer {Math.round(selectedImageLayer.width)}×{Math.round(selectedImageLayer.height)}</span>
                {selectedImageLayer.placement ? (
                  <span>{selectedImageLayer.placement.mode === "grid-2x2" ? "2x2" : "3 rows"} slot {selectedImageLayer.placement.slotIndex + 1}</span>
                ) : null}
              </div>
              <Field label="Name">
                <input value={selectedImageLayer.name} onChange={(event) => updateLayer(selectedImageLayer.id, { name: event.target.value })} />
              </Field>
              <Field label="Image source">
                <div className="readonly-value">{selectedImageLayer.src.split("/").pop() || "Image"}</div>
              </Field>
              {selectedImageLayer.placement ? (
                <Field label="Placement">
                  <div className="readonly-value">
                    {selectedImageLayer.placement.mode === "grid-2x2" ? "2x2" : "3 rows"} slot {selectedImageLayer.placement.slotIndex + 1}
                  </div>
                </Field>
              ) : null}
              {selectedImageLayer.placement ? null : (
                <>
                  <div className="two-col">
                    <NumericField
                      label="X"
                      value={selectedImageLayer.x}

                      onChange={(value) => updateLayer(selectedImageLayer.id, { x: value })}
                    />
                    <NumericField
                      label="Y"
                      value={selectedImageLayer.y}

                      onChange={(value) => updateLayer(selectedImageLayer.id, { y: value })}
                    />
                  </div>
                  <div className="two-col">
                    <NumericField
                      label="Width"
                      value={selectedImageLayer.width}
                      min={24}

                      onChange={(value) => updateLayer(selectedImageLayer.id, { width: value })}
                    />
                    <Field label="Height">
                      <div className="readonly-value">{Math.round(selectedImageLayer.height)} auto</div>
                    </Field>
                  </div>
                  <NumericField
                    label="Rotation"
                    value={selectedImageLayer.rotation}

                    onChange={(value) => updateLayer(selectedImageLayer.id, { rotation: value })}
                  />
                </>
              )}
              <Field label="Opacity">
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={selectedImageLayer.opacity}
                  onChange={(event) => updateLayer(selectedImageLayer.id, { opacity: Number(event.target.value) })}
                />
              </Field>
              {selectedImageLayer.placement ? (
                <Field label="Crop">
                  <button className="wide-button" onClick={() => resetImageCrop(selectedImageLayer)}>Reset crop</button>
                </Field>
              ) : (
                <Field label="Canvas fit">
                  <button className="wide-button" onClick={() => coverCanvasWithImage(selectedImageLayer)}>Cover canvas</button>
                </Field>
              )}
              <button className="wide-button danger" onClick={deleteSelectedLayer}>
                Remove image
              </button>
            </div>
          ) : selectedShapeLayer ? (
            <div className="inspector-stack">
              <div className="selection-card">
                <strong>{selectedShapeLayer.name}</strong>
                <span>{selectedShapeLayer.shape === "circle" ? "Circle" : "Rectangle"}</span>
                <span>{Math.round(selectedShapeLayer.width)}×{Math.round(selectedShapeLayer.height)}</span>
              </div>
              <Field label="Name">
                <input
                  value={selectedShapeLayer.name}
                  onChange={(event) => updateLayer(selectedShapeLayer.id, { name: event.target.value })}
                />
              </Field>
              <div className="two-col">
                <NumericField
                  label="X"
                  value={selectedShapeLayer.x}
                  onChange={(value) => updateLayer(selectedShapeLayer.id, { x: value })}
                />
                <NumericField
                  label="Y"
                  value={selectedShapeLayer.y}
                  onChange={(value) => updateLayer(selectedShapeLayer.id, { y: value })}
                />
              </div>
              {selectedShapeLayer.shape === "circle" ? (
                <NumericField
                  label="Size"
                  value={selectedShapeLayer.width}
                  min={24}
                  onChange={(value) => updateLayer(selectedShapeLayer.id, { width: value, height: value })}
                />
              ) : (
                <div className="two-col">
                  <NumericField
                    label="Width"
                    value={selectedShapeLayer.width}
                    min={24}
                    onChange={(value) => updateLayer(selectedShapeLayer.id, { width: value })}
                  />
                  <NumericField
                    label="Height"
                    value={selectedShapeLayer.height}
                    min={24}
                    onChange={(value) => updateLayer(selectedShapeLayer.id, { height: value })}
                  />
                </div>
              )}
              <ColorField
                label="Fill"
                value={selectedShapeLayer.fill}
                onChange={(value) => updateLayer(selectedShapeLayer.id, { fill: value })}
              />
              <ColorField
                label="Border"
                value={selectedShapeLayer.stroke}
                onChange={(value) => updateLayer(selectedShapeLayer.id, { stroke: value })}
              />
              <NumericField
                label="Border width"
                value={selectedShapeLayer.strokeWidth}
                min={0}
                onChange={(value) => updateLayer(selectedShapeLayer.id, { strokeWidth: value })}
              />
              {selectedShapeLayer.shape === "rectangle" ? (
                <NumericField
                  label="Border radius"
                  value={selectedShapeLayer.borderRadius}
                  min={0}
                  max={Math.min(selectedShapeLayer.width, selectedShapeLayer.height) / 2}
                  onChange={(value) => updateLayer(selectedShapeLayer.id, { borderRadius: value })}
                />
              ) : null}
              <NumericField
                label="Rotation"
                value={selectedShapeLayer.rotation}
                onChange={(value) => updateLayer(selectedShapeLayer.id, { rotation: value })}
              />
              <Field label="Opacity">
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.01"
                  value={selectedShapeLayer.opacity}
                  onChange={(event) => updateLayer(selectedShapeLayer.id, { opacity: Number(event.target.value) })}
                />
              </Field>
              <div className="row-actions">
                <button onClick={duplicateSelectedLayer}><Copy size={16} />Copy</button>
                <button className="danger" onClick={deleteSelectedLayer}><Trash2 size={16} />Remove</button>
              </div>
            </div>
          ) : selectedTextLayer ? (
            <div className="inspector-stack">
              <div className="selection-card">
                <strong>{selectedTextLayer.name}</strong>
              </div>
              <Field label="Name">
                <input value={selectedTextLayer.name} onChange={(event) => updateLayer(selectedTextLayer.id, { name: event.target.value })} />
              </Field>
              <Field label="Content">
                <div className="rich-text-toolbar">
                  <button
                    type="button"
                    className={`format-button ${isActiveTextRangeUnderlined ? "active" : ""}`}
                    title={hasActiveTextRange ? "Toggle underline for selection" : "Select text to underline"}
                    disabled={!hasActiveTextRange}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={toggleSelectedTextUnderline}
                  >
                    <Underline size={15} />
                  </button>
                  <span>
                    {hasActiveTextRange && activeTextRange
                      ? `${activeTextRange.end - activeTextRange.start} chars selected`
                      : "Select text to style"}
                  </span>
                </div>
                <textarea
                  ref={contentTextareaRef}
                  value={selectedTextLayer.text}
                  rows={5}
                  onSelect={updateTextSelectionRange}
                  onMouseUp={updateTextSelectionRange}
                  onKeyUp={updateTextSelectionRange}
                  onFocus={updateTextSelectionRange}
                  onChange={(event) => {
                    updateLayer(selectedTextLayer.id, { text: event.target.value });
                    setTextSelectionRange({
                      layerId: selectedTextLayer.id,
                      start: event.target.selectionStart,
                      end: event.target.selectionEnd,
                    });
                  }}
                />
              </Field>
              <div className="two-col">
                <NumericField
                  label="X"
                  value={selectedTextLayer.x}

                  onChange={(value) => updateLayer(selectedTextLayer.id, { x: value })}
                />
                <NumericField
                  label="Y"
                  value={selectedTextLayer.y}

                  onChange={(value) => updateLayer(selectedTextLayer.id, { y: value })}
                />
              </div>
              <div className="field-with-action">
                <NumericField
                  label="Width"
                  value={selectedTextLayer.width}
                  min={80}

                  onChange={(value) => updateLayer(selectedTextLayer.id, { width: value })}
                />
                <button title="Fit width to current text" onClick={() => fitTextLayerWidth(selectedTextLayer)}>
                  Fit
                </button>
              </div>
              <div className="two-col">
                <NumericField
                  label="Font size"
                  value={selectedTextLayer.fontSize}
                  min={12}

                  onChange={(value) => updateLayer(selectedTextLayer.id, { fontSize: value })}
                />
                <NumericField
                  label="Stroke"
                  value={selectedTextLayer.strokeWidth}
                  min={0}

                  onChange={(value) => updateLayer(selectedTextLayer.id, { strokeWidth: value })}
                />
              </div>
              <Field label="Font">
                <select value={selectedTextLayer.fontFamily} onChange={(event) => updateLayer(selectedTextLayer.id, { fontFamily: event.target.value })}>
                  <option>Inter</option>
                  <option>Arial</option>
                  <option>Avenir Next</option>
                  <option>Helvetica Neue</option>
                  <option>Arial Black</option>
                  <option>Impact</option>
                  <option>Georgia</option>
                </select>
              </Field>
              <Field label="Weight">
                <select
                  value={selectedTextLayer.fontWeight}
                  disabled={FIXED_WEIGHT_FONTS.has(selectedTextLayer.fontFamily)}
                  onChange={(event) => updateLayer(selectedTextLayer.id, { fontWeight: event.target.value })}
                >
                  <option value="400">400</option>
                  <option value="600">600</option>
                  <option value="700">700</option>
                  <option value="800">800</option>
                  <option value="900">900</option>
                  <option value="bold">bold</option>
                </select>
                {FIXED_WEIGHT_FONTS.has(selectedTextLayer.fontFamily) ? (
                  <span className="field-note">This font has a fixed visual weight.</span>
                ) : null}
              </Field>
              <Field label="Align">
                <div className="segmented">
                  {(["left", "center", "right"] as Align[]).map((align) => (
                    <button
                      key={align}
                      className={selectedTextLayer.align === align ? "active" : ""}
                      onClick={() => updateLayer(selectedTextLayer.id, { align })}
                    >
                      {align}
                    </button>
                  ))}
                </div>
              </Field>
              <ColorField
                label="Text"
                value={selectedTextLayer.fill}

                onChange={(value) => updateLayer(selectedTextLayer.id, { fill: value })}
              />
              <ColorField
                label="Border"
                value={selectedTextLayer.stroke}

                onChange={(value) => updateLayer(selectedTextLayer.id, { stroke: value })}
              />
              <div className="two-col">
                <NumericField
                  label="Line height"
                  value={selectedTextLayer.lineHeight}
                  min={0.8}
                  max={2}
                  step={0.05}

                  onChange={(value) => updateLayer(selectedTextLayer.id, { lineHeight: value })}
                />
                <NumericField
                  label="Letter spacing"
                  value={selectedTextLayer.letterSpacing ?? 0}
                  min={0}
                  max={80}
                  step={1}

                  onChange={(value) => updateLayer(selectedTextLayer.id, { letterSpacing: value })}
                />
              </div>
              <NumericField
                label="Rotation"
                value={selectedTextLayer.rotation}

                onChange={(value) => updateLayer(selectedTextLayer.id, { rotation: value })}
              />
              <Field label="Opacity">
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.01"
                  value={selectedTextLayer.opacity}
                  onChange={(event) => updateLayer(selectedTextLayer.id, { opacity: Number(event.target.value) })}
                />
              </Field>
              <Field label="Box">
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={selectedTextLayer.box.enabled}
                    onChange={(event) => updateLayerBox(selectedTextLayer.id, { enabled: event.target.checked })}
                  />
                  Enabled
                </label>
              </Field>
              {selectedTextLayer.box.enabled ? (
                <>
                  <ColorField
                    label="Box fill"
                    value={selectedTextLayer.box.fill}

                    onChange={(value) => updateLayerBox(selectedTextLayer.id, { fill: value })}
                  />
                  <div className="two-col">
                    <NumericField
                      label="Radius"
                      value={selectedTextLayer.box.radius}
                      min={0}

                      onChange={(value) => updateLayerBox(selectedTextLayer.id, { radius: value })}
                    />
                    <NumericField
                      label="Pad X"
                      value={selectedTextLayer.box.paddingX}
                      min={0}

                      onChange={(value) => updateLayerBox(selectedTextLayer.id, { paddingX: value })}
                    />
                  </div>
                  <NumericField
                    label="Pad Y"
                    value={selectedTextLayer.box.paddingY}
                    min={0}

                    onChange={(value) => updateLayerBox(selectedTextLayer.id, { paddingY: value })}
                  />
                </>
              ) : null}
              <div className="row-actions">
                <button onClick={duplicateSelectedLayer}>
                  <Copy size={16} />
                  Copy
                </button>
                <button className="danger" onClick={deleteSelectedLayer}>
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>Select a layer.</p>
              <button onClick={() => addText("hook")}>
                <Type size={16} />
                Add text
              </button>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}
