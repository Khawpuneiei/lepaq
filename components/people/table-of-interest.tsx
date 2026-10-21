"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  Clapperboard,
  Coffee,
  Dumbbell,
  Gamepad2,
  Heart,
  Music,
  Palette,
  PawPrint,
  Plane,
  Plus,
  Sparkles,
  StickyNote,
  Trash2,
  Trophy,
  Utensils,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { SentimentDot } from "@/components/shared/chips";
import { createClient } from "@/lib/supabase/client";
import { cn, initials } from "@/lib/utils";
import { normaliseFactCategory } from "@/lib/constants";
import { bucketFacts, columnCategories, suggestColumns } from "@/lib/interests";
import type { InterestColumn, Sentiment } from "@/lib/types";

/** Icons a custom column can pick from. */
export const COLUMN_ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  utensils: Utensils,
  clapperboard: Clapperboard,
  palette: Palette,
  coffee: Coffee,
  music: Music,
  trophy: Trophy,
  dumbbell: Dumbbell,
  plane: Plane,
  gamepad: Gamepad2,
  pawprint: PawPrint,
  heart: Heart,
  briefcase: Briefcase,
};

export interface InterestFact {
  category: string;
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

function Cell({ facts }: { facts: InterestFact[] }) {
  if (facts.length === 0) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const [first, ...rest] = facts;
  return (
    <div className="min-w-0">
      <p className="text-sm leading-snug">{first.fact}</p>
      {rest.length > 0 && (
        <p className="mt-0.5 text-xs leading-snug text-on-success-soft">
          ({rest.map((f) => f.fact).join(", ")})
        </p>
      )}
    </div>
  );
}

/**
 * One row per person, and the columns belong to the user.
 *
 * The four that ship are only a starting point. When a meeting turns up
 * something that does not fit any of them, the model returns it under a
 * category of its own choosing and it appears below the table as a
 * suggestion. One click promotes it to a column and every person who has that
 * fact fills in at once — nothing is re-analysed, because the facts were
 * already stored, they just had nowhere to show.
 *
 * A suggestion never becomes a column by itself. That is the same
 * approve-before-use rule the rest of the app runs on.
 */
export function TableOfInterest({
  rows,
  columns: initialColumns,
  ownerId,
}: {
  rows: InterestRow[];
  columns: InterestColumn[];
  ownerId: string;
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [adding, setAdding] = useState<{ key: string; label: string; icon: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  const allFacts = rows.flatMap((r) => r.facts);
  const suggestions = suggestColumns(allFacts, columns).filter(
    (s) => !dismissed.includes(s.key),
  );

  async function addColumn(key: string, label: string, icon: string) {
    const normalised = normaliseFactCategory(key);
    if (!normalised) {
      toast.error("That column name cannot be used.", {
        description: "Use letters, numbers and spaces — and not a sensitive category.",
      });
      return;
    }
    if (columns.some((c) => c.key === normalised)) {
      toast.error("You already have a column with that key.");
      return;
    }

    setBusy(true);
    const { data, error } = await createClient()
      .from("interest_columns")
      .insert({
        owner_id: ownerId,
        key: normalised,
        label: label.trim() || normalised,
        icon,
        categories: [normalised],
        sort_order: columns.length + 1,
        is_default: false,
      })
      .select("*")
      .single();
    setBusy(false);

    if (error || !data) {
      toast.error("Could not add that column.", { description: error?.message });
      return;
    }

    setColumns((c) => [...c, data as InterestColumn]);
    setAdding(null);
    toast.success(`Added "${label || normalised}".`);
  }

  async function removeColumn(column: InterestColumn) {
    const previous = columns;
    setColumns((c) => c.filter((x) => x.id !== column.id));

    const { error } = await createClient()
      .from("interest_columns")
      .delete()
      .eq("id", column.id);

    if (error) {
      setColumns(previous);
      toast.error("Could not remove that column.");
      return;
    }
    toast.success(`Removed "${column.label}".`, {
      description: "The facts are kept — they move into Notes.",
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={StickyNote}
        title="Nothing remembered yet"
        description="Approve a fact on a meeting's People tab and it lands here, one row per person."
      />
    );
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border shadow-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-primary hover:bg-primary">
              <TableHead className="text-primary-foreground">Name</TableHead>

              {columns.map((col) => {
                const Icon = COLUMN_ICONS[col.icon] ?? Sparkles;
                return (
                  <TableHead key={col.id} className="text-primary-foreground">
                    <span className="group flex items-center gap-1.5 whitespace-nowrap">
                      <Icon className="size-3.5 shrink-0" aria-hidden />
                      {col.label}
                      <button
                        type="button"
                        onClick={() => removeColumn(col)}
                        aria-label={`Remove the ${col.label} column`}
                        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/20 group-hover:opacity-70 focus-visible:opacity-100"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  </TableHead>
                );
              })}

              <TableHead className="text-primary-foreground">Notes</TableHead>
              <TableHead className="w-10 text-primary-foreground">
                <button
                  type="button"
                  onClick={() => setAdding({ key: "", label: "", icon: "sparkles" })}
                  aria-label="Add a column"
                  title="Add a column"
                  className="rounded p-1 hover:bg-white/20"
                >
                  <Plus className="size-4" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => {
              const { buckets, notes } = bucketFacts(row.facts, columns);

              return (
                <TableRow key={row.id} className="align-top">
                  {/* a width cap, or the truncate below never engages */}
                  <TableCell className="max-w-[16rem]">
                    <Link href={`/people/${row.id}`} className="group flex items-center gap-3">
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

                  {buckets.map(({ column, facts }) => (
                    <TableCell
                      key={column.id}
                      className={cn(
                        // the base TableCell is nowrap, which let a long fact
                        // run straight over the next column
                        "max-w-[13rem] whitespace-normal",
                        facts.length > 1 && "bg-butter-soft dark:bg-butter",
                      )}
                    >
                      <Cell facts={facts} />
                    </TableCell>
                  ))}

                  <TableCell className="max-w-[16rem] whitespace-normal">
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

                  <TableCell />
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ---- what the model found that has nowhere to go ------------------ */}
      {suggestions.length > 0 && (
        <div className="mt-4 rounded-lg border border-butter-strong bg-butter-soft p-4 dark:bg-butter">
          <p className="flex items-center gap-2 text-sm font-medium text-on-butter">
            <Sparkles className="size-4" aria-hidden />
            Found in your meetings, with no column yet
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <div
                key={s.key}
                className="flex items-center gap-2 rounded-md border border-butter-strong bg-card px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.count} {s.count === 1 ? "person" : "people"} · {s.examples[0]}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => addColumn(s.key, s.label, "sparkles")}
                >
                  <Plus className="size-3.5" />
                  Add column
                </Button>
                <button
                  type="button"
                  onClick={() => setDismissed((d) => [...d, s.key])}
                  aria-label={`Dismiss ${s.label}`}
                  className="rounded p-1 text-muted-foreground hover:bg-muted"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-on-butter/80">
            Adding a column fills it in for everyone at once — the facts are
            already saved, they just had nowhere to show.
          </p>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Showing {rows.length} {rows.length === 1 ? "person" : "people"} ·{" "}
        {columns.length} {columns.length === 1 ? "column" : "columns"}. Only
        approved facts appear here.
      </p>

      {/* ---- add a column by hand ---------------------------------------- */}
      <Dialog open={adding !== null} onOpenChange={(o) => !o && setAdding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a column</DialogTitle>
            <DialogDescription>
              The key is what the AI will use when it spots this kind of thing
              in a meeting, so keep it a single plain word like
              &ldquo;sport&rdquo; or &ldquo;travel&rdquo;.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="col-label">Column heading</Label>
              <Input
                id="col-label"
                value={adding?.label ?? ""}
                placeholder="Favourite sport"
                onChange={(e) =>
                  setAdding((a) =>
                    a
                      ? {
                          ...a,
                          label: e.target.value,
                          // keep the key in step until the user edits it
                          key: a.key || "",
                        }
                      : a,
                  )
                }
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="col-key">Key the AI uses</Label>
              <Input
                id="col-key"
                value={adding?.key ?? ""}
                placeholder="sport"
                onChange={(e) =>
                  setAdding((a) => (a ? { ...a, key: e.target.value } : a))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(COLUMN_ICONS).map(([name, Icon]) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={name}
                    onClick={() => setAdding((a) => (a ? { ...a, icon: name } : a))}
                    className={cn(
                      "rounded-md border p-2 transition-colors",
                      adding?.icon === name
                        ? "border-primary bg-primary/10 text-primary"
                        : "hover:bg-muted",
                    )}
                  >
                    <Icon className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !adding?.key.trim()}
              onClick={() =>
                adding && addColumn(adding.key, adding.label, adding.icon)
              }
            >
              Add column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { columnCategories };
