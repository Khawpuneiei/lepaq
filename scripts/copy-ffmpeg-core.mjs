/**
 * Copies the ffmpeg.wasm core into public/ffmpeg so the browser loads it from
 * our own origin. Runs on postinstall.
 *
 * Self-hosted rather than pulled from a CDN at runtime for two reasons: a
 * third-party CDN outage would take the upload path down with it, and loading
 * a 32MB wasm binary cross-origin is exactly the kind of thing a tightened
 * Content-Security-Policy breaks later, in production, far from this code.
 *
 * public/ffmpeg is gitignored — 32MB of vendored binary does not belong in
 * the repo when npm can fetch it.
 */

import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const coreDir = path.join(root, "node_modules", "@ffmpeg", "core", "dist", "esm");
const classDir = path.join(root, "node_modules", "@ffmpeg", "ffmpeg", "dist", "esm");
const to = path.join(root, "public", "ffmpeg");

const CORE_FILES = ["ffmpeg-core.js", "ffmpeg-core.wasm"];
const WORKER_FILES = ["worker.js", "const.js", "errors.js"];

try {
  await mkdir(to, { recursive: true });

  for (const file of CORE_FILES) {
    const src = path.join(coreDir, file);
    await stat(src); // throws if the package layout changed
    await cp(src, path.join(to, file));
  }

  // The worker, plus exactly the two modules it imports.
  //
  // @ffmpeg/ffmpeg spawns its worker with `new Worker(new URL("./worker.js",
  // import.meta.url))`, which Turbopack cannot resolve — it fails at runtime
  // with "Cannot find module as expression is too dynamic". Passing
  // classWorkerURL makes it use a plain runtime URL instead, which needs the
  // worker served from our own origin, and worker.js imports ./const.js and
  // ./errors.js relatively.
  //
  // Named files rather than the whole directory on purpose: copying it
  // wholesale also brings .d.ts files, and tsconfig includes **/*.ts, so they
  // join the TypeScript program and start redefining DOM types. The symptom
  // is unrelated files failing with things like "Property 'value' does not
  // exist on type HTMLInputElement", which points nowhere near the cause.
  for (const file of WORKER_FILES) {
    await cp(path.join(classDir, file), path.join(to, file));
  }

  console.log(`ffmpeg core + worker -> public/ffmpeg`);
} catch (err) {
  // Not fatal. Without the core the dropzone simply skips compression and
  // falls back to uploading the original file, which is the old behaviour.
  console.warn(
    `ffmpeg core not copied: ${err instanceof Error ? err.message : err}\n` +
      "Browser-side compression will be unavailable; uploads fall back to the original file.",
  );
}
