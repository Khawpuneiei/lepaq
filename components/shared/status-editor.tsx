"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import type { StatusOption, StatusScope } from "@/lib/types";

const PRESET_COLORS = [
  "#64748B",
  "#0EA5E9",
  "#1E3A8A",
  "#E8D48B",
  "#10B981",
  "#F97316",
  "#DC2626",
];

/**
 * Rename, recolour, reorder, add, delete — for both lists (spec 7.9).
 * The pipeline board reads the same rows, so a change here moves the columns.
 *
 * Deleting a status nulls it on any company or person using it (the FK is
 * ON DELETE SET NULL) rather than blocking, so the user is never stuck with a
 * label they have outgrown.
 */
export function StatusEditor({
  scope,
  title,
  description,
  initial,
  ownerId,
}: {
  scope: StatusScope;
  title: string;
  description: string;
  initial: StatusOption[];
  ownerId: string;
}) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const supabase = createClient();

  async function rename(id: string, label: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, label } : r)));
    await supabase.from("status_options").update({ label }).eq("id", id);
  }

  async function recolour(id: string, color: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, color } : r)));
    const { error } = await supabase
      .from("status_options")
      .update({ color })
      .eq("id", id);
    if (error) toast.error("Could not change that colour.");
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;

    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    const reordered = next.map((r, i) => ({ ...r, sort_order: i + 1 }));
    setRows(reordered);

    await Promise.all(
      reordered.map((r) =>
        supabase.from("status_options").update({ sort_order: r.sort_order }).eq("id", r.id),
      ),
    );
  }

  async function add() {
    setBusy(true);
    const { data, error } = await supabase
      .from("status_options")
      .insert({
        owner_id: ownerId,
        applies_to: scope,
        label: "New status",
        color: PRESET_COLORS[rows.length % PRESET_COLORS.length],
        sort_order: rows.length + 1,
      })
      .select("*")
      .single();
    setBusy(false);

    if (error || !data) {
      toast.error("Could not add a status.");
      return;
    }
    setRows((rs) => [...rs, data as StatusOption]);
  }

  async function remove(id: string) {
    const previous = rows;
    setRows((rs) => rs.filter((r) => r.id !== id));
    const { error } = await supabase.from("status_options").delete().eq("id", id);
    if (error) {
      setRows(previous);
      toast.error("Could not delete that status.");
    }
  }

  return (
    <Card className="p-5">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>

      <div className="mt-4 space-y-2">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-2">
            <div className="flex flex-col">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0}
                aria-label={`Move ${row.label} up`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ChevronUp className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === rows.length - 1}
                aria-label={`Move ${row.label} down`}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
              >
                <ChevronDown className="size-3" />
              </button>
            </div>

            <input
              type="color"
              value={row.color}
              onChange={(e) => recolour(row.id, e.target.value)}
              aria-label={`Colour for ${row.label}`}
              className="size-8 shrink-0 cursor-pointer rounded border bg-transparent"
            />

            <Input
              value={row.label}
              onChange={(e) =>
                setRows((rs) =>
                  rs.map((r) => (r.id === row.id ? { ...r, label: e.target.value } : r)),
                )
              }
              onBlur={(e) => rename(row.id, e.target.value)}
              aria-label="Status label"
            />

            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${row.label}`}
              onClick={() => remove(row.id)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" className="mt-4" onClick={add} disabled={busy}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
        Add status
      </Button>
    </Card>
  );
}
