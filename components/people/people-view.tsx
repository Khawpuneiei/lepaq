"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Search, Table2, Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { SentimentChip, StatusChip } from "@/components/shared/chips";
import {
  TableOfInterest,
  type InterestFact,
} from "@/components/people/table-of-interest";
import { cn, formatDate, initials, pluralise } from "@/lib/utils";
import type { InterestColumn, Sentiment } from "@/lib/types";

export interface PersonRow {
  id: string;
  full_name: string;
  position: string | null;
  company_id: string | null;
  company_name: string | null;
  status_label: string | null;
  status_color: string | null;
  /** From the most recent meeting they appeared in, not an average. */
  sentiment: Sentiment | null;
  last_met: string | null;
  meeting_count: number;
  facts: InterestFact[];
}

/**
 * Two ways to read the same one-row-per-person list.
 *
 * Cards answer "who is this and where are we", the Table of Interest answers
 * "what do I need to remember before I walk in". Both are built from the same
 * rows, so a person can never appear twice in one and once in the other.
 *
 * The status shown is from the most recent meeting. Three meetings with the
 * same person produce one row carrying the latest reading, not three rows —
 * an average across months would describe a relationship that no longer
 * exists.
 */
export function PeopleView({
  people,
  columns,
  ownerId,
}: {
  people: PersonRow[];
  columns: InterestColumn[];
  ownerId: string;
}) {
  const [view, setView] = useState<"cards" | "table">("cards");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.full_name.toLowerCase().includes(q) ||
        (p.company_name ?? "").toLowerCase().includes(q) ||
        (p.position ?? "").toLowerCase().includes(q) ||
        p.facts.some((f) => f.fact.toLowerCase().includes(q)),
    );
  }, [people, query]);

  if (people.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No people yet"
        description="People are created from the participants you name when you upload a meeting, and merged automatically if you meet them again."
      />
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, companies, or anything you remembered"
            className="pl-9"
            aria-label="Search people"
          />
        </div>

        <div
          className="inline-flex shrink-0 rounded-md border p-0.5"
          role="tablist"
          aria-label="View"
        >
          {(
            [
              ["cards", "Cards", LayoutGrid],
              ["table", "Table of interest", Table2],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={cn(
                "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm transition-colors duration-150",
                view === key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          Nobody matches &ldquo;{query}&rdquo;.
        </p>
      ) : view === "table" ? (
        <TableOfInterest rows={filtered} columns={columns} ownerId={ownerId} />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((p) => (
            <Card key={p.id} className="p-4 transition-shadow hover:shadow-card">
              <Link href={`/people/${p.id}`} className="flex items-start gap-3">
                <Avatar className="size-10">
                  <AvatarFallback className="bg-muted text-xs">
                    {initials(p.full_name)}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{p.full_name}</p>
                    <SentimentChip sentiment={p.sentiment} />
                  </div>

                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[p.position, p.company_name].filter(Boolean).join(" · ") ||
                      "No company"}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusChip label={p.status_label} color={p.status_color} />
                    <span className="text-xs text-muted-foreground">
                      {pluralise(p.meeting_count, "meeting")}
                      {p.last_met ? ` · last ${formatDate(p.last_met)}` : ""}
                    </span>
                  </div>

                  {p.facts.length > 0 && (
                    <p className="mt-2 truncate text-xs text-on-butter">
                      {p.facts.length} thing{p.facts.length === 1 ? "" : "s"}{" "}
                      remembered — {p.facts[0].fact}
                    </p>
                  )}
                </div>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
