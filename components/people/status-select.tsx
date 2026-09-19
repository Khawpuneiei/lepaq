"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import type { StatusOption } from "@/lib/types";

const NONE = "__none__";

/** Shared by person and company profiles; the table name is the only difference. */
export function StatusSelect({
  table,
  rowId,
  statusId,
  options,
}: {
  table: "people" | "companies";
  rowId: string;
  statusId: string | null;
  options: StatusOption[];
}) {
  const [value, setValue] = useState(statusId ?? NONE);

  async function update(next: string) {
    const previous = value;
    setValue(next);

    const { error } = await createClient()
      .from(table)
      .update({ status_id: next === NONE ? null : next })
      .eq("id", rowId);

    if (error) {
      setValue(previous);
      toast.error("Could not change the status.");
    }
  }

  return (
    <Select value={value} onValueChange={update}>
      <SelectTrigger className="w-48" aria-label="Status">
        <SelectValue placeholder="No status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No status</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            <span className="flex items-center gap-2">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: o.color }}
                aria-hidden
              />
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
