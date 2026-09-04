#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  assertBoundedProject,
  MAX_PROJECT_BYTES,
} from "../src/projectValidation.ts";

const DEVTOOLS_TIMEOUT_MS = 5_000;
const PAGE_RENDER_TIMEOUT_MS = 60_000;
const BROWSER_RENDER_TIMEOUT_MS = 180_000;
const FORCE_KILL_WAIT_MS = 1_000;
const CLEANUP_TIMEOUT_MS = 5_000;

const HELP = `Usage:
  npm run render -- --project <project.json> --out <directory>

Options:
  --project  Path to a self-contained tiktok-slide-project JSON file
  --out      Directory for slide PNGs and contact-sheet.png
  --help     Show this help
`;

const rendererRoot = fileURLToPath(new URL("..", import.meta.url));

const assertRenderOutput = async (outputDirectory) => {
  const rendersDirectory = path.join(rendererRoot, "renders");
  await mkdir(rendersDirectory, { recursive: true });
  const relative = path.relative(rendersDirectory, outputDirectory);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("--out must resolve inside the renderer renders directory.");
  }

  let ancestor = outputDirectory;
  while (true) {
    try {
      ancestor = await realpath(ancestor);
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  const canonicalRoot = await realpath(rendersDirectory);
  const canonicalRelative = path.relative(canonicalRoot, ancestor);
  if (canonicalRelative === ".." || canonicalRelative.startsWith(`..${path.sep}`) || path.isAbsolute(canonicalRelative)) {
    throw new Error("--out must resolve inside the renderer renders directory.");
  }
};

const parseArgs = (args) => {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { help: true };
    if (argument !== "--project" && argument !== "--out") {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    options[argument.slice(2)] = value;
    index += 1;
  }
  if (!options.project || !options.out) throw new Error("Both --project and --out are required.");
  return options;
};

const findChrome = async () => {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue to the next known browser location.
    }
  }
  throw new Error("Chrome or Chromium was not found. Set CHROME_PATH to its executable.");
};

const safeFileName = (value, fallback) => {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

const pngFromDataUrl = (dataUrl) => {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/s);
  if (!match) throw new Error("Browser renderer returned an invalid PNG data URL.");
  return Buffer.from(match[1], "base64");
};

const projectMiddleware = (projectPayload) => ({
  name: "render-project-json",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (pathname !== "/__render-project.json") {
        next();
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(projectPayload);
    });
  },
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const remainingTime = (deadline, cap, label) => {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`${label} exceeded the render deadline.`);
  return Math.min(cap, remaining);
};

const withTimeout = async (promise, timeoutMs, label) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded the render deadline.`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
};

const withDeadline = (operation, deadline, label) => {
  const timeoutMs = remainingTime(deadline, BROWSER_RENDER_TIMEOUT_MS, label);
  return withTimeout(operation(), timeoutMs, label);
};

const fetchBeforeDeadline = (url, options, deadline, label) => fetch(url, {
  ...options,
  signal: AbortSignal.timeout(remainingTime(deadline, DEVTOOLS_TIMEOUT_MS, label)),
});

const startChrome = (chrome, profileDirectory, deadline) => {
  const startupTimeout = remainingTime(deadline, 15_000, "Chrome startup");
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-component-update",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profileDirectory}`,
      "--remote-debugging-port=0",
      "about:blank",
    ]);
    child.stdout.resume();
    let stderr = "";
    let startupError;
    let forceTimeout;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      startupError = new Error("Chrome DevTools endpoint did not start before its deadline.");
      child.kill("SIGKILL");
      forceTimeout = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        reject(startupError);
      }, FORCE_KILL_WAIT_MS);
    }, startupTimeout);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match || timedOut) return;
      clearTimeout(timeout);
      clearTimeout(forceTimeout);
      const debuggerUrl = new URL(match[1]);
      resolve({ child, httpOrigin: `http://${debuggerUrl.host}` });
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(forceTimeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      clearTimeout(forceTimeout);
      reject(startupError ?? new Error(stderr.trim() || `Chrome exited with ${code} before DevTools became ready.`));
    });
  });
};

const stopChrome = async ({ child }) => {
  if (child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.kill("SIGTERM");
  await Promise.race([closed, delay(5_000)]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await Promise.race([closed, delay(FORCE_KILL_WAIT_MS)]);
  }
  if (child.exitCode === null) {
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
};

const createCdpClient = async (webSocketUrl, deadline) => {
  const connectionTimeout = remainingTime(deadline, DEVTOOLS_TIMEOUT_MS, "Chrome DevTools connection");
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        socket.close();
      } catch {
        // Ignore a WebSocket that is still connecting.
      }
      reject(new Error("Chrome DevTools page did not connect in time."));
    }, connectionTimeout);
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not connect to the Chrome DevTools page."));
    }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(callbacks.timeout);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });
  socket.addEventListener("close", () => {
    for (const callbacks of pending.values()) {
      clearTimeout(callbacks.timeout);
      callbacks.reject(new Error("Chrome DevTools page closed unexpectedly."));
    }
    pending.clear();
  });

  return {
    send(method, params = {}, timeoutMs = DEVTOOLS_TIMEOUT_MS) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chrome DevTools ${method} timed out.`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
};

const renderUrl = async (browser, url, operationDeadline) => {
  const pageDeadline = Math.min(operationDeadline, Date.now() + PAGE_RENDER_TIMEOUT_MS);
  const response = await fetchBeforeDeadline(
    `${browser.httpOrigin}/json/new?${encodeURIComponent(url)}`,
    { method: "PUT" },
    pageDeadline,
    "Chrome target creation",
  );
  if (!response.ok) throw new Error(`Chrome could not open the render target (${response.status}).`);
  const target = await withDeadline(() => response.json(), pageDeadline, "Chrome target response");
  let cdp;

  try {
    cdp = await createCdpClient(target.webSocketDebuggerUrl, pageDeadline);
    await cdp.send(
      "Runtime.enable",
      {},
      remainingTime(pageDeadline, DEVTOOLS_TIMEOUT_MS, "Chrome Runtime.enable"),
    );
    while (Date.now() < pageDeadline) {
      const evaluation = await cdp.send("Runtime.evaluate", {
        expression: `(() => {
          const output = document.querySelector("#render-output");
          if (output) return output.textContent;
          const error = document.querySelector("#render-error");
          return error ? "__RENDER_ERROR__" + error.textContent : null;
        })()`,
        returnByValue: true,
      }, remainingTime(pageDeadline, DEVTOOLS_TIMEOUT_MS, "Chrome Runtime.evaluate"));
      const value = evaluation.result?.value;
      if (typeof value === "string" && value.startsWith("data:image/png;base64,")) {
        return pngFromDataUrl(value);
      }
      if (typeof value === "string" && value.startsWith("__RENDER_ERROR__")) {
        throw new Error(`Browser renderer failed: ${value.slice("__RENDER_ERROR__".length)}`);
      }
      await delay(remainingTime(pageDeadline, 100, "Browser render polling"));
    }
    throw new Error("Browser renderer exceeded its page deadline.");
  } finally {
    cdp?.close();
    try {
      await fetchBeforeDeadline(
        `${browser.httpOrigin}/json/close/${target.id}`,
        { method: "PUT" },
        pageDeadline,
        "Chrome target cleanup",
      );
    } catch {
      // Chrome termination closes any target that outlives its page budget.
    }
  }
};

const run = async () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${HELP}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }

  const projectPath = path.resolve(options.project);
  const outputDirectory = path.resolve(options.out);
  const projectStats = await stat(projectPath);
  if (!projectStats.isFile() || projectStats.size > MAX_PROJECT_BYTES) {
    throw new Error(`--project must be a file no larger than ${MAX_PROJECT_BYTES} bytes.`);
  }
  const projectPayload = await readFile(projectPath, "utf8");
  const project = JSON.parse(projectPayload);
  assertBoundedProject(project);
  await assertRenderOutput(outputDirectory);
  const chrome = await findChrome();
  let profileDirectory;
  let server;
  let browser;
  try {
    profileDirectory = await mkdtemp(path.join(os.tmpdir(), "lift-code-render-chrome-"));
    server = await createServer({
      root: rendererRoot,
      configFile: path.join(rendererRoot, "vite.config.ts"),
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false },
      plugins: [projectMiddleware(projectPayload)],
    });
    await mkdir(outputDirectory, { recursive: true });
    await withTimeout(server.listen(), 15_000, "Renderer server startup");
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Renderer server did not expose a local port.");
    const baseUrl = `http://127.0.0.1:${address.port}/render-cli.html`;
    browser = await startChrome(chrome, profileDirectory, Date.now() + 15_000);
    const renderDeadline = Date.now() + BROWSER_RENDER_TIMEOUT_MS;

    for (const [index, slide] of project.slides.entries()) {
      const fileName = `${String(index + 1).padStart(2, "0")}-${safeFileName(slide.name, `slide-${index + 1}`)}.png`;
      const png = await renderUrl(browser, `${baseUrl}?slide=${index}`, renderDeadline);
      await writeFile(path.join(outputDirectory, fileName), png, {
        signal: AbortSignal.timeout(
          remainingTime(renderDeadline, BROWSER_RENDER_TIMEOUT_MS, `Slide ${index + 1} write`),
        ),
      });
      process.stdout.write(`${fileName}\n`);
    }

    const contactSheet = await renderUrl(browser, `${baseUrl}?contact=1`, renderDeadline);
    await writeFile(path.join(outputDirectory, "contact-sheet.png"), contactSheet, {
      signal: AbortSignal.timeout(
        remainingTime(renderDeadline, BROWSER_RENDER_TIMEOUT_MS, "Contact sheet write"),
      ),
    });
    process.stdout.write("contact-sheet.png\n");
  } finally {
    if (browser) await stopChrome(browser);
    if (server) {
      await withTimeout(
        server.close(),
        CLEANUP_TIMEOUT_MS,
        "Renderer server cleanup",
      ).catch(() => undefined);
    }
    if (profileDirectory) {
      await withTimeout(
        rm(profileDirectory, { recursive: true, force: true }),
        CLEANUP_TIMEOUT_MS,
        "Chrome profile cleanup",
      );
    }
  }
};

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
