import type { TalkRatioRow } from "@/lib/types";

interface TimedSegment {
  speaker_label: string;
  start_sec: number | null;
  end_sec: number | null;
  excluded?: boolean;
}

interface LabelledParticipant {
  display_name: string;
  speaker_label: string | null;
  is_me: boolean | null;
}

/**
 * Talk time is measured here, in code, and passed to the model as fact
 * (spec 5.3). Asking an LLM to estimate who talked most is a good way to get
 * a confident wrong number into a coaching note.
 *
 * Segments the user struck from the transcript are excluded, so deleting a
 * candid remark also removes it from the ratio rather than leaving a gap the
 * numbers still count.
 */
export function computeTalkRatio(
  segments: TimedSegment[],
  participants: LabelledParticipant[],
): TalkRatioRow[] {
  const secondsByLabel = new Map<string, number>();

  for (const s of segments) {
    if (s.excluded) continue;
    const duration = Math.max(0, (s.end_sec ?? 0) - (s.start_sec ?? 0));
    if (duration === 0) continue;
    secondsByLabel.set(
      s.speaker_label,
      (secondsByLabel.get(s.speaker_label) ?? 0) + duration,
    );
  }

  const rows: TalkRatioRow[] = [];
  const claimed = new Set<string>();

  for (const p of participants) {
    if (!p.speaker_label) continue;
    claimed.add(p.speaker_label);
    rows.push({
      name: p.display_name,
      seconds: secondsByLabel.get(p.speaker_label) ?? 0,
      share: 0,
      is_me: Boolean(p.is_me),
    });
  }

  // speech that was never mapped to anybody still counts towards the total,
  // otherwise the user's share looks larger than it was
  let unassigned = 0;
  for (const [label, seconds] of secondsByLabel) {
    if (!claimed.has(label)) unassigned += seconds;
  }
  if (unassigned > 0) {
    rows.push({ name: "Unassigned", seconds: unassigned, share: 0, is_me: false });
  }

  const total = rows.reduce((n, r) => n + r.seconds, 0);
  return rows
    .map((r) => ({ ...r, share: total > 0 ? r.seconds / total : 0 }))
    .sort((a, b) => b.seconds - a.seconds);
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds < 1) return "0:00";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}
