import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { assertVideoProject, MAX_ASSET_BYTES, MAX_PROJECT_BYTES, normalizeProject } from "./src/projectValidation.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const formatsDirectory = path.join(root, "formats");
const assetsDirectory = path.join(root, "public", "assets");
const rendersDirectory = path.join(root, "renders");
const renderScript = path.join(root, "scripts", "render-project.mjs");
const videoExtensions = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const FORMAT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const fileId = (value: string, fallback: string) => value
  .normalize("NFKC")
  .toLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
  .replace(/^-+|-+$/g, "") || fallback;

const sendJson = (response: Parameters<Connect.NextHandleFunction>[1], status: number, body: unknown) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const readBody = async (request: Parameters<Connect.NextHandleFunction>[0], limit: number) => {
  request.setEncoding("utf8");
  let body = "";
  let bytes = 0;
  for await (const chunk of request) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) throw new Error("PAYLOAD_TOO_LARGE");
    body += chunk;
  }
  return body;
};

const getFormatDirectory = (formatId: string) => path.join(formatsDirectory, formatId);
const getContentsDirectory = (formatId: string) => path.join(getFormatDirectory(formatId), "contents");

const readFormatIds = async () => {
  await mkdir(formatsDirectory, { recursive: true });
  return (await readdir(formatsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && FORMAT_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
};

const readFormatProjects = async (formatId: string) => {
  const contentsDirectory = getContentsDirectory(formatId);
  await mkdir(contentsDirectory, { recursive: true });
  const files = (await readdir(contentsDirectory)).filter((name) => name.endsWith(".json")).sort();
  const projects = await Promise.all(files.map(async (name) => {
    try {
      const projectPath = path.join(contentsDirectory, name);
      if ((await stat(projectPath)).size > MAX_PROJECT_BYTES) return null;
      const value = normalizeProject(JSON.parse(await readFile(projectPath, "utf8")));
      if (value.formatId !== formatId) return null;
      return { ...value, id: path.basename(name, ".json") };
    } catch {
      return null;
    }
  }));
  return projects.filter((project) => project !== null);
};

const readProjects = async () => {
  const libraries = await Promise.all((await readFormatIds()).map(readFormatProjects));
  return libraries.flat();
};

const runRender = (projectPath: string, outputPath: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, [renderScript, "--project", projectPath, "--out", outputPath], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Render exited with code ${code}.`)));
});

const normalizeVideo = (inputPath: string, outputPath: string) => new Promise<void>((resolve, reject) => {
  const child = spawn("ffmpeg", [
    "-y", "-i", inputPath,
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-movflags", "+faststart",
    outputPath,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `Video conversion exited with code ${code}.`)));
});

const storageMiddleware: Connect.NextHandleFunction = async (request, response, next) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  if (pathname.startsWith("/api/")) {
    const host = request.headers.host ?? "";
    const origin = request.headers.origin;
    let trustedOrigin = !origin;
    if (origin) {
      try {
        const parsed = new URL(origin);
        trustedOrigin = parsed.protocol === "http:" && parsed.host.toLowerCase() === host.toLowerCase();
      } catch {
        trustedOrigin = false;
      }
    }
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host) || !trustedOrigin) {
      sendJson(response, 403, { error: "Storage API requests must be same-origin on localhost." });
      request.resume();
      return;
    }
    if (
      request.method === "POST"
      && pathname !== "/api/assets"
      && !(request.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")
    ) {
      sendJson(response, 415, { error: "Content-Type must be application/json." });
      request.resume();
      return;
    }
  }

  try {
    if (pathname === "/api/formats" && request.method === "GET") {
      sendJson(response, 200, { formatIds: await readFormatIds() });
      return;
    }

    if (pathname === "/api/projects" && request.method === "GET") {
      sendJson(response, 200, { projects: await readProjects() });
      return;
    }

    if (pathname === "/api/projects" && request.method === "POST") {
      const value = JSON.parse(await readBody(request, MAX_PROJECT_BYTES));
      let project;
      try {
        assertVideoProject(value);
        project = normalizeProject(value);
      } catch (error) {
        sendJson(response, 400, {
          error: error instanceof Error ? error.message : "Project is invalid.",
        });
        return;
      }
      if (!project.name.trim()) {
        sendJson(response, 400, { error: "A project name is required." });
        return;
      }
      try {
        await access(getFormatDirectory(project.formatId));
      } catch {
        sendJson(response, 400, { error: `Unknown format: ${project.formatId}.` });
        return;
      }
      const id = fileId(project.name, "video-project");
      const stored = { ...project, id, updatedAt: new Date().toISOString() };
      const serialized = `${JSON.stringify(stored, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > MAX_PROJECT_BYTES) {
        sendJson(response, 413, { error: "Normalized project is too large." });
        return;
      }
      const contentsDirectory = getContentsDirectory(project.formatId);
      await mkdir(contentsDirectory, { recursive: true });
      await writeFile(path.join(contentsDirectory, `${id}.json`), serialized, "utf8");
      sendJson(response, 200, { project: stored, projects: await readProjects() });
      return;
    }

    if (pathname.startsWith("/api/projects/") && request.method === "DELETE") {
      const segments = pathname.slice("/api/projects/".length).split("/").map(decodeURIComponent);
      const [formatId, id] = segments;
      if (segments.length !== 2 || !FORMAT_ID_PATTERN.test(formatId) || !id || fileId(id, "") !== id) {
        sendJson(response, 400, { error: "Format or project id is invalid." });
        return;
      }
      try {
        await unlink(path.join(getContentsDirectory(formatId), `${id}.json`));
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
      sendJson(response, 200, { projects: await readProjects() });
      return;
    }

    if (pathname === "/api/assets" && request.method === "POST") {
      const rawName = url.searchParams.get("name") ?? "video.mp4";
      const extension = path.extname(rawName).toLowerCase();
      if (!new Set([".mp4", ".mov", ".webm", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".ogg"]).has(extension)) {
        sendJson(response, 400, { error: "Use a supported video or audio file." });
        return;
      }
      const contentLength = Number(request.headers["content-length"] ?? 0);
      if (contentLength > MAX_ASSET_BYTES) {
        sendJson(response, 413, { error: "Video must not exceed 1 GB." });
        request.resume();
        return;
      }
      await mkdir(assetsDirectory, { recursive: true });
      const base = fileId(path.basename(rawName, extension), "video");
      const shouldNormalizeVideo = videoExtensions.has(extension) && extension !== ".mp4";
      const suffix = Date.now().toString(36);
      const name = `${base}-${suffix}${shouldNormalizeVideo ? ".mp4" : extension}`;
      const destination = path.join(assetsDirectory, name);
      const uploadDestination = shouldNormalizeVideo
        ? path.join(assetsDirectory, `.${base}-${suffix}${extension}`)
        : destination;
      let bytes = 0;
      request.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_ASSET_BYTES) request.destroy(new Error("PAYLOAD_TOO_LARGE"));
      });
      try {
        await pipeline(request, createWriteStream(uploadDestination, { flags: "wx" }));
        if (shouldNormalizeVideo) await normalizeVideo(uploadDestination, destination);
      } catch (error) {
        await Promise.all([
          unlink(uploadDestination).catch(() => undefined),
          uploadDestination === destination ? Promise.resolve() : unlink(destination).catch(() => undefined),
        ]);
        throw error;
      } finally {
        if (uploadDestination !== destination) await unlink(uploadDestination).catch(() => undefined);
      }
      sendJson(response, 200, { src: `/assets/${name}` });
      return;
    }

    if (pathname === "/api/render" && request.method === "POST") {
      const body = JSON.parse(await readBody(request, 16 * 1024));
      const id = typeof body.id === "string" ? body.id : "";
      const formatId = typeof body.formatId === "string" ? body.formatId : "";
      if (!FORMAT_ID_PATTERN.test(formatId) || !id || fileId(id, "") !== id) {
        sendJson(response, 400, { error: "Save the project before rendering." });
        return;
      }
      const projectPath = path.join(getContentsDirectory(formatId), `${id}.json`);
      await access(projectPath);
      const formatRendersDirectory = path.join(rendersDirectory, formatId);
      await mkdir(formatRendersDirectory, { recursive: true });
      const outputName = `${id}.mp4`;
      await runRender(projectPath, path.join(formatRendersDirectory, outputName));
      sendJson(response, 200, { downloadUrl: `/api/renders/${encodeURIComponent(formatId)}/${encodeURIComponent(outputName)}` });
      return;
    }

    if (pathname.startsWith("/api/renders/") && request.method === "GET") {
      const segments = pathname.slice("/api/renders/".length).split("/").map(decodeURIComponent);
      const [formatId, name] = segments;
      const id = name?.endsWith(".mp4") ? name.slice(0, -4) : "";
      if (segments.length !== 2 || !FORMAT_ID_PATTERN.test(formatId) || !id || fileId(id, "") !== id || name !== `${id}.mp4`) {
        sendJson(response, 400, { error: "Render name is invalid." });
        return;
      }
      const outputPath = path.join(rendersDirectory, formatId, name);
      await access(outputPath);
      response.statusCode = 200;
      response.setHeader("Content-Type", "video/mp4");
      response.setHeader("Content-Disposition", `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(name)}`);
      createReadStream(outputPath).pipe(response);
      return;
    }

    next();
  } catch (error) {
    const message = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE"
      ? "Payload is too large."
      : error instanceof SyntaxError
        ? "Project JSON is invalid."
        : error instanceof Error
          ? error.message
          : "Request failed.";
    const status = message === "Payload is too large."
      ? 413
      : error instanceof SyntaxError
        ? 400
        : 500;
    sendJson(response, status, { error: message });
  }
};

const videoStoragePlugin = (): Plugin => ({
  name: "video-renderer-storage",
  configureServer(server) { server.middlewares.use(storageMiddleware); },
  configurePreviewServer(server) { server.middlewares.use(storageMiddleware); },
});

export default defineConfig({
  plugins: [react(), videoStoragePlugin()],
});
