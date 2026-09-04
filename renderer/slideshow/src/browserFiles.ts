import { useEffect, useState } from "react";

export function useLoadedImage(src?: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }

    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = src;
  }, [src]);

  return image;
}

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function loadHtmlImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function downloadTextFile(filename: string, contents: string, mime = "application/json") {
  const blob = new Blob([contents], { type: mime });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable(): Promise<{
      write(contents: string): Promise<void>;
      close(): Promise<void>;
    }>;
  }>;
};

export async function saveTextFile(filename: string, contents: string, mime = "application/json") {
  const showSaveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
  if (!showSaveFilePicker) {
    downloadTextFile(filename, contents, mime);
    return "downloaded" as const;
  }

  try {
    const fileHandle = await showSaveFilePicker.call(window, {
      suggestedName: filename,
      types: [{
        description: "JSON file",
        accept: { [mime]: [".json"] },
      }],
    });
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close();
    return "saved" as const;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled" as const;
    throw error;
  }
}

export function downloadDataUrl(filename: string, dataUrl: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

export function dataUrlToBlob(dataUrl: string) {
  const [meta, body] = dataUrl.split(",");
  const mime = meta.match(/data:(.*);base64/)?.[1] ?? "image/png";
  const bytes = Uint8Array.from(window.atob(body), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}
