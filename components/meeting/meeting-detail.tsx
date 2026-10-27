"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DraftBadge, PrivateBadge, StatusChip } from "@/components/shared/chips";
import { ReportTab } from "@/components/meeting/report-tab";
import { FollowUpsTab, type EditableActionItem } from "@/components/meeting/follow-ups-tab";
import { PeopleTab, type EditableFact } from "@/components/meeting/people-tab";
import { CoachPanel } from "@/components/meeting/coach-panel";
import { TranscriptTab } from "@/components/meeting/transcript-tab";
import { ShareDialog } from "@/components/meeting/share-dialog";
import { createClient } from "@/lib/supabase/client";
import { formatDate, initials } from "@/lib/utils";
import type {
  ActionItem,
  Coach,
  Meeting,
  MeetingParticipant,
  MeetingReport,
  ParticipantRead,
  PersonFact,
  TranscriptSegment,
} from "@/lib/types";

export function MeetingDetail({
  meeting: initialMeeting,
  report,
  participants,
  actionItems: initialActionItems,
  facts: initialFacts,
  reads,
  segments,
  company,
  appUrl,
  initialTab = "report",
}: {
  meeting: Meeting;
  report: MeetingReport | null;
  participants: MeetingParticipant[];
  actionItems: ActionItem[];
  facts: PersonFact[];
  reads: ParticipantRead[];
  segments: TranscriptSegment[];
  company: { id: string; name: string; status_label: string | null; status_color: string | null } | null;
  appUrl: string;
  /** Which tab opens first. The /demo walkthrough uses it to show each tab. */
  initialTab?: "report" | "follow-ups" | "people" | "coach" | "transcript";
}) {
  const router = useRouter();
  const [meeting, setMeeting] = useState(initialMeeting);
  const [tab, setTab] = useState<string>(initialTab);

  const approved = meeting.status === "ready";
  const editable = meeting.status === "review" || meeting.status === "ready";

  const [summary, setSummary] = useState(report?.summary ?? "");
  const [email, setEmail] = useState(report?.follow_up_email ?? "");
  const [applyStatus, setApplyStatus] = useState(false);

  const [items, setItems] = useState<EditableActionItem[]>(
    initialActionItems.map((a) => ({
      ...a,
      // on a fresh draft everything starts ticked; the user unticks the noise
      checked: a.approved || meeting.status === "review",
    })),
  );

  const [facts, setFacts] = useState<EditableFact[]>(
    initialFacts.map((f) => ({
      ...f,
      decision: f.approved ? "approved" : "pending",
    })),
  );

  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<"audio" | "meeting" | null>(null);
  const [retrying, setRetrying] = useState(false);

  // While the meeting is still being worked on, ask how it is going. For a
  // GPU job this poll is also what notices a lost callback (see /status).
  const inProgress = ["uploaded", "transcribing", "analyzing"].includes(meeting.status);
  useEffect(() => {
    if (!inProgress) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch(`/api/meetings/${meeting.id}/status`);
        if (res.ok && !stopped) {
          const body = await res.json();
          setMeeting((m) => ({
            ...m,
            status: body.status,
            progress_note: body.progress_note,
            error: body.error,
          }));
          // the transcript and report are server props, so fetch them now
          if (!["uploaded", "transcribing", "analyzing"].includes(body.status)) {
            router.refresh();
            return;
          }
        }
      } catch {
        // a dropped poll is not worth surfacing; the next one will land
      }
      if (!stopped) timer = setTimeout(poll, 15_000);
    };
    timer = setTimeout(poll, 5_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [inProgress, meeting.id, router]);

  /**
   * Retry from a failed state. A GPU job comes back at once as queued and the
   * poll above takes it from there; the chunked path is resumed here, the
   * same way the new-meeting screen does it.
   */
  async function retry() {
    setRetrying(true);
    setMeeting((m) => ({ ...m, status: "transcribing", error: null, progress_note: "Retrying" }));
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        const res = await fetch(`/api/meetings/${meeting.id}/process`, { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Retry failed.");
        if (body.complete) {
          setMeeting((m) => ({ ...m, status: "awaiting_speakers", progress_note: null }));
          router.refresh();
          return;
        }
        if (body.queued) {
          toast.success("Sent for transcription.");
          return;
        }
        setMeeting((m) => ({
          ...m,
          progress_note: `Transcribed ${body.done ?? 0} of ${body.total ?? 0} parts`,
        }));
      }
      throw new Error("This recording is taking more attempts than expected. Press Retry again.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Retry failed.";
      setMeeting((m) => ({ ...m, status: "failed", error: message, progress_note: null }));
      toast.error(message);
    } finally {
      setRetrying(false);
    }
  }

  function jumpToEvidence(idx: number) {
    setTab("transcript");
    // wait for the tab content to mount before scrolling to the line
    requestAnimationFrame(() => {
      const el = document.getElementById(`segment-${idx}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (el) window.location.hash = `segment-${idx}`;
    });
  }

  async function approve() {
    setSaving(true);
    try {
      // persist assignee and due-date edits before flipping the approval bit
      await Promise.all(
        items
          .filter((i) => {
            const original = initialActionItems.find((o) => o.id === i.id);
            return (
              original &&
              (original.assignee_name !== i.assignee_name ||
                original.due_date !== i.due_date)
            );
          })
          .map((i) =>
            createClient()
              .from("action_items")
              .update({ assignee_name: i.assignee_name, due_date: i.due_date })
              .eq("id", i.id),
          ),
      );

      const res = await fetch(`/api/meetings/${meeting.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summary,
          follow_up_email: email,
          action_item_ids: items.filter((i) => i.checked).map((i) => i.id),
          fact_ids: facts.filter((f) => f.decision === "approved").map((f) => f.id),
          apply_company_status: applyStatus,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error);

      setMeeting((m) => ({ ...m, status: "ready" }));
      toast.success("Approved.", {
        description: "Follow-ups are on your list and approved facts are on their profiles.",
      });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not approve.");
    } finally {
      setSaving(false);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/meetings/${meeting.id}/regenerate`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      toast.success("Report rewritten.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not regenerate.");
    } finally {
      setRegenerating(false);
    }
  }

  async function deleteAudio() {
    const res = await fetch(`/api/meetings/${meeting.id}/audio`, { method: "DELETE" });
    if (res.ok) {
      setMeeting((m) => ({ ...m, audio_deleted_at: new Date().toISOString() }));
      toast.success("Recording deleted. The transcript and report are untouched.");
    } else {
      toast.error("Could not delete the recording.");
    }
    setConfirmDelete(null);
  }

  async function deleteMeeting() {
    const { error } = await createClient().from("meetings").delete().eq("id", meeting.id);
    if (error) {
      toast.error("Could not delete the meeting.");
      return;
    }
    toast.success("Meeting deleted.");
    router.push("/meetings");
  }

  const coach = (report?.coach ?? null) as Coach | null;
  const personIdByName = Object.fromEntries(
    participants
      .filter((p) => p.person_id)
      .map((p) => [p.display_name, p.person_id!]),
  );

  return (
    <div className="mx-auto max-w-4xl pb-24">
      {/* ---- header -------------------------------------------------------- */}
      <div className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-display text-3xl leading-tight md:text-4xl">
              {meeting.title}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{formatDate(meeting.meeting_date)}</span>
              {company && (
                <>
                  <span aria-hidden>·</span>
                  <Link href={`/companies/${company.id}`} className="hover:underline">
                    {company.name}
                  </Link>
                  <StatusChip
                    label={company.status_label}
                    color={company.status_color}
                  />
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <PrivateBadge shared={Boolean(meeting.share_token)} />
            {!approved && report && <DraftBadge />}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setShareOpen(true)}>
                  <Share2 className="size-4" />
                  Share summary
                </DropdownMenuItem>
                <DropdownMenuItem onClick={regenerate} disabled={regenerating || !report}>
                  <RotateCcw className="size-4" />
                  Regenerate report
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setConfirmDelete("audio")}
                  disabled={!meeting.audio_path || Boolean(meeting.audio_deleted_at)}
                >
                  Delete audio
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmDelete("meeting")}
                >
                  <Trash2 className="size-4" />
                  Delete meeting
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {participants.map((p) => (
            <span key={p.id} className="flex items-center gap-1.5">
              <Avatar className="size-6">
                <AvatarFallback className="bg-muted text-[10px]">
                  {initials(p.display_name)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-muted-foreground">
                {p.display_name}
                {p.is_me ? " (you)" : ""}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* ---- states that are not a report ---------------------------------- */}
      {meeting.status === "failed" && (
        <Card className="mb-6 border-danger/40 bg-danger-soft p-5">
          <p className="flex items-center gap-2 font-medium text-on-danger-soft">
            <AlertTriangle className="size-4" aria-hidden />
            Processing failed
          </p>
          <p className="mt-2 text-sm text-on-danger-soft/90">
            {meeting.error ?? "Something went wrong."}
          </p>
          <Button className="mt-4" variant="outline" onClick={retry} disabled={retrying}>
            <RotateCcw className="size-4" />
            Retry
          </Button>
        </Card>
      )}

      {meeting.status === "awaiting_speakers" && (
        <Card className="mb-6 border-butter-strong bg-butter-soft p-5 dark:bg-butter">
          <p className="font-medium text-on-butter">Confirm the speakers</p>
          <p className="mt-1 text-sm text-on-butter/90">
            The transcript is ready. Tell it who is who and it will write the
            report.
          </p>
          <Button asChild className="mt-4">
            <Link href={`/meetings/${meeting.id}/speakers`}>Check speakers</Link>
          </Button>
        </Card>
      )}

      {["uploaded", "transcribing", "analyzing"].includes(meeting.status) && (
        <Card className="mb-6 p-5">
          <p className="flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Still working
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {meeting.progress_note ?? "This page will update when it is done."}
          </p>
        </Card>
      )}

      {/* ---- tabs ----------------------------------------------------------- */}
      {report && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="report">Report</TabsTrigger>
            <TabsTrigger value="follow-ups">
              Follow-ups {items.length > 0 && `(${items.length})`}
            </TabsTrigger>
            <TabsTrigger value="people">People</TabsTrigger>
            <TabsTrigger value="coach">Coach</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>

          <TabsContent value="report" className="mt-6">
            <ReportTab
              report={report}
              summary={summary}
              onSummaryChange={setSummary}
              onJump={jumpToEvidence}
              suggestedStatus={report.suggested_company_status}
              suggestedReason={report.suggested_status_reason}
              onApplyStatus={() => {
                setApplyStatus(true);
                toast.success("Will be applied when you approve the report.");
              }}
              statusApplied={applyStatus}
              editable={editable}
            />
          </TabsContent>

          <TabsContent value="follow-ups" className="mt-6">
            <FollowUpsTab
              items={items}
              onChange={setItems}
              email={email}
              onEmailChange={setEmail}
              meetingTitle={meeting.title}
              onJump={jumpToEvidence}
              editable={editable}
            />
          </TabsContent>

          <TabsContent value="people" className="mt-6">
            <PeopleTab
              reads={reads}
              facts={facts}
              onFactsChange={setFacts}
              personIdByName={personIdByName}
              editable={editable}
            />
          </TabsContent>

          <TabsContent value="coach" className="mt-6">
            <CoachPanel coach={coach} talkRatio={report.talk_ratio ?? []} />
          </TabsContent>

          <TabsContent value="transcript" className="mt-6">
            <TranscriptTab
              segments={segments}
              participants={participants.map((p) => ({
                id: p.id,
                display_name: p.display_name,
              }))}
              meetingId={meeting.id}
              onNeedsRegenerate={regenerate}
              editable={editable}
            />
          </TabsContent>
        </Tabs>
      )}

      {/* ---- sticky approve footer ------------------------------------------ */}
      {meeting.status === "review" && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 backdrop-blur">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {items.filter((i) => i.checked).length} follow-ups ·{" "}
              {facts.filter((f) => f.decision === "approved").length} facts to save
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => router.push("/dashboard")}>
                Save as draft
              </Button>
              <Button
                onClick={approve}
                disabled={saving}
                className="bg-brand text-on-brand hover:bg-brand-hover"
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Approve report
              </Button>
            </div>
          </div>
        </div>
      )}

      {regenerating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="flex items-center gap-3 rounded-lg border bg-card p-6 shadow-card">
            <Loader2 className="size-5 animate-spin" aria-hidden />
            <p className="text-sm">Rewriting the report…</p>
          </div>
        </div>
      )}

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        meetingId={meeting.id}
        token={meeting.share_token}
        onTokenChange={(token) => setMeeting((m) => ({ ...m, share_token: token }))}
        appUrl={appUrl}
        approved={approved}
      />

      <Dialog open={confirmDelete !== null} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmDelete === "audio" ? "Delete the recording?" : "Delete this meeting?"}
            </DialogTitle>
            <DialogDescription>
              {confirmDelete === "audio"
                ? "The transcript and report stay. The audio cannot be recovered, and the meeting cannot be transcribed again."
                : "The report, transcript, follow-ups and emotion reads for this meeting are all deleted. Approved facts on people profiles stay."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete === "audio" ? deleteAudio : deleteMeeting}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
