import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Lock, MessageCircleQuestion } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/shared/page-header";
import { SentimentChip } from "@/components/shared/chips";
import { RememberThisCard } from "@/components/people/remember-this-card";
import {
  SentimentTimeline,
  type TimelinePoint,
} from "@/components/people/sentiment-timeline";
import { StatusSelect } from "@/components/people/status-select";
import { createClient } from "@/lib/supabase/server";
import { dueLabel, formatDate } from "@/lib/utils";
import { fallbackColumns } from "@/lib/interests";
import type {
  Coach,
  InterestColumn,
  PersonFact,
  Sentiment,
  StatusOption,
} from "@/lib/types";

export default async function PersonPage({ params }: PageProps<"/people/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: person } = await supabase
    .from("people")
    .select("*, companies(id, name)")
    .eq("id", id)
    .maybeSingle();

  if (!person) notFound();

  const [
    { data: facts },
    { data: reads },
    { data: statuses },
    { data: participantRows },
    { data: columnRows },
  ] = await Promise.all([
      supabase
        .from("person_facts")
        .select("*")
        .eq("person_id", id)
        .eq("approved", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("participant_reads")
        .select("*, meetings(id, title, meeting_date)")
        .eq("person_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("status_options")
        .select("*")
        .eq("owner_id", user.id)
        .eq("applies_to", "person")
        .order("sort_order", { ascending: true }),
      // Meetings this person was in.
      supabase
        .from("meeting_participants")
        .select("meeting_id, meetings(id, title, meeting_date, status)")
        .eq("person_id", id),
      supabase
        .from("interest_columns")
        .select("*")
        .eq("owner_id", user.id)
        .order("sort_order", { ascending: true }),
    ]);

  const columns: InterestColumn[] = (columnRows ?? []).length
    ? (columnRows as unknown as InterestColumn[])
    : fallbackColumns(user.id);

  // Open follow-ups: the ones this person owns, and every approved one from a
  // meeting they were in. A follow-up's person is its owner, so "send Jamie the
  // proposal" is yours and would otherwise only reach your list and the
  // company page; prepping for Jamie is when you need it. The company page
  // lists follow-ups by meeting the same way. The ids are from the database
  // (person.id, meeting ids), never from the URL, so the filter string is safe.
  const meetingIds = (participantRows ?? []).map((r) => r.meeting_id).filter(Boolean);
  const openFollowUps = () =>
    supabase
      .from("action_items")
      .select("*")
      .eq("approved", true)
      .eq("done", false)
      .order("due_date", { ascending: true });
  let { data: openItems, error: openError } = await openFollowUps().or(
    meetingIds.length
      ? `person_id.eq.${person.id},meeting_id.in.(${meetingIds.join(",")})`
      : `person_id.eq.${person.id}`,
  );
  if (openError) {
    // a failed lookup by meeting must not hide the ones this person owns
    console.error("[people] open follow-ups by meeting:", openError.message);
    ({ data: openItems, error: openError } = await openFollowUps().eq("person_id", person.id));
    if (openError) console.error("[people] open follow-ups:", openError.message);
  }

  // Meetings this person was in, newest first.
  const history = (participantRows ?? [])
    .map((r) => r.meetings as unknown as {
      id: string;
      title: string;
      meeting_date: string;
      status: string;
    })
    .filter(Boolean)
    .sort((a, b) => (b.meeting_date ?? "").localeCompare(a.meeting_date ?? ""));

  const points: TimelinePoint[] = (reads ?? [])
    .filter((r) => r.sentiment)
    .map((r) => {
      const meeting = r.meetings as unknown as {
        title: string;
        meeting_date: string;
      } | null;
      return {
        date: meeting?.meeting_date ?? r.created_at,
        sentiment: r.sentiment as Sentiment,
        meetingTitle: meeting?.title ?? "Meeting",
      };
    });

  const latestRead = (reads ?? [])[reads!.length - 1];

  // Prep material comes from the most recent meeting this person attended.
  let coach: Coach | null = null;
  if (history[0]) {
    const { data: report } = await supabase
      .from("meeting_reports")
      .select("coach")
      .eq("meeting_id", history[0].id)
      .maybeSingle();
    coach = (report?.coach ?? null) as Coach | null;
  }

  const company = person.companies as unknown as { id: string; name: string } | null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={person.full_name}
        eyebrow={
          company ? (
            <Link href={`/companies/${company.id}`} className="hover:underline">
              {company.name}
            </Link>
          ) : null
        }
        description={person.position}
      >
        <StatusSelect
          table="people"
          rowId={person.id}
          statusId={person.status_id}
          options={(statuses ?? []) as StatusOption[]}
        />
      </PageHeader>

      <div className="space-y-8">
        <RememberThisCard
          personId={person.id}
          personName={person.full_name}
          facts={(facts ?? []) as PersonFact[]}
          columns={columns}
        />

        {points.length > 0 && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl">How they have felt</h2>
              {latestRead?.sentiment && (
                <SentimentChip sentiment={latestRead.sentiment as Sentiment} />
              )}
            </div>
            <Card className="p-5">
              <SentimentTimeline points={points} />
              <p className="mt-3 text-xs text-muted-foreground">
                Read from words only. Treat as a hint, not a fact.
              </p>
            </Card>
          </section>
        )}

        {(coach || openItems?.length) && (
          <section>
            <h2 className="mb-3 font-display text-2xl">Prep for next meeting</h2>
            <Card className="space-y-5 p-5">
              {coach?.next_meeting_openers?.length ? (
                <div>
                  <h3 className="text-sm font-medium">Openers</h3>
                  <ul className="mt-2 space-y-1.5">
                    {coach.next_meeting_openers.map((o, i) => (
                      <li key={i} className="text-sm italic text-muted-foreground">
                        “{o}”
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {coach?.questions_to_ask_next?.length ? (
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <MessageCircleQuestion className="size-3.5" aria-hidden />
                    Questions to ask
                  </h3>
                  <ul className="mt-2 space-y-1.5">
                    {coach.questions_to_ask_next.map((q, i) => (
                      <li key={i} className="text-sm text-muted-foreground">
                        {q}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {openItems && openItems.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium">Open follow-ups</h3>
                  <ul className="mt-2 space-y-2">
                    {openItems.map((item) => {
                      const due = dueLabel(item.due_date);
                      return (
                        <li key={item.id} className="flex items-start gap-2 text-sm">
                          <Checkbox disabled className="mt-0.5" aria-hidden />
                          <span className="flex-1">{item.title}</span>
                          <span
                            className={
                              due.tone === "danger"
                                ? "shrink-0 text-xs text-danger"
                                : "shrink-0 text-xs text-muted-foreground"
                            }
                          >
                            {due.text}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              <p className="flex items-center gap-1.5 border-t pt-4 text-xs text-muted-foreground">
                <Lock className="size-3" aria-hidden />
                Prep notes come from your coach panel and stay private to you.
              </p>
            </Card>
          </section>
        )}

        <section>
          <h2 className="mb-3 font-display text-2xl">Meetings</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((m) => (
                <Card key={m.id} className="p-4">
                  <Link href={`/meetings/${m.id}`} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(m.meeting_date)}
                      </p>
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
