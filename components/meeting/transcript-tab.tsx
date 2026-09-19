"use client";

import { useMemo, useState } from "react";
import { RotateCcw, Search, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/talkRatio";
import type { TranscriptSegment } from "@/lib/types";

/** Stable colour per speaker, from the chart ramp. */
const SPEAKER_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--sentiment-negative)",
];

export function TranscriptTab({
  segments: initial,
  participants,
  meetingId,
  onNeedsRegenerate,
  editable,
}: {
  segments: TranscriptSegment[];
  participants: { id: string; display_name: string }[];
  meetingId: string;
  onNeedsRegenerate: () => void;
  editable: boolean;
}) {
  const [segments, setSegments] = useState(initial);
  const [query, setQuery] = useState("");

  const speakerColor = useMemo(() => {
    const names = Array.from(new Set(segments.map((s) => s.speaker_label)));
    return new Map(names.map((n, i) => [n, SPEAKER_COLORS[i % SPEAKER_COLORS.length]]));
  }, [segments]);

  const visible = useMemo(() => {
    if (!query.trim()) return segments;
    const q = query.toLowerCase();
    return segments.filter(
      (s) => s.text.toLowerCase().includes(q) || s.speaker_label.toLowerCase().includes(q),
    );
  }, [segments, query]);

  /**
   * Reassigning a speaker rewrites every line that shares the same raw
   * diarization label, not just the one clicked — the model got that whole
   * voice wrong, not one sentence. On a split recording this still only
   * touches the one part, which is correct: the other parts have their own
   * labels and may well be right.
   */
  async function reassign(rawLabel: string, name: string) {
    const previous = segments;
    setSegments((ss) =>
      ss.map((s) => (s.raw_speaker_label === rawLabel ? { ...s, speaker_label: name } : s)),
    );

    const { error } = await createClient()
      .from("transcript_segments")
      .update({ speaker_label: name })
      .eq("meeting_id", meetingId)
      .eq("raw_speaker_label", rawLabel);

    if (error) {
      setSegments(previous);
      toast.error("Could not reassign that speaker.", { description: error.message });
      return;
    }

    toast.success(`Reassigned to ${name}.`, {
      description: "Regenerate the report so it uses the correction.",
      action: { label: "Regenerate", onClick: onNeedsRegenerate },
    });
  }

  /** Spec 9 barrier 3: strike a candid line, then regenerate without it. */
  async function toggleExcluded(segment: TranscriptSegment) {
    const next = !segment.excluded;
    const previous = segments;
    setSegments((ss) =>
      ss.map((s) => (s.id === segment.id ? { ...s, excluded: next } : s)),
    );

    const { error } = await createClient()
      .from("transcript_segments")
      .update({ excluded: next })
      .eq("id", segment.id);

    if (error) {
      setSegments(previous);
      toast.error("Could not update that line.");
      return;
    }

    if (next) {
      toast.success("Line struck from the record.", {
        description: "Regenerate to remove it from the report too.",
        action: { label: "Regenerate", onClick: onNeedsRegenerate },
      });
    }
  }

  return (
    <div>
      <p className="mb-4 rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        Machine transcript. May contain errors. This is never shared, and never
        leaves your account.
      </p>

      <div className="relative mb-4">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the transcript"
          className="pl-9"
          aria-label="Search the transcript"
        />
      </div>

      {visible.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nothing matches “{query}”.
        </p>
      )}

      <div className="space-y-1">
        {visible.map((segment) => (
          <div
            key={segment.id}
            id={`segment-${segment.idx}`}
            className={cn(
              "group grid grid-cols-[auto_1fr_auto] items-start gap-3 rounded-md px-3 py-2 scroll-mt-24",
              "target:bg-butter target:ring-1 target:ring-butter-strong",
              segment.excluded && "opacity-40",
            )}
          >
            <span className="w-12 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
              {formatDuration(segment.start_sec ?? 0)}
            </span>

            <div className="min-w-0">
              {editable ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="text-sm font-medium hover:underline"
                      style={{ color: speakerColor.get(segment.speaker_label) }}
                    >
                      {segment.speaker_label}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {participants.map((p) => (
                      <DropdownMenuItem
                        key={p.id}
                        onClick={() =>
                          reassign(segment.raw_speaker_label, p.display_name)
                        }
                      >
                        {p.display_name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span
                  className="text-sm font-medium"
                  style={{ color: speakerColor.get(segment.speaker_label) }}
                >
                  {segment.speaker_label}
                </span>
              )}

              <p
                className={cn(
                  "report-prose text-sm",
                  segment.excluded && "line-through",
                )}
              >
                {segment.text}
              </p>
            </div>

            {editable && (
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={
                  segment.excluded ? "Restore this line" : "Strike this line"
                }
                onClick={() => toggleExcluded(segment)}
              >
                {segment.excluded ? (
                  <Undo2 className="size-3.5" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </Button>
            )}
          </div>
        ))}
      </div>

      {editable && (
        <div className="mt-6 border-t pt-4">
          <Button variant="outline" size="sm" onClick={onNeedsRegenerate}>
            <RotateCcw className="size-3.5" />
            Regenerate report from this transcript
          </Button>
        </div>
      )}
    </div>
  );
}
