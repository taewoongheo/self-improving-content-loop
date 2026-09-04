import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { assertBoundedProject, MAX_PROJECT_BYTES } from "./src/projectValidation.ts";

const formatsDirectory = fileURLToPath(new URL("./formats", import.meta.url));
const FORMAT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isContent = (value: unknown): value is Record<string, unknown> & { formatId: string; slides: unknown[] } => {
  try {
    assertBoundedProject(value);
    return true;
  } catch {
    return false;
  }
};

const fileIdFromName = (name: string, fallback: string) => {
  const id = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return id || fallback;
};

const sendJson = (response: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const readJsonLibrary = async (
  directory: string,
  formatId: string,
) => {
  await mkdir(directory, { recursive: true });
  const fileNames = (await readdir(directory))
    .filter((fileName) => fileName.endsWith(".json"))
    .sort();

  const projects = await Promise.all(
    fileNames.map(async (fileName) => {
      try {
        const filePath = path.join(directory, fileName);
        if ((await stat(filePath)).size > MAX_PROJECT_BYTES) return null;
        const value = JSON.parse(await readFile(filePath, "utf8"));
        if (!isContent(value) || value.formatId !== formatId) return null;

        const id = path.basename(fileName, ".json");
        return {
          ...value,
          id,
          name: typeof value.name === "string" && value.name.trim() ? value.name : id,
        };
      } catch {
        return null;
      }
    }),
  );

  return projects.filter((project) => project !== null);
};

const getFormatDirectory = (formatId: string) => path.join(formatsDirectory, formatId);
const getContentsDirectory = (formatId: string) => path.join(getFormatDirectory(formatId), "contents");

const readContents = async () => {
  await mkdir(formatsDirectory, { recursive: true });
  const formatIds = (await readdir(formatsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && FORMAT_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const libraries = await Promise.all(
    formatIds.map((formatId) => readJsonLibrary(getContentsDirectory(formatId), formatId)),
  );
  return libraries.flat();
};

const isTrustedLocalRequest = (request: Connect.IncomingMessage) => {
  const host = request.headers.host ?? "";
  if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
};

const contentApiMiddleware: Connect.NextHandleFunction = async (request, response, next) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const isContentItemRequest = pathname.startsWith("/api/contents/");
  if (pathname !== "/api/contents" && !isContentItemRequest) {
    next();
    return;
  }
  if (!isTrustedLocalRequest(request)) {
    sendJson(response, 403, { error: "Storage API requests must be same-origin on localhost." });
    request.resume();
    return;
  }

  try {
    if (request.method === "GET" && pathname === "/api/contents") {
      sendJson(response, 200, { contents: await readContents() });
      return;
    }

    if (request.method === "DELETE" && isContentItemRequest) {
      const segments = pathname.slice("/api/contents/".length).split("/").map(decodeURIComponent);
      const [formatId, id] = segments;
      if (
        segments.length !== 2
        || !FORMAT_ID_PATTERN.test(formatId)
        || !id
        || fileIdFromName(id, "") !== id
      ) {
        sendJson(response, 400, { error: "Format or content id is invalid." });
        return;
      }

      try {
        await unlink(path.join(getContentsDirectory(formatId), `${id}.json`));
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }

      sendJson(response, 200, { contents: await readContents() });
      return;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    if (!(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json." });
      request.resume();
      return;
    }

    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_PROJECT_BYTES) {
      sendJson(response, 413, { error: "Content JSON is too large." });
      request.resume();
      return;
    }

    request.setEncoding("utf8");
    let rawBody = "";
    let bodyBytes = 0;
    for await (const chunk of request) {
      bodyBytes += Buffer.byteLength(chunk);
      if (bodyBytes > MAX_PROJECT_BYTES) {
        sendJson(response, 413, { error: "Content JSON is too large." });
        return;
      }
      rawBody += chunk;
    }

    const value = JSON.parse(rawBody);
    const name = isRecord(value) && typeof value.name === "string" ? value.name.trim() : "";
    if (!name) {
      sendJson(response, 400, { error: "A content name is required." });
      return;
    }
    try {
      assertBoundedProject(value);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Content JSON is invalid." });
      return;
    }

    try {
      await access(getFormatDirectory(value.formatId));
    } catch {
      sendJson(response, 400, { error: `Unknown format: ${value.formatId}.` });
      return;
    }

    const id = fileIdFromName(name, "content");
    const storedValue = {
      ...value,
      type: "tiktok-slide-project",
      version: 2,
      id,
      name,
      updatedAt: new Date().toISOString(),
    };
    const storedPayload = `${JSON.stringify(storedValue, null, 2)}\n`;
    if (Buffer.byteLength(storedPayload) > MAX_PROJECT_BYTES) {
      sendJson(response, 413, { error: "Stored content JSON is too large." });
      return;
    }

    const contentsDirectory = getContentsDirectory(value.formatId);
    await mkdir(contentsDirectory, { recursive: true });
    await writeFile(
      path.join(contentsDirectory, `${id}.json`),
      storedPayload,
      "utf8",
    );

    sendJson(response, 200, { content: storedValue, contents: await readContents() });
  } catch (error) {
    const message = error instanceof SyntaxError ? "Content JSON is invalid." : "Content could not be saved.";
    sendJson(response, 500, { error: message });
  }
};

const rendererStoragePlugin = (): Plugin => ({
  name: "slideshow-renderer-storage",
  configureServer(server) {
    server.middlewares.use(contentApiMiddleware);
  },
  configurePreviewServer(server) {
    server.middlewares.use(contentApiMiddleware);
  },
});

export default defineConfig({
  plugins: [react(), rendererStoragePlugin()],
});
