"use client";

import { Lock, MessageCircleQuestion, Sparkles, ThumbsUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Coach, TalkRatioRow } from "@/lib/types";

/**
 * The coach is the one place butter yellow is spent freely (spec 8.5). It
 * should read as a private note tucked into the page, not another data card.
 *
 * Deliberately absent: any score, grade, percentile or trend line. The whole
 * adoption argument falls apart the moment this looks like a performance
 * metric a manager could ask for (spec 9 barrier 4). There is also no sharing
 * path to this component anywhere in the codebase, which is the real
 * guarantee — the copy below is only a promise.
 */
export function CoachPanel({
  coach,
  talkRatio,
}: {
  coach: Coach | null;
  talkRatio: TalkRatioRow[];
}) {
  if (!coach || !coach.went_well) {
    return (
      <p className="text-sm text-muted-foreground">
        No coach notes for this meeting.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-butter-strong bg-butter-soft p-6 dark:bg-butter">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-on-butter" aria-hidden />
        <h2 className="font-display text-2xl text-on-butter">Coach</h2>
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-on-butter/80">
          <Lock className="size-3" aria-hidden />
          Only you
        </span>
      </div>

      {talkRatio.length > 0 && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-on-butter">Talk time</h3>
          <div className="mt-3 space-y-2">
            {talkRatio.map((row) => (
              <div key={row.name} className="flex items-center gap-3">
                <span
                  className={cn(
                    "w-32 shrink-0 truncate text-xs",
                    row.is_me ? "font-medium text-on-butter" : "text-on-butter/80",
                  )}
                >
                  {row.name}
                  {row.is_me ? " (you)" : ""}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-on-butter/15">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      row.is_me ? "bg-on-butter" : "bg-on-butter/45",
                    )}
                    style={{ width: `${Math.round(row.share * 100)}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs tabular-nums text-on-butter/80">
                  {Math.round(row.share * 100)}%
                </span>
              </div>
            ))}
          </div>
          {coach.talk_ratio_comment && (
            <p className="mt-3 text-sm leading-relaxed text-on-butter/90">
              {coach.talk_ratio_comment}
            </p>
          )}
        </section>
      )}

      {coach.went_well.length > 0 && (
        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-sm font-medium text-on-butter">
            <ThumbsUp className="size-3.5" aria-hidden />
            Went well
          </h3>
          <ul className="mt-2 space-y-1.5">
            {coach.went_well.map((w, i) => (
              <li key={i} className="text-sm leading-relaxed text-on-butter/90">
                {w}
              </li>
            ))}
          </ul>
        </section>
      )}

      {coach.improve.length > 0 && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-on-butter">Try next time</h3>
          <ul className="mt-2 space-y-3">
            {coach.improve.map((item, i) => (
              <li key={i} className="rounded-md bg-on-butter/5 p-3">
                <p className="text-sm text-on-butter/90">{item.observation}</p>
                <p className="mt-1.5 text-sm font-medium text-on-butter">
                  {item.suggestion}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {coach.next_meeting_openers.length > 0 && (
        <section className="mt-6">
          <h3 className="text-sm font-medium text-on-butter">
            Openers for next time
          </h3>
          <ul className="mt-2 space-y-1.5">
            {coach.next_meeting_openers.map((o, i) => (
              <li key={i} className="text-sm italic leading-relaxed text-on-butter/90">
                “{o}”
              </li>
            ))}
          </ul>
        </section>
      )}

      {coach.questions_to_ask_next.length > 0 && (
        <section className="mt-6">
          <h3 className="flex items-center gap-2 text-sm font-medium text-on-butter">
            <MessageCircleQuestion className="size-3.5" aria-hidden />
            Questions to ask
          </h3>
          <ul className="mt-2 space-y-1.5">
            {coach.questions_to_ask_next.map((q, i) => (
              <li key={i} className="text-sm leading-relaxed text-on-butter/90">
                {q}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 border-t border-on-butter/15 pt-4 text-xs text-on-butter/70">
        Only you can see this. It is never shared.
      </p>
    </div>
  );
}
