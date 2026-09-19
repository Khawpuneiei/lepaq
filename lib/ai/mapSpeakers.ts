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

  const { value } = await structuredCall({
    system: SPEAKER_MAPPING_SYSTEM_PROMPT,
    user: buildSpeakerMappingUserMessage({
      title: args.title,
      shortNote: args.shortNote,
      meetingDate: args.meetingDate,
      participants: args.participants,
      samples,
      chunked: args.chunked,
    }),
    schemaName: "speaker_mapping",
    schema: SPEAKER_MAPPING_JSON_SCHEMA,
    parse: (v) => SpeakerMappingResult.parse(v),
  });

  const known = new Set(args.participants.map((p) => p.display_name));
  const byLabel = new Map(value.mappings.map((m) => [m.speaker_label, m]));

  // Drive the result off the samples, not the model output: every label the
  // transcript actually contains must appear on the review screen, even if
  // the model forgot to mention it.
  return samples.map((s) => {
    const m = byLabel.get(s.label);
    // A name the model invented is worse than no name at all.
    const name = m?.display_name && known.has(m.display_name) ? m.display_name : null;
    const confidence = name ? Math.max(0, Math.min(1, m?.confidence ?? 0)) : 0;

    return {
      rawSpeakerLabel: s.label,
      displayName: confidence >= LOW_CONFIDENCE ? name : null,
      confidence,
      reason: m?.reason ?? "No confident match.",
      sampleQuotes: s.quotes.map((q) => q.text),
      segmentCount: s.segmentCount,
    };
  });
}
