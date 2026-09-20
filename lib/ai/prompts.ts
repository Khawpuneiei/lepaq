import type { TalkRatioRow } from "@/lib/types";

export const ANALYSIS_SYSTEM_PROMPT = `You are the analysis engine of a personal meeting assistant used by a
partnerships manager at a small Singapore company. The user is marked
"is_me". Everything you write is a private draft for the user only.

Rules
1. Use only what is in the transcript and the labels. Never invent names,
   numbers, dates, or commitments. If a deadline was not stated, return null.
2. Every decision, action item, emotion read, and personal fact must point to
   evidence: a segment index or a short verbatim quote (max 20 words).
3. Emotion reads come from words alone, not tone of voice. Be modest. Use
   "low" confidence when a person spoke little. Describe, do not diagnose.
4. Personal facts are things that help build rapport. They fill a
   one-row-per-person table, so return the specific noun, not a sentence:
   "Kaya toast", not "He said he enjoys kaya toast".
   The user message lists the category keys this user already has a column
   for. Use one of those whenever the fact fits. When something genuinely does
   not fit — they spent ten minutes on their football team and there is no
   sport column — coin a short new snake_case key for it, like "sport" or
   "travel". Do not coin a key for a one-off aside; a new key should be
   something worth a column of its own.
   Do NOT record health conditions, religion, politics, ethnicity, sexuality,
   finances, or family problems, in any category, under any key, even if
   mentioned. Do not work around this by inventing a euphemistic key.
5. Coaching is for the user only. Be specific and kind. Base it on observable
   behaviour: who talked how much, questions asked, interruptions, unclear
   next steps, objections left unanswered. Offer one concrete alternative
   phrasing where useful. Never score or grade the user.
6. suggested_status must be exactly one of the allowed labels, or null if the
   meeting gives no reason to change it.
7. The follow-up email is under 160 words, warm and professional, British
   English spelling, lists agreed next steps, and makes no promise that was
   not made in the meeting.
8. Expect Singapore English and occasional Mandarin, Malay, or Tamil words.
   Do not "correct" them in quotes.`;

export const SPEAKER_MAPPING_SYSTEM_PROMPT = `You match anonymous diarization labels to the named participants of a meeting.

Rules
1. Use self-introductions, direct address ("thanks Sarah"), role references,
   and topic ownership as evidence. Quote or paraphrase that evidence in the
   reason field.
2. confidence is 0 to 1 and must be honest. If a label could plausibly be two
   different participants, say 0.4, not 0.8. Anything below 0.6 is shown to
   the user as a blank dropdown for them to fill in, which is a good outcome —
   a confident wrong answer is much worse than an admitted unknown.
3. If no participant matches a label, set display_name to null and list the
   label in unmapped_labels. Extra speakers are normal: someone may have
   joined late, or the recording may have caught a passer-by.
4. Long recordings are transcribed in parts, and a label carries its part
   number, like c0_A or c2_B. Labels are only meaningful inside their own
   part: c0_A and c1_A are frequently DIFFERENT people, and the same person
   usually appears under a different letter in each part. Map every label on
   its own evidence. Several labels mapping to one participant is the normal
   result, not a mistake.
5. display_name must be copied exactly from the participant list, character
   for character. Do not reformat, translate, or add titles.`;

function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export interface MappingParticipant {
  display_name: string;
  position: string | null;
  is_me: boolean;
}

export interface MappingSample {
  label: string;
  segmentCount: number;
  totalSeconds: number;
  quotes: { startSec: number; text: string }[];
}

export function buildSpeakerMappingUserMessage(args: {
  title: string;
  shortNote: string | null;
  meetingDate: string | null;
  participants: MappingParticipant[];
  samples: MappingSample[];
  chunked: boolean;
}) {
  const lines: string[] = [];

  lines.push(`Meeting: ${args.title}`);
  if (args.meetingDate) lines.push(`Date: ${args.meetingDate}`);
  if (args.shortNote) lines.push(`Context from the user: ${args.shortNote}`);

  lines.push("", "Participants supplied by the user:");
  for (const p of args.participants) {
    const bits = [p.display_name];
    if (p.position) bits.push(p.position);
    if (p.is_me) bits.push("THIS IS THE USER");
    lines.push(`- ${bits.join(" — ")}`);
  }

  if (args.chunked) {
    lines.push(
      "",
      "This recording was long, so it was transcribed in parts. Labels are",
      "written as c<part>_<letter>. Treat each label independently: the same",
      "person will appear under several labels across parts.",
    );
  }

  lines.push("", "Diarization labels and sample lines:");
  for (const s of args.samples) {
    lines.push(
      "",
      `[${s.label}] ${s.segmentCount} turns, ${Math.round(s.totalSeconds)}s of speech`,
    );
    for (const q of s.quotes) {
      lines.push(`  ${formatClock(q.startSec)} "${q.text}"`);
    }
  }

  lines.push(
    "",
    "Return a mapping for every label listed above, and nothing else.",
  );

  return lines.join("\n");
}

export interface AnalysisTranscriptLine {
  idx: number;
  speaker: string;
  text: string;
  startSec: number | null;
}

export function buildAnalysisUserMessage(args: {
  title: string;
  shortNote: string | null;
  meetingDate: string | null;
  durationSec: number | null;
  participants: MappingParticipant[];
  companyName: string | null;
  currentCompanyStatus: string | null;
  allowedStatuses: string[];
  /** Category keys this user has a Table of Interest column for. */
  interestKeys: { key: string; label: string }[];
  knownFacts: { person: string; category: string; fact: string }[];
  talkRatio: TalkRatioRow[];
  transcript: AnalysisTranscriptLine[];
}) {
  const lines: string[] = [];

  lines.push(`Meeting: ${args.title}`);
  if (args.meetingDate) lines.push(`Date: ${args.meetingDate}`);
  if (args.companyName) lines.push(`Company: ${args.companyName}`);
  if (args.durationSec) {
    lines.push(`Duration: ${Math.round(args.durationSec / 60)} minutes`);
  }
  if (args.shortNote) lines.push(`Note from the user: ${args.shortNote}`);

  lines.push("", "Participants:");
  for (const p of args.participants) {
    const bits = [p.display_name];
    if (p.position) bits.push(p.position);
    if (p.is_me) bits.push("is_me");
    lines.push(`- ${bits.join(" — ")}`);
  }

  lines.push(
    "",
    `Current company status: ${args.currentCompanyStatus ?? "not set"}`,
    `Allowed status labels (suggested_status must be one of these, or null): ${
      args.allowedStatuses.length ? args.allowedStatuses.join(", ") : "none defined"
    }`,
  );

  if (args.interestKeys.length) {
    lines.push(
      "",
      "Category keys this user already has a column for — prefer these:",
    );
    for (const k of args.interestKeys) {
      lines.push(`- ${k.key} (${k.label})`);
    }
    lines.push(
      "If a fact does not fit any of them, coin a short new snake_case key.",
    );
  }

  if (args.knownFacts.length) {
    lines.push(
      "",
      "Already known about these people — do NOT return these again as new facts:",
    );
    for (const f of args.knownFacts) {
      lines.push(`- ${f.person} (${f.category}): ${f.fact}`);
    }
  }

  if (args.talkRatio.length) {
    lines.push(
      "",
      "Talk time, measured from the audio (not your estimate — use these numbers):",
    );
    for (const t of args.talkRatio) {
      lines.push(
        `- ${t.name}${t.is_me ? " (is_me)" : ""}: ${Math.round(t.seconds)}s, ${Math.round(
          t.share * 100,
        )}%`,
      );
    }
  }

  lines.push(
    "",
    "Transcript. Cite evidence_idx using the number in square brackets.",
    "",
  );
  for (const l of args.transcript) {
    lines.push(`[${l.idx}] ${l.speaker}: ${l.text}`);
  }

  return lines.join("\n");
}

/** Prompt for the Handover brief on a company profile (spec 7.7). */
export const HANDOVER_SYSTEM_PROMPT = `You write a short handover brief so a colleague can cover a relationship
while the user is away. You are given approved summaries, approved personal
facts, and open follow-ups. Use only what you are given. Never invent a
commitment, a date, or a preference. Write plainly, in British English, in at
most 400 words. Do not include coaching notes, emotion reads, or anything that
would embarrass the user if the client read it.`;
