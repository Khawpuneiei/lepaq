"use client";

import { Copy, Mail, Quote } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import type { ActionItem } from "@/lib/types";

export interface EditableActionItem extends ActionItem {
  checked: boolean;
}

export function FollowUpsTab({
  items,
  onChange,
  email,
  onEmailChange,
  meetingTitle,
  onJump,
  editable,
}: {
  items: EditableActionItem[];
  onChange: (items: EditableActionItem[]) => void;
  email: string;
  onEmailChange: (value: string) => void;
  meetingTitle: string;
  onJump: (idx: number) => void;
  editable: boolean;
}) {
  function update(id: string, patch: Partial<EditableActionItem>) {
    onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  const mailto = `mailto:?subject=${encodeURIComponent(
    `Follow-up: ${meetingTitle}`,
  )}&body=${encodeURIComponent(email)}`;

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl">Follow-ups</h2>
          <p className="text-xs text-muted-foreground">
            Tick what is real. Only ticked items reach your Follow-ups list.
          </p>
        </div>

        {items.length === 0 ? (
          <EmptyState
            title="No follow-ups found"
            description="Nothing in this conversation sounded like a commitment."
          />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={item.checked}
                    disabled={!editable}
                    onCheckedChange={(v) => update(item.id, { checked: v === true })}
                    aria-label={`Approve: ${item.title}`}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-sm font-medium">{item.title}</p>
                      {item.evidence_idx != null && item.evidence_idx >= 0 && (
                        <button
                          type="button"
                          onClick={() => onJump(item.evidence_idx!)}
                          aria-label="Show the line this came from"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Quote className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <Input
                        value={item.assignee_name ?? ""}
                        placeholder="Who owns it?"
                        disabled={!editable}
                        onChange={(e) =>
                          update(item.id, { assignee_name: e.target.value || null })
                        }
                        aria-label="Assignee"
                      />
                      <Input
                        type="date"
                        value={item.due_date ?? ""}
                        disabled={!editable}
                        onChange={(e) =>
                          update(item.id, { due_date: e.target.value || null })
                        }
                        aria-label="Due date"
                      />
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl">Follow-up email</h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(email);
                toast.success("Email copied.");
              }}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
            {/* mailto, never a send — nothing leaves the account on its own */}
            <Button variant="outline" size="sm" asChild>
              <a href={mailto}>
                <Mail className="size-3.5" />
                Open in mail app
              </a>
            </Button>
          </div>
        </div>

        <Textarea
          value={email}
          rows={12}
          disabled={!editable}
          onChange={(e) => onEmailChange(e.target.value)}
          className="report-prose text-sm"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing is sent from here. Copy it, read it again, then send it
          yourself.
        </p>
      </section>
    </div>
  );
}
