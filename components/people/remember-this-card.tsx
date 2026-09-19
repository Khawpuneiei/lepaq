"use client";

import { useState } from "react";
import {
  Heart,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
  User,
  Utensils,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { FACT_CATEGORY_LABEL, FACT_GROUPS } from "@/lib/constants";
import type { FactCategory, PersonFact } from "@/lib/types";

const ICONS = {
  utensils: Utensils,
  heart: Heart,
  "message-circle": MessageCircle,
  user: User,
} as const;

/**
 * The thing users open two minutes before a call, so it is the first card on
 * the profile (spec 7.6). Only approved facts appear here — that rule is the
 * whole reason the AI is allowed to guess at all.
 */
export function RememberThisCard({
  personId,
  personName,
  facts: initial,
}: {
  personId: string;
  personName: string;
  facts: PersonFact[];
}) {
  const [facts, setFacts] = useState(initial);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FactCategory>("food_like");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function addFact() {
    if (!text.trim()) return;
    setBusy(true);

    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const { data, error } = await supabase
      .from("person_facts")
      .insert({
        owner_id: auth.user.id,
        person_id: personId,
        category,
        fact: text.trim(),
        // typed by a human, so it needs no approval step
        approved: true,
      })
      .select("*")
      .single();

    setBusy(false);

    if (error || !data) {
      toast.error("Could not save that.");
      return;
    }

    setFacts((f) => [...f, data as PersonFact]);
    setText("");
    setOpen(false);
    toast.success("Saved.");
  }

  async function remove(id: string) {
    const previous = facts;
    setFacts((f) => f.filter((x) => x.id !== id));
    const { error } = await createClient().from("person_facts").delete().eq("id", id);
    if (error) {
      setFacts(previous);
      toast.error("Could not delete that.");
    }
  }

  const grouped = FACT_GROUPS.map((group) => ({
    ...group,
    facts: facts.filter((f) => group.categories.includes(f.category)),
  })).filter((g) => g.facts.length > 0);

  return (
    <div className="rounded-lg border border-butter-strong bg-butter-soft p-6 dark:bg-butter">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-2xl text-on-butter">
          <Sparkles className="size-4" aria-hidden />
          Remember this
        </h2>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <Plus className="size-3.5" />
              Add
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add something about {personName}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fact-category">Kind</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as FactCategory)}
                >
                  <SelectTrigger id="fact-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FACT_CATEGORY_LABEL).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fact-text">What should you remember?</Label>
                <Input
                  id="fact-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Prefers WhatsApp to email"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={addFact} disabled={busy || !text.trim()}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {grouped.length === 0 ? (
        <p className="mt-4 text-sm text-on-butter/80">
          Nothing saved yet. Approve a fact from a meeting, or add one yourself.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {grouped.map((group) => {
            const Icon = ICONS[group.icon as keyof typeof ICONS] ?? User;
            return (
              <section key={group.key}>
                <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-on-butter/70">
                  <Icon className="size-3.5" aria-hidden />
                  {group.label}
                </h3>
                <ul className="mt-2 space-y-1.5">
                  {group.facts.map((fact) => (
                    <li key={fact.id} className="group flex items-start gap-2">
                      <span className="flex-1 text-sm leading-relaxed text-on-butter">
                        {fact.fact}
                      </span>
                      <button
                        type="button"
                        onClick={() => remove(fact.id)}
                        aria-label={`Forget: ${fact.fact}`}
                        className="rounded p-1 text-on-butter/50 opacity-0 transition-opacity hover:text-on-butter group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
