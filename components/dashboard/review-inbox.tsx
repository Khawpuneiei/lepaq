import Link from "next/link";
import { AlertTriangle, ArrowRight, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate, pluralise } from "@/lib/utils";
import type { Meeting } from "@/lib/types";

/**
 * The inbox of the product (spec 7.2). Anything waiting on the user lands
 * here: speakers to confirm, reports to approve, runs that failed.
 *
 * Butter yellow, because this is "for you" rather than "about the pipeline".
 */
export function ReviewInbox({
  meetings,
  processing = 0,
}: {
  meetings: Pick<Meeting, "id" | "title" | "meeting_date" | "status" | "error">[];
  /** Meetings still uploading, transcribing or being written up. */
  processing?: number;
}) {
  if (meetings.length === 0) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">
          {processing > 0
            ? `Nothing to review yet. ${pluralise(processing, "meeting")} still processing; ${processing === 1 ? "it shows" : "they show"} up here when the report is ready.`
            : "Nothing waiting for you. Every report so far is approved."}
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {meetings.map((m) => {
        const failed = m.status === "failed";
        const speakers = m.status === "awaiting_speakers";
        const href = speakers ? `/meetings/${m.id}/speakers` : `/meetings/${m.id}`;

        return (
          <Card
            key={m.id}
            className={
              failed
                ? "border-danger/40 bg-danger-soft/40 p-4"
                : "border-butter-strong bg-butter-soft p-4 dark:bg-butter"
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {failed ? (
                    <AlertTriangle className="size-4 shrink-0 text-danger" aria-hidden />
                  ) : speakers ? (
                    <Users className="size-4 shrink-0 text-on-butter" aria-hidden />
                  ) : null}
                  <p className="truncate font-medium">{m.title}</p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDate(m.meeting_date)} ·{" "}
                  {failed
                    ? (m.error ?? "Processing failed")
                    : speakers
                      ? "Confirm who is who, then it writes the report"
                      : "Report ready for your review"}
                </p>
              </div>
              <Button asChild size="sm" variant={failed ? "outline" : "default"}>
                <Link href={href}>
                  {failed ? "See what happened" : speakers ? "Check speakers" : "Review"}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
