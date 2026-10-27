import "server-only";

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

/**
 * Long-audio support for the per-part backend (TRANSCRIBE_BACKEND=whisperlah).
 * The GPU jobs backend sends the whole recording in one job and never comes
 * here.
 *
 * The spec left chunking on the roadmap and capped uploads at 25MB. Instead we
 * accept up to the Supabase object limit and deal with length here.
 *
 * Two separate ceilings drive the decision, and they are not the same thing:
 *
 *   size — each request stays under CHUNK_TARGET_BYTES (20MB). Re-encoding to
 *          mono 16kHz 48kbps MP3 costs ~6KB/s, so 20MB holds just under an
 *          hour, and anything short enough for one request fits once
 *          re-encoded.
 *
 *   time — a Vercel function dies at 300s. A single 90-minute transcription
 *          request can outlive that even though the file would have fit. So
 *          we also split on duration and run the parts concurrently.
 *
 * Everything is written to the OS temp dir (/tmp on Vercel, 512MB) and deleted
 * in a finally block by the caller.
 */

/** Mono 16kHz 48kbps MP3 — the encode every path below produces. */
const AUDIO_ARGS = ["-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k"];

/** Bytes per second of the encode above, used to predict output size. */
const BYTES_PER_SECOND = 6_000;

/**
 * Above this, transcribe in parallel parts rather than one request, so no
 * single call has to finish inside the remaining function budget.
 */
export const SINGLE_REQUEST_MAX_SECONDS = 1_500; // 25 minutes

export interface AudioPart {
  index: number;
  startSec: number;
  endSec: number;
  filePath: string;
  bytes: number;
}

export interface PreparedAudio {
  parts: AudioPart[];
  durationSec: number;
  /** Temp directory holding every produced file; caller deletes it. */
  workDir: string;
  /** True when the audio was split rather than sent as one request. */
  chunked: boolean;
}

export class FfmpegUnavailableError extends Error {
  constructor() {
    super(
      "This recording needs to be split before transcription, but ffmpeg is not available in this environment. Upload a shorter file, or export it as mono MP3 at 48-64 kbps.",
    );
    this.name = "FfmpegUnavailableError";
  }
}

function resolveFfmpeg(): string {
  const p = ffmpegPath as unknown as string | null;
  if (!p) throw new FfmpegUnavailableError();
  return p;
}

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      // ffmpeg writes everything to stderr, so trim it to something readable
      else reject(new Error(err.split("\n").slice(-12).join("\n").trim()));
    });
  });
}

/**
 * Duration in seconds, or 0 when the file cannot be read.
 *
 * Parsed out of ffmpeg rather than shelling out to ffprobe. ffprobe-static
 * would add ~80MB to the serverless function for one number, and it resolves
 * its binary path at runtime (`bin/${platform}/${arch}/ffprobe`), which file
 * tracers frequently cannot follow — the failure mode is a function that
 * builds fine and cannot probe anything in production.
 *
 * `ffmpeg -i file` with no output exits non-zero by design and prints the
 * container header to stderr, which is where the duration lives.
 */
export async function probeDuration(filePath: string): Promise<number> {
  let output = "";
  try {
    output = await run(resolveFfmpeg(), ["-nostdin", "-i", filePath]);
  } catch (err) {
    // expected: no output file was given, so ffmpeg exits 1 after printing
    output = err instanceof Error ? err.message : "";
  }

  const m = output.match(/Duration:\s*(\d+):(\d{2}):(\d{2})\.(\d+)/);
  if (!m) return decodeDuration(filePath);

  const seconds = toSeconds(m);
  return Number.isFinite(seconds) ? seconds : 0;
}

function toSeconds([, h, min, sec, frac]: RegExpMatchArray) {
  return Number(h) * 3600 + Number(min) * 60 + Number(sec) + Number(`0.${frac}`);
}

/**
 * Duration by decoding the whole file, for when the header does not say.
 *
 * That is exactly what a browser recording looks like. MediaRecorder writes
 * WebM as a live stream and never goes back to fill in the length, so ffmpeg
 * prints "Duration: N/A". Reading that as 0 sends a 60-minute recording down
 * the "short and small" path as one request, which outlives the function.
 *
 * Decoding audio to the null muxer is cheap — an hour of Opus takes seconds —
 * and the last progress line carries the true end time. Only the tail of
 * stderr is kept, since ffmpeg prints a progress line every half second.
 */
function decodeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    let bin: string;
    try {
      bin = resolveFfmpeg();
    } catch {
      return resolve(0);
    }

    const child = spawn(bin, ["-nostdin", "-i", filePath, "-vn", "-f", "null", "-"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let tail = "";
    child.stderr.on("data", (d) => (tail = (tail + d.toString()).slice(-4_000)));
    child.on("error", () => resolve(0));
    child.on("close", () => {
      const last = [...tail.matchAll(/time=(\d+):(\d{2}):(\d{2})\.(\d+)/g)].at(-1);
      const seconds = last ? toSeconds(last) : 0;
      resolve(Number.isFinite(seconds) ? seconds : 0);
    });
  });
}

/**
 * Write the downloaded audio to disk, then decide between three paths:
 *
 *   1. short and small enough  -> send the original bytes untouched
 *   2. long-ish or oversized   -> one re-encoded mono MP3, still one request
 *   3. genuinely long          -> N re-encoded parts, transcribed in parallel
 *
 * Path 1 matters: it is the common case, and skipping ffmpeg entirely keeps a
 * 6-minute demo recording fast and removes the binary from the hot path.
 */
export async function prepareAudio(
  buffer: Buffer,
  filename: string,
  opts: { chunkSeconds?: number; sizeLimitBytes: number } = {
    sizeLimitBytes: 20 * 1024 * 1024,
  },
): Promise<PreparedAudio> {
  const chunkSeconds = opts.chunkSeconds ?? 600;
  const workDir = await mkdtemp(path.join(tmpdir(), "rapport-"));
  const ext = path.extname(filename) || ".mp3";
  const sourcePath = path.join(workDir, `source${ext}`);
  await writeFile(sourcePath, buffer);

  const durationSec = await probeDuration(sourcePath);

  // --- path 1: as-is -------------------------------------------------------
  const fitsAsIs =
    buffer.byteLength <= opts.sizeLimitBytes &&
    (durationSec === 0 || durationSec <= SINGLE_REQUEST_MAX_SECONDS);

  if (fitsAsIs) {
    return {
      parts: [
        {
          index: 0,
          startSec: 0,
          endSec: durationSec,
          filePath: sourcePath,
          bytes: buffer.byteLength,
        },
      ],
      durationSec,
      workDir,
      chunked: false,
    };
  }

  const ffmpeg = resolveFfmpeg();

  // --- path 2: one compressed file ----------------------------------------
  const wouldFitCompressed =
    durationSec > 0 &&
    durationSec <= SINGLE_REQUEST_MAX_SECONDS &&
    durationSec * BYTES_PER_SECOND <= opts.sizeLimitBytes;

  if (wouldFitCompressed) {
    const outPath = path.join(workDir, "compressed.mp3");
    await run(ffmpeg, ["-nostdin", "-y", "-i", sourcePath, ...AUDIO_ARGS, outPath]);
    const { size } = await stat(outPath);
    if (size <= opts.sizeLimitBytes) {
      return {
        parts: [
          {
            index: 0,
            startSec: 0,
            endSec: durationSec,
            filePath: outPath,
            bytes: size,
          },
        ],
        durationSec,
        workDir,
        chunked: false,
      };
    }
    // fall through and split if compression was not enough
  }

  // --- path 3: split -------------------------------------------------------
  // ffmpeg will not create the output directory for -f segment, so do it here.
  const partsDir = path.join(workDir, "parts");
  await mkdir(partsDir, { recursive: true });

  await run(ffmpeg, [
    "-nostdin",
    "-y",
    "-i",
    sourcePath,
    ...AUDIO_ARGS,
    "-f",
    "segment",
    "-segment_time",
    String(chunkSeconds),
    // each part restarts at t=0; real offsets are rebuilt below from measured
    // durations rather than assumed to be exactly chunkSeconds apart
    "-reset_timestamps",
    "1",
    path.join(partsDir, "part_%04d.mp3"),
  ]);

  const files = (await readdir(partsDir)).filter((f) => f.endsWith(".mp3")).sort();

  if (files.length === 0) {
    throw new Error("Splitting the audio produced no parts.");
  }

  const parts: AudioPart[] = [];
  let offset = 0;
  for (const name of files) {
    const filePath = path.join(partsDir, name);
    const [{ size }, partDuration] = await Promise.all([
      stat(filePath),
      probeDuration(filePath),
    ]);
    const length = partDuration || chunkSeconds;

    // ffmpeg's segmenter reliably emits a trailing fragment of a few hundred
    // bytes when the duration divides evenly. Transcribing it would cost a
    // request and return nothing, so drop anything under a second and
    // renumber around it.
    if (length < 1 || size < 2_048) continue;

    parts.push({
      index: parts.length,
      startSec: offset,
      endSec: offset + length,
      filePath,
      bytes: size,
    });
    offset += length;
  }

  if (parts.length === 0) {
    throw new Error("Splitting the audio produced no usable parts.");
  }

  return {
    parts,
    durationSec: durationSec || offset,
    workDir,
    chunked: parts.length > 1,
  };
}

export async function cleanupWorkDir(workDir: string) {
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
