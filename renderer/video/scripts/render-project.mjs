import { access, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { normalizeProject } from "../src/projectValidation.ts";

const rendererRoot = fileURLToPath(new URL("..", import.meta.url));

const assertRenderOutput = async (outputPath) => {
  const rendersDirectory = path.join(rendererRoot, "renders");
  await mkdir(rendersDirectory, { recursive: true });
  const relative = path.relative(rendersDirectory, outputPath);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("--out must resolve inside the renderer renders directory.");
  }

  let ancestor = outputPath;
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

const readFlag = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
};

const projectArg = readFlag("--project");
const outputArg = readFlag("--out");

if (!projectArg || !outputArg) {
  console.error("Usage: npm run render -- --project <project.json> --out <video.mp4>");
  process.exit(1);
}

const projectPath = path.resolve(process.cwd(), projectArg);
const outputPath = path.resolve(process.cwd(), outputArg);
await access(projectPath);
const project = normalizeProject(JSON.parse(await readFile(projectPath, "utf8")));
await assertRenderOutput(outputPath);

await mkdir(path.dirname(outputPath), { recursive: true });
const serveUrl = await bundle({
  entryPoint: path.join(rendererRoot, "src", "remotionEntry.tsx"),
  rootDir: rendererRoot,
  publicDir: path.join(rendererRoot, "public"),
  symlinkPublicDir: true,
});
const inputProps = { project };
const composition = await selectComposition({
  serveUrl,
  id: "LiftCodeVideo",
  inputProps,
});

await renderMedia({
  serveUrl,
  composition,
  codec: "h264",
  outputLocation: outputPath,
  inputProps,
  overwrite: true,
  pixelFormat: "yuv420p",
});

console.log(outputPath);
