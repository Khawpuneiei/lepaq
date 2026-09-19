"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { MeetingStatus } from "@/lib/types";

const STEPS = [
  { key: "upload", label: "Uploading", typical: "a few seconds" },
  { key: "transcribe", label: "Transcribing", typical: "1-3 min" },
  { key: "speakers", label: "Identifying speakers", typical: "about 20 s" },
  { key: "report", label: "Writing your report", typical: "about 30 s" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function stepStateFor(status: MeetingStatus, uploading: boolean): StepKey {
  if (uploading || status === "uploaded") return "upload";
  if (status === "transcribing") return "transcribe";
  if (status === "awaiting_speakers") return "speakers";
  return "report";
}

/**
 * A calm four-step list rather than a percentage bar (spec 7.3). The user is
 * told they can leave — long recordings genuinely take minutes, and pretending
 * otherwise is how a progress bar loses trust.
 */
export function ProcessingSteps({
  status,
  uploading,
  progressNote,
  error,
  chunks,
}: {
  status: MeetingStatus;
  uploading: boolean;
  progressNote?: string | null;
  error?: string | null;
  chunks?: { done: number; total: number };
}) {
  const current = stepStateFor(status, uploading);
  const currentIndex = STEPS.findIndex((s) => s.key === current);
  const failed = status === "failed";

  return (
    <div className="mx-auto max-w-lg">
      <ol className="space-y-1">
        {STEPS.map((step, i) => {
          const done = !failed && i < currentIndex;
          const active = !failed && i === currentIndex;

          return (
            <li
              key={step.key}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-3 transition-colors duration-150",
                active && "bg-muted",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  done && "border-transparent bg-success-solid text-white",
                  active && "border-primary text-primary",
                  !done && !active && "border-border text-muted-foreground",
                )}
              >
                {failed && active ? (
                  <AlertTriangle className="size-3.5 text-danger" aria-hidden />
                ) : done ? (
                  <Check className="size-3.5" aria-hidden />
                ) : active ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <span className="text-[11px]">{i + 1}</span>
                )}
              </span>

              <span className="flex-1">
                <span className={cn("text-sm", active && "font-medium")}>
                  {step.label}
                </span>
                {active && chunks && chunks.total > 1 && step.key === "transcribe" && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    part {Math.min(chunks.done + 1, chunks.total)} of {chunks.total}
                  </span>
                )}
              </span>

              <span className="shrink-0 text-xs text-muted-foreground">
                {done ? "done" : step.typical}
              </span>
            </li>
          );
        })}
      </ol>

      {progressNote && !failed && (
        <p className="mt-4 text-center text-sm text-muted-foreground">{progressNote}</p>
      )}

      {error && (
        <div className="mt-6 rounded-md border border-danger/40 bg-danger-soft p-4">
          <p className="text-sm font-medium text-on-danger-soft">
            That did not work
          </p>
          <p className="mt-1 text-sm text-on-danger-soft/90">{error}</p>
        </div>
      )}

      {!failed && (
        <p className="mt-6 text-center text-xs text-muted-foreground">
          You can close this page. It will be waiting on your dashboard when it
          is ready.
        </p>
      )}
    </div>
  );
}
