import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AudioPart } from "@/lib/audio/chunk";
import { readEnv } from "@/lib/env";

/**
 * Which transcription service runs.
 *
 * "jobs" (the default, and what Vercel runs) sends the whole recording to the
 * GPU service on Modal in one job (lib/asr/jobs.ts): WhisperLah for the
 * words, pyannote community-1 for who spoke, and pyannote's WeSpeaker
 * ResNet34 for one voice embedding per speaker.
 *
 * "whisperlah" runs the same models on a server of our own
 * (singlish-asr/scripts/serve/server.py), sent the recording part by part
 * through this file.
 *
 * Anything else counts as "jobs", including "openai" from an old .env.local:
 * that backend is gone, and npm run preflight says so.
 */
export const TRANSCRIBE_BACKEND: "jobs" | "whisperlah" =
  process.env.TRANSCRIBE_BACKEND === "whisperlah" ? "whisperlah" : "jobs";

export interface RawSegment {
  chunkIndex: number;
  /** Label as it will be stored: "A" for one-shot, "c0_A" when split. */
  rawSpeakerLabel: string;
  startSec: number;
  endSec: number;
  text: string;
}

/** One speaker's voice centroid, as returned by the diarizer. */
export interface SpeakerEmbedding {
  /** Which embedder produced it, so vectors from different models are never compared. */
  model: string;
  embedding: number[];
}

export interface PartTranscript {
  index: number;
  segments: RawSegment[];
  durationSec: number;
  /** Keyed by the stored label ("A" or "c0_A"). */
  speakers: Record<string, SpeakerEmbedding>;
}

interface WhisperLahResponse {
  duration: number;
  segments: { speaker: string; start: number; end: number; text: string }[];
  speakers?: Record<string, SpeakerEmbedding>;
  timing?: Record<string, number>;
}

/**
 * Transcribe one audio part with speaker diarization, on the self-hosted
 * WhisperLah server (faster-whisper + pyannote). The server already returns
 * one segment per speaker turn with A/B/C labels.
 *
 * `part.startSec` is added to every timestamp so a split recording still has
 * one continuous timeline, and the speaker label is namespaced per part
 * because diarization labels are only unique within a single request.
 *
 *  - `WHISPERLAH_URL`      e.g. http://127.0.0.1:8765 (required for this backend)
 *  - `WHISPERLAH_TOKEN`    sent as a bearer token when the server was started with one
 *                         (`WHISPERLAH_API_KEY`, the older name, still works)
 *  - `WHISPERLAH_MODE`     "room" (default, everyone in the room) or "near" (lapel mic wearer only)
 */
export async function transcribePart(
  part: AudioPart,
  opts: { namespaceLabels: boolean },
): Promise<PartTranscript> {
  const base = readEnv("WHISPERLAH_URL");
  if (!base) {
    throw new Error("TRANSCRIBE_BACKEND=whisperlah but WHISPERLAH_URL is not set.");
  }
  const bytes = await readFile(part.filePath);
  const filename = path.basename(part.filePath);

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)]), filename);
  form.append("mode", process.env.WHISPERLAH_MODE || "room");
  form.append("diarize", "true");

  const headers: Record<string, string> = {};
  const token = readEnv("WHISPERLAH_TOKEN") || readEnv("WHISPERLAH_API_KEY");
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${base.replace(/\/$/, "")}/transcribe`, {
    method: "POST",
    headers,
    body: form,
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`WhisperLah server returned ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as WhisperLahResponse;

  const label = (speaker: string) =>
    opts.namespaceLabels ? `c${part.index}_${speaker}` : speaker;

  const segments = data.segments.map<RawSegment>((s) => ({
    chunkIndex: part.index,
    rawSpeakerLabel: label(s.speaker),
    startSec: s.start + part.startSec,
    endSec: s.end + part.startSec,
    text: s.text.trim(),
  }));

  const speakers: Record<string, SpeakerEmbedding> = {};
  for (const [speaker, v] of Object.entries(data.speakers ?? {})) {
    if (v?.model && Array.isArray(v.embedding) && v.embedding.length > 0) {
      speakers[label(speaker)] = { model: v.model, embedding: v.embedding };
    }
  }

  return {
    index: part.index,
    segments: segments.filter((s) => s.text.length > 0),
    durationSec: data.duration ?? part.endSec - part.startSec,
    speakers,
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
