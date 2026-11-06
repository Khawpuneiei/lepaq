"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { ArrowRight, CircleCheckBig } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/client";
import { cn, dueLabel } from "@/lib/utils";

export interface FollowUpRow {
  id: string;
  title: string;
  assignee_name: string | null;
  due_date: string | null;
  done: boolean;
  meeting_id: string | null;
  meeting_title: string | null;
  company_name: string | null;
}

type Bucket = "Overdue" | "This week" | "Later" | "Done";

function bucketOf(row: FollowUpRow): Bucket {
  if (row.done) return "Done";
  if (!row.due_date) return "Later";
  const days = differenceInCalendarDays(parseISO(row.due_date), new Date());
  if (days < 0) return "Overdue";
  if (days <= 7) return "This week";
  return "Later";
}

const ORDER: Bucket[] = ["Overdue", "This week", "Later", "Done"];
const ALL = "__all__";

/** Where to go from an empty list, worked out from the user's meetings. */
export interface FollowUpsNextStep {
  href: string;
  label: string;
  note: string | null;
}

export function FollowUpsList({
  rows: initial,
  nextStep,
}: {
  rows: FollowUpRow[];
  nextStep?: FollowUpsNextStep;
}) {
  const [rows, setRows] = useState(initial);
  const [company, setCompany] = useState(ALL);
  const [assignee, setAssignee] = useState(ALL);

  const companies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.company_name).filter(Boolean))) as string[],
    [rows],
  );
  const assignees = useMemo(
    () => Array.from(new Set(rows.map((r) => r.assignee_name).filter(Boolean))) as string[],
    [rows],
  );

  const filtered = rows.filter(
    (r) =>
      (company === ALL || r.company_name === company) &&
      (assignee === ALL || r.assignee_name === assignee),
  );

  const grouped = ORDER.map((bucket) => ({
    bucket,
    rows: filtered.filter((r) => bucketOf(r) === bucket),
  })).filter((g) => g.rows.length > 0);

  async function toggle(row: FollowUpRow) {
    const next = !row.done;
    const previous = rows;
    setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, done: next } : r)));

    const { error } = await createClient()
      .from("action_items")
      .update({ done: next })
      .eq("id", row.id);

    if (error) {
      setRows(previous);
      toast.error("Could not update that.");
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CircleCheckBig}
        title="Nothing to follow up"
        description={[
          "Approve a meeting report and the follow-ups you ticked will land here.",
          nextStep?.note,
        ]
          .filter(Boolean)
          .join(" ")}
        action={
          nextStep && (
            <Button asChild variant="outline">
              <Link href={nextStep.href}>
                {nextStep.label}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          )
        }
      />
    );
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-2">
        <Select value={company} onValueChange={setCompany}>
          <SelectTrigger className="w-44" aria-label="Filter by company">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All companies</SelectItem>
            {companies.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="w-44" aria-label="Filter by assignee">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            {assignees.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-8">
        {grouped.map(({ bucket, rows: bucketRows }) => (
          <section key={bucket}>
            <h2
              className={cn(
                "mb-3 font-display text-2xl",
                bucket === "Overdue" && "text-danger",
              )}
            >
              {bucket}
              <span className="ml-2 text-sm font-sans text-muted-foreground">
                {bucketRows.length}
              </span>
            </h2>

            <div className="space-y-2">
              {bucketRows.map((row) => {
                const due = dueLabel(row.due_date);
                return (
                  <Card key={row.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={row.done}
                        onCheckedChange={() => toggle(row)}
                        aria-label={`Mark done: ${row.title}`}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm", row.done && "line-through opacity-60")}>
                          {row.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[row.assignee_name, row.company_name]
                            .filter(Boolean)
                            .join(" · ")}
                          {row.meeting_id && row.meeting_title && (
                            <>
                              {row.assignee_name || row.company_name ? " · " : ""}
                              <Link
                                href={`/meetings/${row.meeting_id}`}
                                className="hover:underline"
                              >
                                {row.meeting_title}
                              </Link>
                            </>
                          )}
                        </p>
                      </div>
                      {!row.done && (
                        <span
                          className={cn(
                            "shrink-0 text-xs",
                            due.tone === "danger" && "text-danger",
                            due.tone === "warn" && "text-on-butter",
                            due.tone === "muted" && "text-muted-foreground",
                          )}
                        >
                          {due.text}
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
