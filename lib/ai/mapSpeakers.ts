import "server-only";

import { structuredCall } from "@/lib/ai/respond";
import {
  SPEAKER_MAPPING_JSON_SCHEMA,
  SpeakerMappingResult,
} from "@/lib/ai/schema";
import {
  SPEAKER_MAPPING_SYSTEM_PROMPT,
  buildSpeakerMappingUserMessage,
  type MappingParticipant,
  type MappingSample,
} from "@/lib/ai/prompts";
import type { RawSegment } from "@/lib/ai/transcribe";

/** Anything below this is shown as a blank dropdown for the user to fill in. */
export const LOW_CONFIDENCE = 0.6;

/**
 * Diarization hands a fresh speaker label to almost every backchannel noise —
 * a stray "Mm-hmm" or "Yep" becomes its own speaker. On a real 61-minute
 * two-person call that produced 50 labels, of which 36 accounted for 2.4% of
 * the speech.
 *
 * Asking the user to identify 50 voices would wreck the one-screen review the
 * whole design depends on, so labels are split into the ones that carry the
 * conversation and the ones that do not. Minor labels are never sent to the
 * model (they cost tokens and dilute the real evidence) and the review screen
 * tucks them behind a disclosure, left unassigned.
 *
 * The thresholds are deliberately generous: a genuine third participant who
 * only speaks for twenty seconds still counts as major.
 */
export function isMajorLabel(seconds: number, turns: number) {
  return seconds >= 15 || turns >= 8;
}

/**
 * Pick the lines most likely to identify a speaker.
 *
 * Self-introductions cluster at the start, so the opening turns are always
 * included; after that we prefer lines that name somebody or introduce
 * somebody, then fall back to the longest turns.
 */
const NAME_HINTS =
  /\b(i am|i'm|my name|this is|call me|speaking|thanks|thank you|nice to meet|over to|handing over)\b/i;

export function buildSamples(
  segments: RawSegment[],
  participants: MappingParticipant[],
  perLabel = 3,
): MappingSample[] {
  const byLabel = new Map<string, RawSegment[]>();
  for (const s of segments) {
    const list = byLabel.get(s.rawSpeakerLabel) ?? [];
    list.push(s);
    byLabel.set(s.rawSpeakerLabel, list);
  }

  const participantNames = participants.map((p) =>
    p.display_name.split(/\s+/)[0].toLowerCase(),
  );

  const score = (seg: RawSegment, position: number) => {
    let s = 0;
    if (position < 6) s += 40 - position * 4; // opening turns
    if (NAME_HINTS.test(seg.text)) s += 25;
    if (participantNames.some((n) => n.length > 2 && seg.text.toLowerCase().includes(n)))
      s += 30;
    s += Math.min(15, seg.text.length / 20); // prefer substantial turns
    return s;
  };

  const samples: MappingSample[] = [];
  for (const [label, segs] of byLabel) {
    const ranked = segs
      .map((seg, i) => ({ seg, score: score(seg, i) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, perLabel)
      .sort((a, b) => a.seg.startSec - b.seg.startSec);

    samples.push({
      label,
      segmentCount: segs.length,
      totalSeconds: segs.reduce((n, s) => n + Math.max(0, s.endSec - s.startSec), 0),
      quotes: ranked.map(({ seg }) => ({
        startSec: seg.startSec,
        text: seg.text.slice(0, 220),
      })),
    });
  }

  // most-talkative first, so a long recording puts the important labels first
  return samples.sort((a, b) => b.totalSeconds - a.totalSeconds);
}

export interface ProposedMapping {
  rawSpeakerLabel: string;
  displayName: string | null;
  confidence: number;
  reason: string;
  sampleQuotes: string[];
  segmentCount: number;
  /** False for backchannel-only labels; see isMajorLabel. */
  major: boolean;
}

export async function mapSpeakers(args: {
  title: string;
  shortNote: string | null;
  meetingDate: string | null;
  participants: MappingParticipant[];
  segments: RawSegment[];
  chunked: boolean;
}): Promise<ProposedMapping[]> {
  const samples = buildSamples(args.segments, args.participants);

  if (samples.length === 0) return [];

  const major = samples.filter((s) => isMajorLabel(s.totalSeconds, s.segmentCount));
  const minor = samples.filter((s) => !isMajorLabel(s.totalSeconds, s.segmentCount));

  const byLabel = new Map<string, { display_name: string | null; confidence: number; reason: string }>();

  // Only the labels that carry the conversation are worth an LLM call.
  if (major.length > 0) {
    const { value } = await structuredCall({
      system: SPEAKER_MAPPING_SYSTEM_PROMPT,
      user: buildSpeakerMappingUserMessage({
        title: args.title,
        shortNote: args.shortNote,
        meetingDate: args.meetingDate,
        participants: args.participants,
        samples: major,
        chunked: args.chunked,
      }),
      schemaName: "speaker_mapping",
      schema: SPEAKER_MAPPING_JSON_SCHEMA,
      parse: (v) => SpeakerMappingResult.parse(v),
    });

    for (const m of value.mappings) byLabel.set(m.speaker_label, m);
  }

  const known = new Set(args.participants.map((p) => p.display_name));

  // Drive the result off the samples, not the model output: every label the
  // transcript actually contains must appear on the review screen, even if
  // the model forgot to mention it.
  const map = (s: MappingSample, isMajor: boolean): ProposedMapping => {
    const m = byLabel.get(s.label);
    // A name the model invented is worse than no name at all.
    const name = m?.display_name && known.has(m.display_name) ? m.display_name : null;
    const confidence = name ? Math.max(0, Math.min(1, m?.confidence ?? 0)) : 0;

    return {
      rawSpeakerLabel: s.label,
      displayName: confidence >= LOW_CONFIDENCE ? name : null,
      confidence,
      reason: isMajor
        ? (m?.reason ?? "No confident match.")
        : "Short interjections only — left unassigned.",
      sampleQuotes: s.quotes.map((q) => q.text),
      segmentCount: s.segmentCount,
      major: isMajor,
    };
  };

  return [
    ...major.map((s) => map(s, true)),
    ...minor.map((s) => map(s, false)),
  ];
}
