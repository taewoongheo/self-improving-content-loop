import "./styles.css";
import type { Slide } from "./editorModel";
import { normalizeProjectFile } from "./projectIO";
import { renderSlideToDataUrl } from "./slideRenderer";

const PROJECT_ENDPOINT = "/__render-project.json";
const CONTACT_THUMBNAIL_WIDTH = 540;
const CONTACT_GAP = 24;
const CONTACT_MARGIN = 24;

const loadDataUrlImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("Rendered slide could not be loaded for the contact sheet."));
  image.src = src;
});

async function renderContactSheet(slides: Slide[]) {
  const dataUrls = [] as string[];
  for (const slide of slides) dataUrls.push(await renderSlideToDataUrl(slide));

  const columns = Math.min(2, slides.length);
  const rows = Math.ceil(slides.length / columns);
  const thumbnailHeights = slides.map((slide) =>
    Math.round(slide.canvas.height * (CONTACT_THUMBNAIL_WIDTH / slide.canvas.width)),
  );
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(...thumbnailHeights.slice(row * columns, (row + 1) * columns)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = CONTACT_MARGIN * 2 + columns * CONTACT_THUMBNAIL_WIDTH + (columns - 1) * CONTACT_GAP;
  canvas.height = CONTACT_MARGIN * 2 + rowHeights.reduce((sum, height) => sum + height, 0) + (rows - 1) * CONTACT_GAP;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Contact-sheet canvas is unavailable.");
  context.fillStyle = "#e8e8e8";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const rowOffsets = rowHeights.map((_, row) =>
    CONTACT_MARGIN + rowHeights.slice(0, row).reduce((sum, height) => sum + height, 0) + row * CONTACT_GAP,
  );
  for (const [index, dataUrl] of dataUrls.entries()) {
    const image = await loadDataUrlImage(dataUrl);
    const column = index % columns;
    const row = Math.floor(index / columns);
    context.drawImage(
      image,
      CONTACT_MARGIN + column * (CONTACT_THUMBNAIL_WIDTH + CONTACT_GAP),
      rowOffsets[row],
      CONTACT_THUMBNAIL_WIDTH,
      thumbnailHeights[index],
    );
  }

  return canvas.toDataURL("image/png");
}

const writeResult = (id: "render-output" | "render-error", contents: string) => {
  const output = document.createElement("pre");
  output.id = id;
  output.textContent = contents;
  document.body.replaceChildren(output);
};

try {
  const response = await fetch(PROJECT_ENDPOINT, { cache: "no-store" });
  if (!response.ok) throw new Error(`Project JSON request failed with ${response.status}.`);
  const { slides, warnings } = await normalizeProjectFile(await response.json());
  if (warnings.length > 0) throw new Error(warnings.join("\n"));
  await document.fonts.ready;

  const params = new URLSearchParams(window.location.search);
  if (params.get("contact") === "1") {
    writeResult("render-output", await renderContactSheet(slides));
  } else {
    const slideIndex = Number(params.get("slide"));
    if (!Number.isInteger(slideIndex) || slideIndex < 0 || slideIndex >= slides.length) {
      throw new Error("A valid zero-based slide index is required.");
    }
    writeResult("render-output", await renderSlideToDataUrl(slides[slideIndex]));
  }
} catch (error) {
  writeResult("render-error", error instanceof Error ? error.message : "Unknown render failure.");
}
