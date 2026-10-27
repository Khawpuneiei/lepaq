"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readJson } from "@/lib/http";

const INCLUDED = [
  "Title and date",
  "The summary you approved",
  "Key takeaways and decisions",
  "Follow-ups you ticked",
];

const EXCLUDED = [
  "The recording",
  "The transcript",
  "Emotion reads and engagement",
  "Personal facts you saved",
  "Everything in the Coach tab",
];

export function ShareDialog({
  open,
  onOpenChange,
  meetingId,
  token,
  onTokenChange,
  appUrl,
  approved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meetingId: string;
  token: string | null;
  onTokenChange: (token: string | null) => void;
  appUrl: string;
  approved: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const url = token ? `${appUrl}/s/${token}` : "";

  async function create() {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/share`, { method: "POST" });
      const body = await readJson(res);
      if (!res.ok) throw new Error(body.error);
      onTokenChange(body.token);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the link.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}/share`, { method: "DELETE" });
      if (!res.ok) throw new Error((await readJson(res)).error);
      onTokenChange(null);
      toast.success("Link revoked. It stops working immediately.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke the link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share the summary</DialogTitle>
          <DialogDescription>
            A read-only page. Anyone with the link can open it, so send it the
            way you would send an email.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-on-success-soft">
              They see
            </p>
            <ul className="mt-2 space-y-1">
              {INCLUDED.map((x) => (
                <li key={x} className="flex gap-2 text-sm">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
                  {x}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Never included
            </p>
            <ul className="mt-2 space-y-1">
              {EXCLUDED.map((x) => (
                <li key={x} className="text-sm text-muted-foreground">
                  {x}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {!approved && (
          <p className="rounded-md border border-butter-strong bg-butter-soft p-3 text-sm text-on-butter dark:bg-butter">
            Approve the report first. Only text you have read and edited can
            leave your account.
          </p>
        )}

        {token && (
          <div className="flex gap-2">
            <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy link"
              onClick={() => {
                void navigator.clipboard.writeText(url);
                toast.success("Link copied.");
              }}
            >
              <Copy className="size-4" />
            </Button>
            <Button variant="outline" size="icon" aria-label="Open link" asChild>
              <a href={url} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" />
              </a>
            </Button>
          </div>
        )}

        <DialogFooter>
          {token ? (
            <Button variant="outline" onClick={revoke} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Revoke link
            </Button>
          ) : (
            <Button onClick={create} disabled={busy || !approved}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Create link
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
