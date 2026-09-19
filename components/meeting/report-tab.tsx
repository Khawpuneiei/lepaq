"use client";

import { useState } from "react";
import { AlertTriangle, Check, Pencil, Quote, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { Decision, MeetingReport } from "@/lib/types";

function EvidenceButton({
  idx,
  onJump,
}: {
  idx: number | null | undefined;
  onJump: (idx: number) => void;
}) {
  if (idx == null || idx < 0) return null;
  return (
    <button
      type="button"
      onClick={() => onJump(idx)}
      title="Show the line this came from"
      aria-label="Show the line this came from"
      className="inline-flex shrink-0 items-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <Quote className="size-3.5" aria-hidden />
    </button>
  );
}

export function ReportTab({
  report,
  summary,
  onSummaryChange,
  onJump,
  suggestedStatus,
  suggestedReason,
  onApplyStatus,
  statusApplied,
  editable,
}: {
  report: MeetingReport;
  summary: string;
  onSummaryChange: (value: string) => void;
  onJump: (idx: number) => void;
  suggestedStatus: string | null;
  suggestedReason: string | null;
  onApplyStatus: () => void;
  statusApplied: boolean;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-2xl">Summary</h2>
          {editable && (
            <Button variant="ghost" size="sm" onClick={() => setEditing((v) => !v)}>
              <Pencil className="size-3.5" />
              {editing ? "Done" : "Edit"}
            </Button>
          )}
        </div>

        {editing ? (
          <Textarea
            value={summary}
            rows={7}
            onChange={(e) => onSummaryChange(e.target.value)}
            className="report-prose text-base"
          />
        ) : (
          <p className="report-prose text-base">{summary || "No summary."}</p>
        )}
      </section>

      {/* The suggestion is stored; the status only changes on this click. */}
      {suggestedStatus && (
        <Card className="border-butter-strong bg-butter-soft p-5 dark:bg-butter">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-medium text-on-butter">
                <TrendingUp className="size-4" aria-hidden />
                Suggested status: {suggestedStatus}
              </p>
              {suggestedReason && (
                <p className="mt-1.5 text-sm text-on-butter/90">{suggestedReason}</p>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={onApplyStatus}
              disabled={statusApplied}
            >
              {statusApplied ? (
                <>
                  <Check className="size-3.5" /> Applied
                </>
              ) : (
                "Apply"
              )}
            </Button>
          </div>
        </Card>
      )}

      {report.key_takeaways.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">Key takeaways</h2>
          <ul className="space-y-2">
            {report.key_takeaways.map((t, i) => (
              <li key={i} className="flex gap-3 report-prose text-sm">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.decisions.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">Decisions</h2>
          <ul className="space-y-2">
            {(report.decisions as Decision[]).map((d, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border bg-card p-3"
              >
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                <span className="flex-1 report-prose text-sm">{d.text}</span>
                <EvidenceButton idx={d.evidence_idx} onJump={onJump} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.risks.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-2xl">Risks</h2>
          <ul className="space-y-2">
            {report.risks.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm report-prose">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0 text-sentiment-negative"
                  aria-hidden
                />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.model && (
        <p className="pt-2 text-xs text-muted-foreground">
          <Badge variant="outline" className="mr-2 font-mono text-[10px]">
            {report.model}
          </Badge>
          Drafted by AI from the transcript. Check anything you plan to act on.
        </p>
      )}
    </div>
  );
}
