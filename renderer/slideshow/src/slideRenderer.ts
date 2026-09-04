import KonvaLib from "konva";
import type { CanvasPreset, ImageLayerModel, ShapeLayerModel, Slide, TextLayerModel } from "./editorModel";
import {
  clamp,
  getShapeRenderGeometry,
  isImageLayer,
  isShapeLayer,
  isTextLayer,
  normalizeCanvasPreset,
} from "./editorModel";
import { loadHtmlImage } from "./browserFiles";
import { BRAND_BADGE, getBrandBadgeGeometry } from "./brandBadge";

export type TextUnderlineSegment = {
  x: number;
  y: number;
  width: number;
  strokeWidth: number;
};

type TextLayoutLine = {
  start: number;
  end: number;
  text: string;
  width: number;
};

const UNDERLINE_STROKE_RATIO = 0.055;
const UNDERLINE_OFFSET_RATIO = 1.02;

const getTextMeasure = (layer: TextLayerModel) => {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    return (text: string) => text.length * layer.fontSize * 0.55;
  }

  context.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}"`;
  const letterSpacing = layer.letterSpacing ?? 0;
  return (text: string) => {
    const spacingWidth = Math.max(0, Array.from(text).length - 1) * letterSpacing;
    return context.measureText(text || " ").width + spacingWidth;
  };
};

const isSoftBreak = (char: string) => /\s/.test(char) && char !== "\n";

const trimSoftBreakEnd = (text: string, start: number, end: number) => {
  let nextEnd = end;
  while (nextEnd > start && isSoftBreak(text[nextEnd - 1])) nextEnd -= 1;
  return nextEnd;
};

const trimSoftBreakStart = (text: string, start: number, end: number) => {
  let nextStart = start;
  while (nextStart < end && isSoftBreak(text[nextStart])) nextStart += 1;
  return nextStart;
};

const skipSoftBreakStart = (text: string, start: number, end: number) => {
  let nextStart = start;
  while (nextStart < end && isSoftBreak(text[nextStart])) nextStart += 1;
  return nextStart;
};

const getWrappedTextLines = (layer: TextLayerModel): TextLayoutLine[] => {
  const lines: TextLayoutLine[] = [];
  const text = layer.text;
  const measure = getTextMeasure(layer);
  const maxWidth = Math.max(1, layer.width);

  const pushLine = (start: number, end: number) => {
    const lineText = text.slice(start, end);
    lines.push({
      start,
      end,
      text: lineText,
      width: lineText.length > 0 ? measure(lineText) : 0,
    });
  };

  const wrapParagraph = (paragraphStart: number, paragraphEnd: number) => {
    if (paragraphStart >= paragraphEnd) {
      pushLine(paragraphStart, paragraphEnd);
      return;
    }

    let lineStart = paragraphStart;
    while (lineStart < paragraphEnd) {
      let index = lineStart;
      let lastBreak = -1;
      let wrapped = false;

      while (index < paragraphEnd) {
        const nextIndex = index + 1;
        if (isSoftBreak(text[index])) lastBreak = nextIndex;

        if (measure(text.slice(lineStart, nextIndex)) > maxWidth && nextIndex > lineStart + 1) {
          if (lastBreak > lineStart && lastBreak < nextIndex) {
            const lineEnd = trimSoftBreakEnd(text, lineStart, lastBreak);
            pushLine(lineStart, lineEnd);
            lineStart = skipSoftBreakStart(text, lastBreak, paragraphEnd);
          } else {
            pushLine(lineStart, index);
            lineStart = index;
          }
          wrapped = true;
          break;
        }

        index = nextIndex;
      }

      if (!wrapped) {
        pushLine(lineStart, trimSoftBreakEnd(text, lineStart, paragraphEnd));
        break;
      }
    }
  };

  let paragraphStart = 0;
  while (paragraphStart <= text.length) {
    const newlineIndex = text.indexOf("\n", paragraphStart);
    const paragraphEnd = newlineIndex === -1 ? text.length : newlineIndex;
    wrapParagraph(paragraphStart, paragraphEnd);
    if (newlineIndex === -1) break;
    paragraphStart = newlineIndex + 1;
  }

  return lines;
};

export function getTextUnderlineSegments(layer: TextLayerModel): TextUnderlineSegment[] {
  const underlineMarks = layer.marks.filter((mark) => mark.underline);
  if (underlineMarks.length === 0 || layer.text.length === 0) return [];

  const lines = getWrappedTextLines(layer);
  const measure = getTextMeasure(layer);
  const lineHeightPx = layer.fontSize * layer.lineHeight;
  const underlineStrokeWidth = clamp(Math.round(layer.fontSize * UNDERLINE_STROKE_RATIO), 2, 10);
  const underlineOffset = Math.min(
    lineHeightPx - underlineStrokeWidth / 2,
    layer.fontSize * UNDERLINE_OFFSET_RATIO,
  );

  return underlineMarks.flatMap((mark) =>
    lines.flatMap((line, lineIndex) => {
      const start = Math.max(mark.start, line.start);
      const end = Math.min(mark.end, line.end);
      if (end <= start) return [];

      const visibleStart = trimSoftBreakStart(layer.text, start, end);
      const visibleEnd = trimSoftBreakEnd(layer.text, visibleStart, end);
      if (visibleEnd <= visibleStart) return [];

      const beforeText = layer.text.slice(line.start, visibleStart);
      const underlineText = layer.text.slice(visibleStart, visibleEnd);
      const lineOffsetX =
        layer.align === "center"
          ? (layer.width - line.width) / 2
          : layer.align === "right"
          ? layer.width - line.width
          : 0;
      const leadingSpacing = beforeText.length > 0 && underlineText.length > 0 ? layer.letterSpacing ?? 0 : 0;
      const x = lineOffsetX + (beforeText.length > 0 ? measure(beforeText) + leadingSpacing : 0);
      const width = measure(underlineText);
      if (width <= 0) return [];

      return [
        {
          x,
          y: lineIndex * lineHeightPx + underlineOffset,
          width,
          strokeWidth: underlineStrokeWidth,
        },
      ];
    }),
  );
}

export function getTextHeight(layer: TextLayerModel) {
  const textNode = new KonvaLib.Text({
    text: layer.text,
    width: layer.width,
    fontSize: layer.fontSize,
    fontFamily: layer.fontFamily,
    fontStyle: layer.fontWeight,
    lineHeight: layer.lineHeight,
    letterSpacing: layer.letterSpacing ?? 0,
    padding: 0,
  });
  const height = textNode.height();
  textNode.destroy();
  return height;
}

export function getFittedTextWidth(layer: TextLayerModel, canvas: CanvasPreset) {
  const lines = layer.text.split("\n");
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return Math.max(96, Math.min(layer.width, canvas.width - layer.x));

  context.font = `${layer.fontWeight} ${layer.fontSize}px "${layer.fontFamily}"`;
  const letterSpacing = layer.letterSpacing ?? 0;
  const widestLine = lines.reduce((width, line) => {
    const measuredWidth = context.measureText(line || " ").width;
    const spacingWidth = Math.max(0, Array.from(line).length - 1) * letterSpacing;
    return Math.max(width, measuredWidth + spacingWidth);
  }, 0);

  const strokeSpace = layer.strokeWidth * 2;
  const fittedWidth = Math.ceil(widestLine + strokeSpace + 8);
  return clamp(fittedWidth, 96, Math.max(96, canvas.width - layer.x));
}

function addTextLayerToKonva(layerNode: KonvaLib.Layer, textLayer: TextLayerModel) {
  const group = new KonvaLib.Group({
    x: textLayer.x,
    y: textLayer.y,
    rotation: textLayer.rotation,
    opacity: textLayer.opacity,
  });

  const textConfig = {
    text: textLayer.text,
    width: textLayer.width,
    fontSize: textLayer.fontSize,
    fontFamily: textLayer.fontFamily,
    fontStyle: textLayer.fontWeight,
    align: textLayer.align,
    lineHeight: textLayer.lineHeight,
    letterSpacing: textLayer.letterSpacing ?? 0,
    listening: false,
  };

  const addOutlinedText = (x: number, y: number) => {
    if (textLayer.strokeWidth > 0) {
      group.add(
        new KonvaLib.Text({
          ...textConfig,
          x,
          y,
          fill: textLayer.fill,
          stroke: textLayer.stroke,
          strokeWidth: textLayer.strokeWidth,
        }),
      );
    }

    group.add(
      new KonvaLib.Text({
        ...textConfig,
        x,
        y,
        fill: textLayer.fill,
      }),
    );
  };

  if (textLayer.box.enabled) {
    const textHeight = getTextHeight(textLayer);
    group.add(
      new KonvaLib.Rect({
        x: 0,
        y: 0,
        width: textLayer.width + textLayer.box.paddingX * 2,
        height: textHeight + textLayer.box.paddingY * 2,
        fill: textLayer.box.fill,
        cornerRadius: textLayer.box.radius,
      }),
    );
    addOutlinedText(textLayer.box.paddingX, textLayer.box.paddingY);
  } else {
    addOutlinedText(0, 0);
  }

  for (const segment of getTextUnderlineSegments(textLayer)) {
    const x = (textLayer.box.enabled ? textLayer.box.paddingX : 0) + segment.x;
    const y = (textLayer.box.enabled ? textLayer.box.paddingY : 0) + segment.y;
    if (textLayer.strokeWidth > 0) {
      group.add(
        new KonvaLib.Line({
          points: [x, y, x + segment.width, y],
          stroke: textLayer.stroke,
          strokeWidth: segment.strokeWidth + textLayer.strokeWidth * 2,
          lineCap: "butt",
          listening: false,
        }),
      );
    }
    group.add(
      new KonvaLib.Line({
        points: [x, y, x + segment.width, y],
        stroke: textLayer.fill,
        strokeWidth: segment.strokeWidth,
        lineCap: "butt",
        listening: false,
      }),
    );
  }

  layerNode.add(group);
}

async function addImageLayerToKonva(layerNode: KonvaLib.Layer, imageLayer: ImageLayerModel) {
  const image = await loadHtmlImage(imageLayer.src);
  layerNode.add(
    new KonvaLib.Image({
      image,
      x: imageLayer.x,
      y: imageLayer.y,
      width: imageLayer.width,
      height: imageLayer.height,
      crop: imageLayer.crop,
      rotation: imageLayer.rotation,
      opacity: imageLayer.opacity,
    }),
  );
}

function addShapeLayerToKonva(layerNode: KonvaLib.Layer, shapeLayer: ShapeLayerModel) {
  const geometry = getShapeRenderGeometry(shapeLayer);
  const group = new KonvaLib.Group(geometry.group);
  group.add(
    shapeLayer.shape === "circle"
      ? new KonvaLib.Ellipse({
          ...geometry.circle,
          ...geometry.style,
        })
      : new KonvaLib.Rect({
          ...geometry.rectangle,
          ...geometry.style,
        }),
  );
  layerNode.add(group);
}

function addBrandBadgeToKonva(layerNode: KonvaLib.Layer, canvas: CanvasPreset) {
  const geometry = getBrandBadgeGeometry(canvas);
  const group = new KonvaLib.Group({ x: geometry.x, y: geometry.y, listening: false });
  group.add(
    new KonvaLib.Rect({
      width: geometry.width,
      height: geometry.height,
      cornerRadius: geometry.cornerRadius,
      fill: BRAND_BADGE.fill,
    }),
  );
  group.add(
    new KonvaLib.Text({
      y: geometry.textOffsetY,
      text: BRAND_BADGE.text,
      width: geometry.width,
      height: geometry.height,
      align: "center",
      verticalAlign: "middle",
      fontFamily: BRAND_BADGE.fontFamily,
      fontSize: geometry.fontSize,
      fontStyle: BRAND_BADGE.fontWeight,
      letterSpacing: geometry.letterSpacing,
      fill: BRAND_BADGE.textFill,
    }),
  );
  layerNode.add(group);
}

export async function renderSlideToDataUrl(slide: Slide) {
  const canvas = normalizeCanvasPreset(slide.canvas);
  const container = document.createElement("div");
  container.style.position = "fixed";
  container.style.left = "-10000px";
  container.style.top = "0";
  document.body.appendChild(container);

  const stage = new KonvaLib.Stage({
    container,
    width: canvas.width,
    height: canvas.height,
  });
  const layer = new KonvaLib.Layer();
  stage.add(layer);

  layer.add(
    new KonvaLib.Rect({
      x: 0,
      y: 0,
      width: canvas.width,
      height: canvas.height,
      fill: slide.background.fill,
    }),
  );

  for (const slideLayer of slide.layers) {
    if (isImageLayer(slideLayer)) {
      await addImageLayerToKonva(layer, slideLayer);
    } else if (isShapeLayer(slideLayer)) {
      addShapeLayerToKonva(layer, slideLayer);
    } else if (isTextLayer(slideLayer)) {
      addTextLayerToKonva(layer, slideLayer);
    }
  }
  addBrandBadgeToKonva(layer, canvas);
  layer.draw();

  const dataUrl = stage.toDataURL({
    mimeType: "image/png",
    pixelRatio: 1,
  });
  stage.destroy();
  container.remove();
  return dataUrl;
}
