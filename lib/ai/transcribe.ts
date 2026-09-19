import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { toFile } from "openai";
import type { TranscriptionDiarized } from "openai/resources/audio/transcriptions";

import type { AudioPart } from "@/lib/audio/chunk";
import { TRANSCRIBE_MODEL, openai } from "@/lib/ai/openai";

export interface RawSegment {
  chunkIndex: number;
  /** Label as it will be stored: "A" for one-shot, "c0_A" when split. */
  rawSpeakerLabel: string;
  startSec: number;
  endSec: number;
  text: string;
}

export interface PartTranscript {
  index: number;
  segments: RawSegment[];
  durationSec: number;
}

/**
 * Transcribe one audio part with speaker diarization.
 *
 * Notes that cost time to rediscover:
 *  - `chunking_strategy` is REQUIRED by gpt-4o-transcribe-diarize for anything
 *    longer than 30 seconds. Omit it and the call fails.
 *  - `prompt` and `include` are NOT supported by the diarize model, so the
 *    participant names from the form cannot be fed in here. They are given to
 *    the speaker-mapping call instead.
 *  - `language` is left unset on purpose. The persona works in Singapore and
 *    code-switches into Mandarin, Malay and Tamil; pinning language to "en"
 *    makes those stretches worse, not better.
 *
 * `part.startSec` is added to every timestamp so a split recording still has
 * one continuous timeline, and the speaker label is namespaced per part
 * because diarization labels are only unique within a single request.
 */
export async function transcribePart(
  part: AudioPart,
  opts: { namespaceLabels: boolean },
): Promise<PartTranscript> {
  const bytes = await readFile(part.filePath);
  const filename = path.basename(part.filePath);

  const response = (await openai().audio.transcriptions.create({
    file: await toFile(bytes, filename),
    model: TRANSCRIBE_MODEL,
    response_format: "diarized_json",
    chunking_strategy: "auto",
  })) as unknown as TranscriptionDiarized;

  const segments = (response.segments ?? []).map<RawSegment>((s) => ({
    chunkIndex: part.index,
    rawSpeakerLabel: opts.namespaceLabels
      ? `c${part.index}_${s.speaker}`
      : s.speaker,
    startSec: (s.start ?? 0) + part.startSec,
    endSec: (s.end ?? 0) + part.startSec,
    text: (s.text ?? "").trim(),
  }));

  return {
    index: part.index,
    segments: segments.filter((s) => s.text.length > 0),
    durationSec: response.duration ?? part.endSec - part.startSec,
  };
}

/**
 * Merge per-part results into one ordered transcript and assign the `idx`
 * numbers the rest of the app cites as evidence.
 */
export function stitchTranscripts(parts: PartTranscript[]): RawSegment[] {
  return parts
    .slice()
    .sort((a, b) => a.index - b.index)
    .flatMap((p) => p.segments)
    .sort((a, b) => a.startSec - b.startSec || a.chunkIndex - b.chunkIndex);
}
