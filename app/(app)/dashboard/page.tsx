import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, HeartHandshake, ListChecks, Mic } from "lucide-react";
import { differenceInCalendarDays, parseISO, subDays } from "date-fns";

import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/dashboard/stat-card";
import { PipelineBoard, type BoardCompany } from "@/components/dashboard/pipeline-board";
import { ReviewInbox } from "@/components/dashboard/review-inbox";
import { ActivityStrip, type ActivityItem } from "@/components/dashboard/activity-strip";
import { createClient } from "@/lib/supabase/server";
import { MINUTES_SAVED_PER_MEETING, SENTIMENT_SCORE } from "@/lib/constants";
import { greeting, pluralise } from "@/lib/utils";
import type { Sentiment, StatusOption } from "@/lib/types";

export const metadata = { title: "Dashboard · Lepaq" };

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = new Date();
  const weekAgo = subDays(today, 7).toISOString();

  const [
    { data: profile },
    { data: meetings },
    { data: actionItems },
    { data: statuses },
    { data: companies },
  ] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    supabase
      .from("meetings")
      .select("id, title, meeting_date, status, error, created_at, company_id")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("action_items")
      .select("id, title, due_date, done, approved, created_at")
      .eq("owner_id", user.id)
      .eq("approved", true),
    supabase
      .from("status_options")
      .select("*")
      .eq("owner_id", user.id)
      .eq("applies_to", "company")
      .order("sort_order", { ascending: true }),
    supabase
      .from("companies")
      .select("id, name, deal_value, status_id")
      .eq("owner_id", user.id),
  ]);

  const allMeetings = meetings ?? [];
  const meetingIds = allMeetings.map((m) => m.id);

  // Sentiment per meeting, used both for the board dots and for "warming".
  const { data: reads } = meetingIds.length
    ? await supabase
        .from("participant_reads")
        .select("person_id, sentiment, created_at, meeting_id")
        .in("meeting_id", meetingIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  // ---- stat 1: meetings captured this week --------------------------------
  const capturedThisWeek = allMeetings.filter((m) => m.created_at >= weekAgo).length;

  const capturedSeries = Array.from({ length: 7 }, (_, i) => {
    const day = subDays(today, 6 - i);
    return allMeetings.filter(
      (m) => differenceInCalendarDays(parseISO(m.created_at), day) === 0,
    ).length;
  });

  // ---- stat 2: follow-ups due ----------------------------------------------
  const open = (actionItems ?? []).filter((a) => !a.done);
  const overdue = open.filter(
    (a) => a.due_date && differenceInCalendarDays(parseISO(a.due_date), today) < 0,
  ).length;

  // ---- stat 3: hours of note-taking saved ----------------------------------
  const processed = allMeetings.filter((m) =>
    ["review", "ready"].includes(m.status),
  ).length;
  const hoursSaved = (processed * MINUTES_SAVED_PER_MEETING) / 60;

  // ---- stat 4: relationships warming ---------------------------------------
  // A person counts if their most recent read scores higher than the one before.
  const byPerson = new Map<string, Sentiment[]>();
  for (const r of reads ?? []) {
    if (!r.person_id || !r.sentiment) continue;
    const list = byPerson.get(r.person_id) ?? [];
    list.push(r.sentiment as Sentiment);
    byPerson.set(r.person_id, list);
  }
  let warming = 0;
  for (const list of byPerson.values()) {
    if (list.length < 2) continue;
    const last = SENTIMENT_SCORE[list[list.length - 1]];
    const prev = SENTIMENT_SCORE[list[list.length - 2]];
    if (last > prev) warming += 1;
  }

  // ---- pipeline board -------------------------------------------------------
  const lastMeetingByCompany = new Map<string, string>();
  const sentimentByCompany = new Map<string, Sentiment>();
  for (const m of [...allMeetings].reverse()) {
    if (!m.company_id) continue;
    if (m.meeting_date) lastMeetingByCompany.set(m.company_id, m.meeting_date);
    const meetingReads = (reads ?? []).filter((r) => r.meeting_id === m.id);
    const latest = meetingReads[meetingReads.length - 1];
    if (latest?.sentiment) {
      sentimentByCompany.set(m.company_id, latest.sentiment as Sentiment);
    }
  }

  const boardCompanies: BoardCompany[] = (companies ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    deal_value: c.deal_value,
    status_id: c.status_id,
    last_meeting_date: lastMeetingByCompany.get(c.id) ?? null,
    sentiment: sentimentByCompany.get(c.id) ?? null,
  }));

  // ---- review inbox ---------------------------------------------------------
  const needsReview = allMeetings.filter((m) =>
    ["awaiting_speakers", "review", "failed"].includes(m.status),
  );

  // ---- activity strip -------------------------------------------------------
  const activity: ActivityItem[] = [
    ...allMeetings
      .filter((m) => m.status === "ready")
      .slice(0, 4)
      .map((m) => ({
        id: `approved-${m.id}`,
        kind: "approved" as const,
        text: `Report approved — ${m.title}`,
        at: m.created_at,
      })),
    ...allMeetings
      .filter((m) => ["review", "awaiting_speakers"].includes(m.status))
      .slice(0, 4)
      .map((m) => ({
        id: `processed-${m.id}`,
        kind: "processed" as const,
        text: `Meeting processed — ${m.title}`,
        at: m.created_at,
      })),
    ...(actionItems ?? [])
      .filter((a) => a.done)
      .slice(0, 3)
      .map((a) => ({
        id: `done-${a.id}`,
        kind: "follow_up_done" as const,
        text: `Follow-up completed — ${a.title}`,
        at: a.created_at,
      })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  const firstName = (profile?.full_name ?? "").split(" ")[0];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl leading-tight md:text-5xl">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/meetings/new">New meeting</Link>
          </Button>
          <Button asChild className="bg-brand text-on-brand hover:bg-brand-hover">
            <Link href="/meetings/new?record=1">
              <Mic className="size-4" />
              Record
            </Link>
          </Button>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Meetings captured this week"
          value={capturedThisWeek}
          icon={<Mic className="size-4" />}
          series={capturedSeries}
        />
        <StatCard
          label="Follow-ups due"
          value={open.length}
          icon={<ListChecks className="size-4" />}
          accent={overdue > 0 ? "butter" : "primary"}
          hint={overdue > 0 ? `${pluralise(overdue, "overdue item")}` : "Nothing overdue"}
          hintTone={overdue > 0 ? "warn" : "muted"}
        />
        <StatCard
          label="Hours of note-taking saved"
          value={hoursSaved.toFixed(1)}
          icon={<Clock className="size-4" />}
          accent="success"
          hint={`Estimate: ${MINUTES_SAVED_PER_MEETING} min per processed meeting`}
        />
        <StatCard
          label="Relationships warming"
          value={warming}
          icon={<HeartHandshake className="size-4" />}
          accent="success"
          hint="People who sounded better than last time"
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-display text-2xl">Needs your review</h2>
        <ReviewInbox meetings={needsReview} />
      </section>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl">Pipeline</h2>
          <Button asChild variant="ghost" size="sm">
            <Link href="/companies">All companies</Link>
          </Button>
        </div>
        <PipelineBoard
          statuses={(statuses ?? []) as StatusOption[]}
          companies={boardCompanies}
        />
      </section>

      <section className="mt-10">
        <h2 className="mb-3 font-display text-2xl">Recent activity</h2>
        <ActivityStrip items={activity} />
      </section>
    </div>
  );
}
