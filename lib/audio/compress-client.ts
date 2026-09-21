import { FFmpeg } from "@ffmpeg/ffmpeg";

/**
 * Re-encodes a recording in the browser before it is uploaded.
 *
 * Why this exists: a 90-minute recording off a phone is 120-130MB, and the
 * Supabase free tier refuses a storage object over 50MB. The same audio as
 * mono 16kHz 48kbps MP3 is about 32MB, which fits with room to spare. That
 * was previously a manual ffmpeg step the user had to know about — the
 * dropzone told them to "export as mono MP3 at 48-64 kbps" and left them to
 * it.
 *
 * 48kbps mono is not a guess. The 61-minute test recording compressed to
 * 21MB at exactly these settings and still produced 1022 diarized segments
 * and a clean analysis, so speech survives it comfortably. Transcription
 * models downsample to 16kHz anyway, which is why dropping the sample rate
 * costs nothing.
 *
 * Everything here is best-effort. If the core will not load — old browser,
 * blocked wasm, a CSP nobody told us about — the original file is returned
 * and the upload behaves exactly as it did before. Compression is an
 * optimisation, never a gate.
 */

/** Mono, 16kHz, 48kbps: ~6KB per second of audio. */
const BITRATE = "48k";
const SAMPLE_RATE = "16000";
const BYTES_PER_SECOND = 6_000;

/** Below this there is nothing worth doing; skip the 32MB core download. */
const SKIP_UNDER_BYTES = 8 * 1024 * 1024;

/** Beyond this the browser is likely to run out of memory before it finishes. */
export const MAX_SOURCE_BYTES = 500 * 1024 * 1024;

export interface CompressProgress {
  stage: "loading" | "encoding";
  /** 0-1 during encoding; undefined while the core downloads. */
  ratio?: number;
}

export interface CompressResult {
  file: File;
  originalBytes: number;
  compressedBytes: number;
  /** True when the original was returned untouched. */
  skipped: boolean;
  reason?: string;
}

let ffmpegPromise: Promise<FFmpeg> | null = null;

/**
 * The core is 32MB, so it is fetched once per page and reused. The promise is
 * cached rather than the instance so two files picked in quick succession do
 * not start two downloads.
 */
async function getFFmpeg(onProgress?: (p: CompressProgress) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      onProgress?.({ stage: "loading" });

      // Absolute, including the origin, and that is load-bearing.
      //
      // The library builds its worker with `new URL(classWorkerURL,
      // import.meta.url)`. Under Turbopack `import.meta.url` is a file://
      // path, so a root-relative "/ffmpeg/worker.js" resolves to
      // file:///ffmpeg/worker.js and the browser refuses it with a
      // SecurityError. An absolute http URL ignores the base entirely.
      const origin = window.location.origin;

      await ffmpeg.load({
        coreURL: `${origin}/ffmpeg/ffmpeg-core.js`,
        wasmURL: `${origin}/ffmpeg/ffmpeg-core.wasm`,
        // Without this the library falls back to
        // `new Worker(new URL("./worker.js", import.meta.url))`, which
        // Turbopack cannot resolve at all — "Cannot find module as expression
        // is too dynamic" — and compression silently degrades to uploading
        // the original file.
        classWorkerURL: `${origin}/ffmpeg/worker.js`,
      });
      return ffmpeg;
    })().catch((err) => {
      // let a later attempt retry rather than caching the failure forever
      ffmpegPromise = null;
      throw err;
    });
  }
  return ffmpegPromise;
}

/** What the compressed file will roughly weigh, for a pre-flight message. */
export function estimateCompressedBytes(durationSec: number) {
  return Math.round(durationSec * BYTES_PER_SECOND);
}

function swapExtension(name: string) {
  return `${name.replace(/\.[^.]+$/, "")}.mp3`;
}

export async function compressAudio(
  file: File,
  opts: { onProgress?: (p: CompressProgress) => void; signal?: AbortSignal } = {},
): Promise<CompressResult> {
  const base: Omit<CompressResult, "file" | "skipped"> = {
    originalBytes: file.size,
    compressedBytes: file.size,
  };

  if (file.size < SKIP_UNDER_BYTES) {
    return { ...base, file, skipped: true, reason: "already small enough" };
  }

  if (file.size > MAX_SOURCE_BYTES) {
    return { ...base, file, skipped: true, reason: "too large to process in the browser" };
  }

  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFFmpeg(opts.onProgress);
  } catch (err) {
    console.warn("[compress] ffmpeg core unavailable", err);
    return { ...base, file, skipped: true, reason: "compressor unavailable" };
  }

  const inputName = `in${(file.name.match(/\.[^.]+$/) ?? [".bin"])[0]}`;
  const outputName = "out.mp3";

  const onFfmpegProgress = ({ progress }: { progress: number }) => {
    opts.onProgress?.({ stage: "encoding", ratio: Math.min(1, Math.max(0, progress)) });
  };

  try {
    ffmpeg.on("progress", onFfmpegProgress);

    await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));

    const code = await ffmpeg.exec([
      "-i", inputName,
      "-vn",
      "-ac", "1",
      "-ar", SAMPLE_RATE,
      "-b:a", BITRATE,
      outputName,
    ]);

    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);

    const data = (await ffmpeg.readFile(outputName)) as Uint8Array;

    // Clean up immediately: the wasm filesystem is in memory, and holding a
    // 130MB input plus its output is how a long recording runs the tab out.
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});

    // Already-compressed input can come out bigger. Keep whichever is smaller.
    if (data.byteLength >= file.size) {
      return { ...base, file, skipped: true, reason: "no smaller than the original" };
    }

    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);

    const compressed = new File([buffer], swapExtension(file.name), {
      type: "audio/mpeg",
      lastModified: file.lastModified,
    });

    return {
      file: compressed,
      originalBytes: file.size,
      compressedBytes: compressed.size,
      skipped: false,
    };
  } catch (err) {
    console.warn("[compress] falling back to the original file", err);
    return { ...base, file, skipped: true, reason: "compression failed" };
  } finally {
    ffmpeg.off("progress", onFfmpegProgress);
  }
}
