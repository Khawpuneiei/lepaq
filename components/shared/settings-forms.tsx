"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";

export function ProfileForm({
  userId,
  fullName: initialName,
  jobTitle: initialTitle,
}: {
  userId: string;
  fullName: string;
  jobTitle: string;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [jobTitle, setJobTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const { error } = await createClient()
      .from("profiles")
      .update({ full_name: fullName, job_title: jobTitle })
      .eq("id", userId);
    setBusy(false);

    if (error) toast.error("Could not save.");
    else toast.success("Saved.");
  }

  return (
    <Card className="p-5">
      <h3 className="font-medium">Profile</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="full-name">Your name</Label>
          <Input
            id="full-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Pre-fills the &ldquo;this is me&rdquo; participant on every upload.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="job-title">Job title</Label>
          <Input
            id="job-title"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Partnerships Manager"
          />
        </div>
      </div>
      <Button className="mt-4" onClick={save} disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        Save
      </Button>
    </Card>
  );
}

export function PrivacyForm({
  userId,
  deleteAudio: initial,
}: {
  userId: string;
  deleteAudio: boolean;
}) {
  const [deleteAudio, setDeleteAudio] = useState(initial);

  async function toggle(value: boolean) {
    setDeleteAudio(value);
    const { error } = await createClient()
      .from("profiles")
      .update({ delete_audio_after_processing: value })
      .eq("id", userId);
    if (error) {
      setDeleteAudio(!value);
      toast.error("Could not change that setting.");
    }
  }

  return (
    <Card className="p-5">
      <h3 className="font-medium">Privacy</h3>

      <div className="mt-4 flex items-start justify-between gap-6">
        <div>
          <Label htmlFor="delete-audio" className="text-sm font-normal">
            Delete audio after processing
          </Label>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            On by default. Once the transcript exists the recording is not
            needed, and nobody can replay a conversation that no longer exists.
            Turning this off means the audio stays in storage until you delete
            it yourself.
          </p>
        </div>
        <Switch id="delete-audio" checked={deleteAudio} onCheckedChange={toggle} />
      </div>

      <ul className="mt-6 space-y-1.5 border-t pt-4 text-sm text-muted-foreground">
        <li>There is no team view. Nobody else can see your account.</li>
        <li>Transcripts and coach notes are never shareable, by design.</li>
        <li>A share link contains only the summary you approved, and is revocable.</li>
      </ul>
    </Card>
  );
}

export function DangerZone({ userId }: { userId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function deleteEverything() {
    setBusy(true);
    const supabase = createClient();

    // Every table cascades from these two, and storage objects are removed by
    // the audio deletes already done during processing.
    const { error } = await supabase.from("meetings").delete().eq("owner_id", userId);
    if (!error) {
      await supabase.from("people").delete().eq("owner_id", userId);
      await supabase.from("companies").delete().eq("owner_id", userId);
      await supabase.from("person_facts").delete().eq("owner_id", userId);
    }

    setBusy(false);
    setOpen(false);

    if (error) {
      toast.error("Could not delete everything.");
      return;
    }

    toast.success("All your data has been deleted.");
    router.refresh();
  }

  return (
    <Card className="border-danger/40 p-5">
      <h3 className="font-medium text-danger">Delete all my data</h3>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        Removes every meeting, transcript, report, person, company and saved
        fact in this account. Your login stays. This cannot be undone.
      </p>
      <Button variant="destructive" className="mt-4" onClick={() => setOpen(true)}>
        Delete everything
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all your data?</DialogTitle>
            <DialogDescription>
              Type DELETE to confirm. Everything except your login is removed,
              permanently.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
            aria-label="Type DELETE to confirm"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText !== "DELETE" || busy}
              onClick={deleteEverything}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
