"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2, Quote, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ProcessingSteps } from "@/components/meeting/processing-steps";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/talkRatio";

const UNASSIGNED = "__unassigned__";
const LOW_CONFIDENCE = 0.6;

export interface SpeakerRow {
  raw_speaker_label: string;
  participant_id: string | null;
  confidence: number | null;
  reason: string | null;
  sample_quotes: string[];
  segment_count: number | null;
  seconds: number;
  chunk_index: number | null;
  /** False for backchannel-only voices; they are hidden behind a disclosure. */
  major: boolean;
}

export interface ParticipantOption {
  id: string;
  display_name: string;
  position: string | null;
  is_me: boolean;
}

/**
 * The single screen that removes the biggest quality risk in the product:
 * attributing a quote to the wrong person (spec 5.2).
 *
 * Two things keep it to one screen on a long recording. Labels are ordered by
 * how much each voice actually said, so the handful that matter are at the
 * top. And backchannel-only labels — the "mm-hmm" voices diarization invents
 * by the dozen — are collapsed out of the way rather than each demanding a
 * decision. On a real 61-minute call that is the difference between 17 rows
 * and 50.
 */
export function SpeakerReview({
  meetingId,
  rows,
  participants,
  chunked,
}: {
  meetingId: string;
  rows: SpeakerRow[];
  participants: ParticipantOption[];
  chunked: boolean;
}) {
  const router = useRouter();
  const [assignments, setAssignments] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rows.map((r) => [
        r.raw_speaker_label,
        // a low-confidence guess is deliberately NOT pre-filled
        r.participant_id && (r.confidence ?? 0) >= LOW_CONFIDENCE
          ? r.participant_id
          : UNASSIGNED,
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMinor, setShowMinor] = useState(false);

  const major = useMemo(() => rows.filter((r) => r.major), [rows]);
  const minor = useMemo(() => rows.filter((r) => !r.major), [rows]);

  // Only count the voices actually being asked about.
  const blanks = useMemo(
    () => major.filter((r) => assignments[r.raw_speaker_label] === UNASSIGNED).length,
    [major, assignments],
  );

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mappings: rows.map((r) => ({
            raw_speaker_label: r.raw_speaker_label,
            participant_id:
              assignments[r.raw_speaker_label] === UNASSIGNED
                ? null
                : assignments[r.raw_speaker_label],
          })),
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not write the report.");

      router.push(`/meetings/${meetingId}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  }

  function renderRow(row: SpeakerRow) {
    const low = (row.confidence ?? 0) < LOW_CONFIDENCE;
    const unset = assignments[row.raw_speaker_label] === UNASSIGNED;

    return (
      <Card
        key={row.raw_speaker_label}
        className={cn(
          "p-5",
          row.major &&
            low &&
            unset &&
            "border-butter-strong bg-butter-soft dark:bg-butter",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                Voice {row.raw_speaker_label.replace(/^c\d+_/, "")}
              </span>
              {chunked && row.chunk_index !== null && (
                <Badge variant="outline" className="text-xs">
                  part {row.chunk_index + 1}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {row.segment_count ?? 0} turns · {formatDuration(row.seconds)}
              </span>
              {row.major && low && (
                <Badge
                  variant="outline"
                  className="border-butter-strong bg-butter text-on-butter"
                >
                  not sure
                </Badge>
              )}
            </div>

            {row.reason && (
              <p className="mt-1 text-xs text-muted-foreground">{row.reason}</p>
            )}

            <ul className="mt-3 space-y-1.5">
              {row.sample_quotes.slice(0, 2).map((q, i) => (
                <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                  <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span className="italic">{q}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="w-full sm:w-56">
            <Select
              value={assignments[row.raw_speaker_label]}
              onValueChange={(v) =>
                setAssignments((a) => ({ ...a, [row.raw_speaker_label]: v }))
              }
            >
              <SelectTrigger
                className="w-full"
                aria-label={`Who is voice ${row.raw_speaker_label}?`}
              >
                <SelectValue placeholder="Choose a person" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Not sure / someone else</SelectItem>
                {participants.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name}
                    {p.is_me ? " (you)" : p.position ? ` — ${p.position}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>
    );
  }

  if (busy) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <h1 className="mb-2 text-center font-display text-3xl">Writing your report</h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          Summary, follow-ups, what to remember about each person, and a coach note.
        </p>
        <ProcessingSteps status="analyzing" uploading={false} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl">Who said what?</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        The transcript knows there were different voices, but not their names.
        Confirm them and everything downstream — quotes, emotion reads, the
        coach note — attaches to the right person.
      </p>

      {chunked && (
        <p className="mt-4 rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This recording was long, so it was transcribed in parts. Each voice
          appears once per part, which is why the same person can show up more
          than once below. Assign each row and they are merged.
        </p>
      )}

      {blanks > 0 && (
        <p className="mt-4 flex items-center gap-2 text-sm text-on-butter">
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          {blanks} {blanks === 1 ? "voice has" : "voices have"} no name yet. You
          can leave them — they will read as &ldquo;Speaker A&rdquo; in the
          transcript.
        </p>
      )}

      <div className="mt-6 space-y-3">{major.map(renderRow)}</div>

      {minor.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowMinor((v) => !v)}
            aria-expanded={showMinor}
            className="flex w-full items-center gap-2 rounded-md border border-dashed px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/50"
          >
            <ChevronRight
              className={cn(
                "size-4 shrink-0 transition-transform",
                showMinor && "rotate-90",
              )}
              aria-hidden
            />
            <span className="flex-1">
              {minor.length} quieter {minor.length === 1 ? "voice" : "voices"} —
              one-word interjections like &ldquo;mm-hmm&rdquo; that the
              transcriber split into their own speakers. Safe to leave alone.
            </span>
          </button>
          {showMinor && <div className="mt-3 space-y-3">{minor.map(renderRow)}</div>}
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-md border border-danger/40 bg-danger-soft p-4 text-sm text-on-danger-soft">
          {error}
        </p>
      )}

      <div className="sticky bottom-0 mt-8 flex justify-end gap-2 border-t bg-background/95 py-4 backdrop-blur">
        <Button
          onClick={confirm}
          disabled={busy}
          className="bg-brand text-on-brand hover:bg-brand-hover"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Confirm and write the report
        </Button>
      </div>
    </div>
  );
}
