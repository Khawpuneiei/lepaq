import { notFound } from "next/navigation";

import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import type { Decision } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meeting summary" };

/**
 * The only public page in the app.
 *
 * It runs with the service role because there is no session here, which makes
 * the select list below the single most security-sensitive line in the
 * codebase. It names fields explicitly and never uses select("*"): adding a
 * column to meeting_reports must not silently start publishing it.
 *
 * Never returned, by construction: audio, transcript, emotion reads, personal
 * facts, coach notes, talk ratios, the suggested status, or anything about
 * other meetings.
 */
export default async function SharedSummaryPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: meeting } = await admin
    .from("meetings")
    .select("id, title, meeting_date, share_token, status")
    .eq("share_token", token)
    .maybeSingle();

  // A revoked link nulls share_token, so this is also the revocation check.
  if (!meeting || meeting.status !== "ready") notFound();

  const [{ data: report }, { data: actionItems }] = await Promise.all([
    admin
      .from("meeting_reports")
      .select("summary, key_takeaways, decisions, approved_at")
      .eq("meeting_id", meeting.id)
      .maybeSingle(),
    admin
      .from("action_items")
      .select("title, assignee_name, due_date")
      .eq("meeting_id", meeting.id)
      .eq("approved", true)
      .order("due_date", { ascending: true }),
  ]);

  if (!report?.approved_at) notFound();

  const decisions = (report.decisions ?? []) as Decision[];
  const takeaways = (report.key_takeaways ?? []) as string[];

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <article className="mx-auto max-w-2xl">
        <header className="border-b pb-6">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Meeting summary
          </p>
          <h1 className="mt-2 font-display text-4xl leading-tight">{meeting.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatDate(meeting.meeting_date)}
          </p>
        </header>

        {report.summary && (
          <section className="mt-8">
            <p className="report-prose">{report.summary}</p>
          </section>
        )}

        {takeaways.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-2xl">Key takeaways</h2>
            <ul className="mt-3 space-y-2">
              {takeaways.map((t, i) => (
                <li key={i} className="flex gap-3 report-prose text-sm">
                  <span
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                    aria-hidden
                  />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {decisions.length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-2xl">Decisions</h2>
            <ul className="mt-3 space-y-2">
              {decisions.map((d, i) => (
                <li key={i} className="report-prose text-sm">
                  {d.text}
                </li>
              ))}
            </ul>
          </section>
        )}

        {(actionItems ?? []).length > 0 && (
          <section className="mt-8">
            <h2 className="font-display text-2xl">Next steps</h2>
            <ul className="mt-3 space-y-2">
              {(actionItems ?? []).map((item, i) => (
                <li key={i} className="report-prose text-sm">
                  {item.title}
                  {item.assignee_name && (
                    <span className="text-muted-foreground"> — {item.assignee_name}</span>
                  )}
                  {item.due_date && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({formatDate(item.due_date)})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-12 border-t pt-6 text-xs text-muted-foreground">
          <p>
            Shared summary, reviewed and approved by the person who ran the
            meeting. The recording and transcript are not included and are not
            shared.
          </p>
          <p className="mt-2">Made with Lepaq.</p>
        </footer>
      </article>
    </div>
  );
}
