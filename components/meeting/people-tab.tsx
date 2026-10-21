"use client";

import Link from "next/link";
import { Check, Quote, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  ConfidenceChip,
  EngagementDots,
  SentimentChip,
} from "@/components/shared/chips";
import { factCategoryLabel } from "@/lib/constants";
import type { ParticipantRead, PersonFact } from "@/lib/types";

export interface EditableFact extends PersonFact {
  decision: "pending" | "approved" | "dismissed";
}

export function PeopleTab({
  reads,
  facts,
  onFactsChange,
  personIdByName,
  editable,
}: {
  reads: ParticipantRead[];
  facts: EditableFact[];
  onFactsChange: (facts: EditableFact[]) => void;
  personIdByName: Record<string, string>;
  editable: boolean;
}) {
  function decide(id: string, decision: EditableFact["decision"]) {
    onFactsChange(facts.map((f) => (f.id === id ? { ...f, decision } : f)));
  }

  if (reads.length === 0) {
    return (
      <EmptyState
        title="No people read"
        description="Nobody besides you spoke enough to read anything useful."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        Read from words only. Treat as a hint, not a fact.
      </p>

      {reads.map((read) => {
        const theirFacts = facts.filter((f) => f.person_id === read.person_id);
        const personId = read.person_id ?? personIdByName[read.display_name ?? ""];

        return (
          <Card key={read.id} className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              {personId ? (
                <Link
                  href={`/people/${personId}`}
                  className="font-medium hover:underline"
                >
                  {read.display_name}
                </Link>
              ) : (
                <span className="font-medium">{read.display_name}</span>
              )}
              <SentimentChip sentiment={read.sentiment} />
              <EngagementDots value={read.engagement} />
              <ConfidenceChip confidence={read.confidence} />
            </div>

            {read.emotions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {read.emotions.map((e) => (
                  <Badge key={e} variant="secondary" className="font-normal">
                    {e}
                  </Badge>
                ))}
              </div>
            )}

            {read.summary && (
              <p className="mt-3 report-prose text-sm">{read.summary}</p>
            )}

            {read.evidence_quote && (
              <p className="mt-3 flex gap-2 text-sm italic text-muted-foreground">
                <Quote className="mt-0.5 size-3 shrink-0" aria-hidden />
                {read.evidence_quote}
              </p>
            )}

            {theirFacts.length > 0 && (
              <div className="mt-5 border-t pt-4">
                <h4 className="text-sm font-medium">New things learned</h4>
                <div className="mt-3 space-y-2">
                  {theirFacts.map((fact) => (
                    <div
                      key={fact.id}
                      className={
                        fact.decision === "dismissed"
                          ? "flex items-start gap-3 rounded-md border p-3 opacity-50"
                          : "flex items-start gap-3 rounded-md border p-3"
                      }
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-muted-foreground">
                          {/* model-proposed categories are not in the fixed map */}
                          {factCategoryLabel(fact.category)}
                        </p>
                        <p className="mt-0.5 text-sm">{fact.fact}</p>
                        {fact.evidence_quote && (
                          <p className="mt-1 text-xs italic text-muted-foreground">
                            “{fact.evidence_quote}”
                          </p>
                        )}
                      </div>

                      {editable && (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="icon"
                            variant={fact.decision === "approved" ? "default" : "outline"}
                            aria-label={`Approve: ${fact.fact}`}
                            onClick={() =>
                              decide(
                                fact.id,
                                fact.decision === "approved" ? "pending" : "approved",
                              )
                            }
                          >
                            <Check className="size-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={`Dismiss: ${fact.fact}`}
                            onClick={() =>
                              decide(
                                fact.id,
                                fact.decision === "dismissed" ? "pending" : "dismissed",
                              )
                            }
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  Approved facts appear on their profile. Nothing else does.
                </p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
