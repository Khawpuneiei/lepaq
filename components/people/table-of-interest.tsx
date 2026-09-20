"use client";

import Link from "next/link";
import {
  Clapperboard,
  Coffee,
  Palette,
  StickyNote,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/shared/empty-state";
import { SentimentDot } from "@/components/shared/chips";
import { cn, initials } from "@/lib/utils";
import { INTEREST_COLUMNS, INTEREST_NOTE_CATEGORIES } from "@/lib/constants";
import type { FactCategory, Sentiment } from "@/lib/types";

const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  clapperboard: Clapperboard,
  palette: Palette,
  coffee: Coffee,
};

export interface InterestFact {
  category: FactCategory;
  fact: string;
}

export interface InterestRow {
  id: string;
  full_name: string;
  position: string | null;
  company_name: string | null;
  sentiment: Sentiment | null;
  facts: InterestFact[];
}

/**
 * One row per person, one column per kind of thing worth remembering.
 *
 * This is the accumulated view: a fact learned in the third meeting sits in
 * the same cell as one learned in the first, because the person is one row no
 * matter how many times you have met them. Only approved facts appear — the
 * same rule as the profile, and the reason the AI is allowed to guess at all.
 *
 * Where a person has more than one fact in a column, the extra shows beneath
 * in green, which is how the reference design handles a qualifier like
 * "(Extra naan)".
 */
function Cell({ facts }: { facts: InterestFact[] }) {
  if (facts.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }

  const [first, ...rest] = facts;

  return (
    <div className="min-w-0">
      <p className="truncate text-sm">{first.fact}</p>
      {rest.length > 0 && (
        <p className="truncate text-xs text-on-success-soft" title={rest.map((f) => f.fact).join(" · ")}>
          ({rest.map((f) => f.fact).join(", ")})
        </p>
      )}
    </div>
  );
}

export function TableOfInterest({ rows }: { rows: InterestRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={StickyNote}
        title="Nothing remembered yet"
        description="Approve a fact on a meeting's People tab and it lands here, one row per person."
      />
    );
  }

  const withAnything = rows.filter((r) => r.facts.length > 0).length;

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="sticky left-0 z-10 bg-primary text-primary-foreground">
                Name
              </TableHead>
              {INTEREST_COLUMNS.map((col) => {
                const Icon = ICONS[col.icon];
                return (
                  <TableHead key={col.key} className="text-primary-foreground">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <Icon className="size-3.5" aria-hidden />
                      {col.label}
                    </span>
                  </TableHead>
                );
              })}
              <TableHead className="text-primary-foreground">Notes</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => {
              const notes = row.facts.filter((f) =>
                INTEREST_NOTE_CATEGORIES.includes(f.category),
              );

              return (
                <TableRow key={row.id} className="align-top">
                  <TableCell className="sticky left-0 z-10 bg-card">
                    <Link
                      href={`/people/${row.id}`}
                      className="flex items-center gap-3 group"
                    >
                      <Avatar className="size-9">
                        <AvatarFallback className="bg-muted text-[11px]">
                          {initials(row.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium group-hover:underline">
                            {row.full_name}
                          </span>
                          <SentimentDot sentiment={row.sentiment} />
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[row.position, row.company_name].filter(Boolean).join(" · ") ||
                            "No company"}
                        </span>
                      </span>
                    </Link>
                  </TableCell>

                  {INTEREST_COLUMNS.map((col) => {
                    const facts = row.facts.filter((f) =>
                      col.categories.includes(f.category),
                    );
                    return (
                      <TableCell
                        key={col.key}
                        className={cn(
                          "max-w-[12rem]",
                          // the accent marks a cell worth glancing at, which is
                          // what butter yellow is reserved for
                          facts.length > 1 && "bg-butter-soft dark:bg-butter",
                        )}
                      >
                        <Cell facts={facts} />
                      </TableCell>
                    );
                  })}

                  <TableCell className="max-w-[16rem]">
                    {notes.length === 0 ? (
                      <span className="text-muted-foreground/50">—</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {notes.slice(0, 3).map((f, i) => (
                          <li key={i} className="text-sm leading-snug">
                            {f.fact}
                          </li>
                        ))}
                        {notes.length > 3 && (
                          <li className="text-xs text-muted-foreground">
                            +{notes.length - 3} more on their profile
                          </li>
                        )}
                      </ul>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {rows.length} {rows.length === 1 ? "person" : "people"}
        {withAnything < rows.length &&
          ` · ${rows.length - withAnything} with nothing saved yet`}
        . Only approved facts appear here.
      </p>
    </div>
  );
}
