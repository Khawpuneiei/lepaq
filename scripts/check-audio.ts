/**
 * Smoke test for the long-audio splitter.  Run with:  npm run check:audio
 *
 * Worth having because this is the one part of the pipeline that cannot be
 * exercised without an OpenAI key and a real recording. It generates synthetic
 * audio with ffmpeg and checks the three paths through prepareAudio:
 * sent as-is, compressed into one request, and split into parts.
 *
 * It also verifies the property everything downstream depends on: that the
 * parts tile the timeline with no gaps, so a stitched transcript has one
 * continuous clock.
 *
 * The last scenario mimics an in-browser recording: WebM written as a stream,
 * so the header carries no duration, exactly as MediaRecorder leaves it.
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import { cleanupWorkDir, prepareAudio, probeDuration } from "@/lib/audio/chunk";

const MB = 1024 * 1024;
let failures = 0;

function check(label: string, ok: boolean) {
  console.log(`    ${ok ? "ok  " : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

type Kind = "mp3" | "webm-stream";

function makeAudio(dir: string, seconds: number, kind: Kind = "mp3") {
  const source = ["-nostdin", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ac", "1"];

  if (kind === "mp3") {
    const out = path.join(dir, `tone-${seconds}.mp3`);
    const result = spawnSync(
      ffmpegPath as unknown as string,
      [...source, "-ar", "44100", "-b:a", "192k", out],
      { encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(result.stderr.slice(-500));
    return out;
  }

  // Written to a pipe, so the muxer cannot seek back and fill in the length.
  const out = path.join(dir, `recording-${seconds}.webm`);
  const result = spawnSync(
    ffmpegPath as unknown as string,
    [...source, "-c:a", "libopus", "-b:a", "32k", "-f", "webm", "pipe:1"],
    { maxBuffer: 256 * MB },
  );
  if (result.status !== 0) throw new Error(result.stderr.toString().slice(-500));
  writeFileSync(out, result.stdout);
  return out;
}

async function scenario(opts: {
  label: string;
  seconds: number;
  limitBytes: number;
  chunkSeconds: number;
  expectChunked: boolean;
  kind?: Kind;
}) {
  const dir = await mkdtemp(path.join(tmpdir(), "rapport-check-"));

  try {
    const file = makeAudio(dir, opts.seconds, opts.kind);
    const { size } = await stat(file);
    const buffer = await readFile(file);

    const prepared = await prepareAudio(buffer, path.basename(file), {
      chunkSeconds: opts.chunkSeconds,
      sizeLimitBytes: opts.limitBytes,
    });

    const sizes = prepared.parts.map((p) => `${(p.bytes / MB).toFixed(2)}MB`);
    console.log(`\n  ${opts.label}`);
    console.log(
      `    source ${(size / MB).toFixed(2)}MB / ${opts.seconds}s -> ${prepared.parts.length} part(s) [${sizes.join(", ")}]`,
    );

    check(
      `chunked === ${opts.expectChunked}`,
      prepared.chunked === opts.expectChunked,
    );
    check(
      "every part is within the request size limit",
      prepared.parts.every((p) => p.bytes <= opts.limitBytes),
    );
    check(
      "duration probed within 2s of the source",
      Math.abs(prepared.durationSec - opts.seconds) < 2,
    );

    // The property the stitched transcript relies on: contiguous timeline.
    const gap = prepared.parts.some((p, i) =>
      i === 0 ? false : Math.abs(p.startSec - prepared.parts[i - 1].endSec) > 0.5,
    );
    check("parts tile the timeline with no gaps", !gap);
    check(
      "parts cover the whole recording",
      Math.abs(prepared.parts.at(-1)!.endSec - opts.seconds) < 3,
    );

    let playable = true;
    for (const p of prepared.parts) {
      if ((await probeDuration(p.filePath)) <= 0) playable = false;
    }
    check("every produced part is readable audio", playable);

    await cleanupWorkDir(prepared.workDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log("Checking lib/audio/chunk.ts");

  // Short and small: ffmpeg is never invoked, original bytes are sent.
  await scenario({
    label: "short recording is sent untouched",
    seconds: 120,
    limitBytes: 20 * MB,
    chunkSeconds: 600,
    expectChunked: false,
  });

  // Past the single-request duration ceiling: split for latency, not size.
  await scenario({
    label: "30 minute recording is split into parts",
    seconds: 1800,
    limitBytes: 20 * MB,
    chunkSeconds: 600,
    expectChunked: true,
  });

  // A size limit small enough that compression alone cannot rescue it.
  await scenario({
    label: "tight size limit forces a split",
    seconds: 600,
    limitBytes: 1 * MB,
    chunkSeconds: 120,
    expectChunked: true,
  });

  // An in-browser recording: no duration in the header. Read as 0, this would
  // go out as one 30-minute request and outlive the function.
  await scenario({
    label: "browser recording with no duration header is measured and split",
    seconds: 1800,
    limitBytes: 20 * MB,
    chunkSeconds: 600,
    expectChunked: true,
    kind: "webm-stream",
  });

  console.log(
    failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
