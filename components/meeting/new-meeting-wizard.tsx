"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UploadDropzone, type PickedFile } from "@/components/meeting/upload-dropzone";
import {
  ParticipantsField,
  newParticipant,
  type KnownPerson,
  type ParticipantDraft,
} from "@/components/meeting/participants-field";
import { ProcessingSteps } from "@/components/meeting/processing-steps";
import { createClient } from "@/lib/supabase/client";
import { AUDIO_BUCKET, CONSENT_SCRIPT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { MeetingStatus } from "@/lib/types";

interface CompanyOption {
  id: string;
  name: string;
}

const STEP_LABELS = ["Upload", "Details", "Consent"];

export function NewMeetingWizard({
  companies,
  people,
  myName,
}: {
  companies: CompanyOption[];
  people: KnownPerson[];
  myName: string;
}) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<PickedFile | null>(null);

  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [newCompanyName, setNewCompanyName] = useState("");
  const [companyOpen, setCompanyOpen] = useState(false);
  const [shortNote, setShortNote] = useState("");
  const [participants, setParticipants] = useState<ParticipantDraft[]>([
    newParticipant({ display_name: myName, is_me: true }),
    newParticipant(),
  ]);
  const [consent, setConsent] = useState(false);

  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [meetingId, setMeetingId] = useState<string | null>(null);
  const [status, setStatus] = useState<MeetingStatus>("uploaded");
  const [progressNote, setProgressNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState({ done: 0, total: 0 });
  const cancelled = useRef(false);

  const selectedCompanyLabel =
    companies.find((c) => c.id === companyId)?.name || newCompanyName || "";

  const canContinue =
    step === 0
      ? Boolean(picked)
      : step === 1
        ? title.trim().length > 0 &&
          participants.some((p) => p.display_name.trim().length > 0)
        : consent;

  /**
   * Drives the whole pipeline from the browser.
   *
   * The resume loop is the part worth understanding: a long recording is split
   * server-side, and /process returns {complete:false} when it runs out of
   * function time rather than failing. Calling it again picks up the chunks
   * that are still pending, so a 90-minute meeting finishes across however
   * many invocations it needs without a queue or a background worker.
   */
  async function submit() {
    if (!picked) return;
    setBusy(true);
    setError(null);

    // Which stage we are in, so a failure says where rather than just what.
    // "The string did not match the expected pattern" is a real message a
    // browser can throw here, and on its own it points at nothing.
    let step = "creating the meeting";

    try {
      // 1. create the row and get a signed upload URL
      const createRes = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          short_note: shortNote.trim() || null,
          meeting_date: meetingDate,
          company_id: companyId,
          new_company_name: companyId ? null : newCompanyName.trim() || null,
          consent_confirmed: true,
          filename: picked.file.name,
          size: picked.file.size,
          mime: picked.file.type || null,
          participants: participants
            .filter((p) => p.display_name.trim())
            .map((p) => ({
              display_name: p.display_name.trim(),
              position: p.position.trim() || null,
              is_me: p.is_me,
              person_id: p.person_id,
            })),
        }),
      });

      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error ?? "Could not create the meeting.");

      if (!created.path || !created.token) {
        throw new Error(
          `The server did not return an upload URL (path: ${created.path ? "ok" : "missing"}, token: ${created.token ? "ok" : "missing"}). Check the Supabase storage policies.`,
        );
      }

      setMeetingId(created.id);
      setStep(3);
      setUploading(true);

      // 2. straight to Storage — never through an API route (spec 3.1)
      step = "uploading to storage";
      const { error: uploadError } = await createClient()
        .storage.from(AUDIO_BUCKET)
        .uploadToSignedUrl(created.path, created.token, picked.file, {
          contentType: picked.file.type || "audio/mpeg",
        });

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);
      setUploading(false);
      step = "transcribing";

      // 3. transcribe, resuming until every chunk is done
      void pollStatus(created.id);

      for (let attempt = 0; attempt < 12; attempt++) {
        if (cancelled.current) return;

        const res = await fetch(`/api/meetings/${created.id}/process`, {
          method: "POST",
        });
        const body = await res.json();

        if (!res.ok) throw new Error(body.error ?? "Processing failed.");
        if (body.complete) break;

        setChunks({ done: body.done ?? 0, total: body.total ?? 0 });
        if (attempt === 11) {
          throw new Error(
            "This recording is taking more attempts than expected. Open it from the dashboard and press Retry.",
          );
        }
      }

      if (!cancelled.current) {
        router.push(`/meetings/${created.id}/speakers`);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "Error";
      const message = `While ${step}: ${raw}${name && name !== "Error" ? ` (${name})` : ""}`;
      // the stack is the only thing that identifies a throw from inside a
      // dependency, and it never reaches a server log from the browser
      console.error("[new meeting] failed while", step, err);
      setError(message);
      setStatus("failed");
      toast.error(message);
    } finally {
      setBusy(false);
      setUploading(false);
    }
  }

  /** Polls only to keep the step list honest; the loop above drives the work. */
  async function pollStatus(id: string) {
    while (!cancelled.current) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`/api/meetings/${id}/status`);
        if (!res.ok) continue;
        const body = await res.json();
        setStatus(body.status);
        setProgressNote(body.progress_note);
        setChunks(body.chunks ?? { done: 0, total: 0 });
        if (["awaiting_speakers", "review", "ready", "failed"].includes(body.status)) {
          if (body.status === "failed") setError(body.error);
          return;
        }
      } catch {
        // a dropped poll is not worth surfacing; the next one will land
      }
    }
  }

  // ---- processing screen ---------------------------------------------------
  if (step === 3) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-2 text-center font-display text-3xl">
          {status === "failed" ? "Something went wrong" : "Working on it"}
        </h1>
        <p className="mb-8 text-center text-sm text-muted-foreground">
          {status === "failed"
            ? "Nothing was lost — you can retry from the meeting page."
            : "This usually takes two to four minutes."}
        </p>

        <ProcessingSteps
          status={status}
          uploading={uploading}
          progressNote={progressNote}
          error={error}
          chunks={chunks}
        />

        {status === "failed" && meetingId && (
          <div className="mt-6 flex justify-center gap-2">
            <Button variant="outline" onClick={() => router.push("/dashboard")}>
              Back to dashboard
            </Button>
            <Button onClick={() => router.push(`/meetings/${meetingId}`)}>
              Open meeting
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ---- wizard --------------------------------------------------------------
  return (
    <div className="mx-auto max-w-2xl">
      <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
        {STEP_LABELS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                i < step && "bg-success-solid text-white",
                i === step && "bg-primary text-primary-foreground",
                i > step && "border text-muted-foreground",
              )}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                i === step ? "font-medium" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
            {i < STEP_LABELS.length - 1 && <span className="h-px flex-1 bg-border" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section>
          <h2 className="mb-1 font-display text-2xl">Add the recording</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Audio only. Long recordings are fine — they get split up and
            transcribed in parallel.
          </p>
          <UploadDropzone value={picked} onChange={setPicked} />
        </section>
      )}

      {step === 1 && (
        <section className="space-y-6">
          <div>
            <h2 className="mb-1 font-display text-2xl">What was this?</h2>
            <p className="text-sm text-muted-foreground">
              The names you give here are how the report spells them, even when
              the transcript gets them wrong.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="title">Meeting title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Partnership call with Northpeak"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Date</Label>
              <Input
                id="date"
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Company</Label>
            <Popover open={companyOpen} onOpenChange={setCompanyOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  className="w-full justify-between font-normal"
                >
                  {selectedCompanyLabel || "Choose or type a new one"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput
                    placeholder="Search or type a new name…"
                    value={newCompanyName}
                    onValueChange={(v) => {
                      setNewCompanyName(v);
                      setCompanyId(null);
                    }}
                  />
                  <CommandList>
                    <CommandEmpty>
                      {newCompanyName ? (
                        <button
                          type="button"
                          className="w-full px-2 py-1.5 text-left text-sm"
                          onClick={() => setCompanyOpen(false)}
                        >
                          Create <strong>{newCompanyName}</strong>
                        </button>
                      ) : (
                        "No companies yet."
                      )}
                    </CommandEmpty>
                    <CommandGroup>
                      {companies.map((c) => (
                        <CommandItem
                          key={c.id}
                          value={c.name}
                          onSelect={() => {
                            setCompanyId(c.id);
                            setNewCompanyName("");
                            setCompanyOpen(false);
                          }}
                        >
                          {c.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="note">Anything the AI should know?</Label>
            <Textarea
              id="note"
              value={shortNote}
              maxLength={280}
              rows={3}
              onChange={(e) => setShortNote(e.target.value)}
              placeholder="e.g. second call, they were unhappy about pricing last time"
            />
            <p className="text-xs text-muted-foreground">
              {shortNote.length}/280
            </p>
          </div>

          <div className="space-y-2">
            <Label>Who was there?</Label>
            <ParticipantsField
              value={participants}
              onChange={setParticipants}
              knownPeople={people}
            />
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-6">
          <div>
            <h2 className="mb-1 font-display text-2xl">Consent</h2>
            <p className="text-sm text-muted-foreground">
              One box, every time. This is the thing that makes recording
              normal rather than awkward.
            </p>
          </div>

          <Card className="p-5">
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={consent}
                onCheckedChange={(v) => setConsent(v === true)}
                className="mt-0.5"
              />
              <span className="text-sm">
                Everyone in this recording knew it was being recorded.
              </span>
            </label>
          </Card>

          <Card className="border-butter-strong bg-butter-soft p-5 dark:bg-butter">
            <p className="text-sm font-medium text-on-butter">
              Need a line for next time?
            </p>
            <p className="mt-2 text-sm text-on-butter/90">“{CONSENT_SCRIPT}”</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                void navigator.clipboard.writeText(CONSENT_SCRIPT);
                toast.success("Copied.");
              }}
            >
              <Copy className="size-3.5" />
              Copy
            </Button>
            <p className="mt-4 text-xs text-on-butter/80">
              In Singapore, recording a conversation you are part of is
              generally lawful, but storing what people say about themselves
              brings the PDPA into play. Tell people, and keep it to what you
              need. This is not legal advice.
            </p>
          </Card>
        </section>
      )}

      <div className="mt-8 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0 || busy}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>

        {step < 2 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue}>
            Continue
            <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button
            onClick={submit}
            disabled={!canContinue || busy}
            className="bg-success-solid text-white hover:bg-success-solid-hover"
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            Process meeting
          </Button>
        )}
      </div>
    </div>
  );
}
