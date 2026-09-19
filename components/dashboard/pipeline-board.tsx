"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";

import { Card } from "@/components/ui/card";
import { SentimentDot } from "@/components/shared/chips";
import { createClient } from "@/lib/supabase/client";
import { cn, formatMoney, formatShortDate } from "@/lib/utils";
import type { Sentiment, StatusOption } from "@/lib/types";

export interface BoardCompany {
  id: string;
  name: string;
  deal_value: number | null;
  status_id: string | null;
  last_meeting_date: string | null;
  sentiment: Sentiment | null;
}

function CompanyCard({ company }: { company: BoardCompany }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: company.id,
  });

  const money = formatMoney(company.deal_value);

  return (
    <div
      ref={setNodeRef}
      style={
        transform
          ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
          : undefined
      }
      className={cn(
        "rounded-md border bg-card p-3 shadow-card",
        isDragging && "opacity-60 ring-2 ring-primary",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-0.5 cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label={`Move ${company.name}`}
          {...listeners}
          {...attributes}
        >
          <GripVertical className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <Link
            href={`/companies/${company.id}`}
            className="block truncate text-sm font-medium hover:underline"
          >
            {company.name}
          </Link>
          <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <SentimentDot sentiment={company.sentiment} />
            {money && <span>{money}</span>}
            {company.last_meeting_date && (
              <span>{formatShortDate(company.last_meeting_date)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({
  status,
  companies,
}: {
  status: StatusOption;
  companies: BoardCompany[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg border bg-muted/40 p-3 transition-colors duration-150",
        isOver && "border-primary bg-primary/5",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: status.color }}
            aria-hidden
          />
          {status.label}
        </span>
        <span className="text-xs text-muted-foreground">{companies.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {companies.map((c) => (
          <CompanyCard key={c.id} company={c} />
        ))}
        {companies.length === 0 && (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing here
          </p>
        )}
      </div>
    </div>
  );
}

export function PipelineBoard({
  statuses,
  companies: initial,
}: {
  statuses: StatusOption[];
  companies: BoardCompany[];
}) {
  const [companies, setCompanies] = useState(initial);
  const sensors = useSensors(
    // a small threshold so a click on the card link is not read as a drag
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const byStatus = useMemo(() => {
    const map = new Map<string, BoardCompany[]>();
    for (const s of statuses) map.set(s.id, []);
    for (const c of companies) {
      if (c.status_id && map.has(c.status_id)) map.get(c.status_id)!.push(c);
    }
    return map;
  }, [statuses, companies]);

  const unassigned = companies.filter(
    (c) => !c.status_id || !statuses.some((s) => s.id === c.status_id),
  );

  async function onDragEnd(event: DragEndEvent) {
    const companyId = String(event.active.id);
    const statusId = event.over ? String(event.over.id) : null;
    if (!statusId) return;

    const previous = companies;
    setCompanies((cs) =>
      cs.map((c) => (c.id === companyId ? { ...c, status_id: statusId } : c)),
    );

    const { error } = await createClient()
      .from("companies")
      .update({ status_id: statusId })
      .eq("id", companyId);

    if (error) {
      setCompanies(previous);
      toast.error("Could not move that company.", { description: error.message });
    }
  }

  if (statuses.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        No company statuses yet. Add some in Settings and the board will follow.
      </Card>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {statuses.map((s) => (
          <Column key={s.id} status={s} companies={byStatus.get(s.id) ?? []} />
        ))}
        {unassigned.length > 0 && (
          <div className="flex w-64 shrink-0 flex-col rounded-lg border border-dashed p-3">
            <p className="mb-3 text-sm font-medium text-muted-foreground">No status</p>
            <div className="flex flex-col gap-2">
              {unassigned.map((c) => (
                <CompanyCard key={c.id} company={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </DndContext>
  );
}
