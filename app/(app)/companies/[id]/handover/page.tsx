import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopyPageButton } from "@/components/shared/copy-page-button";
import { createClient } from "@/lib/supabase/server";
import { factCategoryLabel } from "@/lib/constants";
import { dueLabel, formatDate } from "@/lib/utils";

/**
 * The "colleague on leave" job, done as a template over data that already
 * exists rather than a new AI call (spec 7.7).
 *
 * Deliberately excluded, because a handover is read by someone else:
 * coach notes, emotion reads, engagement scores, and the transcript. What is
 * left is approved summaries, approved facts and open commitments.
 */
export default async function HandoverPage({
  params,
}: PageProps<"/companies/[id]/handover">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: company } = await supabase
    .from("companies")
    .select("*, status_options(label)")
    .eq("id", id)
    .maybeSingle();

  if (!company) notFound();

  const { data: meetings } = await supabase
    .from("meetings")
    .select("id, title, meeting_date, meeting_reports(summary, key_takeaways, approved_at)")
    .eq("company_id", id)
    .eq("status", "ready")
    .order("meeting_date", { ascending: false });

  const { data: people } = await supabase
    .from("people")
    .select("id, full_name, position")
    .eq("company_id", id);

  const personIds = (people ?? []).map((p) => p.id);
  const meetingIds = (meetings ?? []).map((m) => m.id);

  const [{ data: facts }, { data: openItems }] = await Promise.all([
    personIds.length
      ? supabase
          .from("person_facts")
          .select("person_id, category, fact")
          .in("person_id", personIds)
          .eq("approved", true)
      : Promise.resolve({ data: [] as { person_id: string; category: string; fact: string }[] }),
    meetingIds.length
      ? supabase
          .from("action_items")
          .select("title, assignee_name, due_date")
          .in("meeting_id", meetingIds)
          .eq("approved", true)
          .eq("done", false)
          .order("due_date", { ascending: true })
      : Promise.resolve({ data: [] as { title: string; assignee_name: string | null; due_date: string | null }[] }),
  ]);

  const factsByPerson = new Map<string, { category: string; fact: string }[]>();
  for (const f of facts ?? []) {
    const list = factsByPerson.get(f.person_id) ?? [];
    list.push({ category: f.category, fact: f.fact });
    factsByPerson.set(f.person_id, list);
  }

  const status = company.status_options as unknown as { label: string } | null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/companies/${id}`}>
            <ArrowLeft className="size-4" />
            Back
          </Link>
        </Button>
        <CopyPageButton targetId="handover" />
      </div>

      <article id="handover" className="report-prose space-y-8">
        <header>
          <h1 className="font-display text-4xl">{company.name} — handover</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Status: {status?.label ?? "not set"} · Prepared {formatDate(new Date().toISOString().slice(0, 10))}
          </p>
        </header>

        <section>
          <h2 className="font-display text-2xl">Who you will be talking to</h2>
          {(people ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No contacts recorded.</p>
          ) : (
            <ul className="mt-3 space-y-4">
              {(people ?? []).map((p) => {
                const theirFacts = factsByPerson.get(p.id) ?? [];
                return (
                  <li key={p.id}>
                    <p className="font-medium">
                      {p.full_name}
                      {p.position ? ` — ${p.position}` : ""}
                    </p>
                    {theirFacts.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {theirFacts.map((f, i) => (
                          <li key={i} className="text-sm text-muted-foreground">
                            {factCategoryLabel(f.category)}: {f.fact}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-display text-2xl">Open commitments</h2>
          {(openItems ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {(openItems ?? []).map((item, i) => (
                <li key={i} className="text-sm">
                  {item.title}
                  {item.assignee_name ? ` — ${item.assignee_name}` : ""}
                  {item.due_date ? ` (${dueLabel(item.due_date).text})` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-display text-2xl">What has happened so far</h2>
          {(meetings ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No approved meeting summaries yet. Approve a report and it will
              appear here.
            </p>
          ) : (
            <div className="mt-3 space-y-6">
              {(meetings ?? []).map((m) => {
                const report = m.meeting_reports as unknown as {
                  summary: string | null;
                  key_takeaways: string[];
                } | null;

                return (
                  <div key={m.id}>
                    <h3 className="font-medium">
                      {m.title}{" "}
                      <span className="font-normal text-muted-foreground">
                        · {formatDate(m.meeting_date)}
                      </span>
                    </h3>
                    {report?.summary && <p className="mt-1 text-sm">{report.summary}</p>}
                    {report?.key_takeaways?.length ? (
                      <ul className="mt-2 space-y-0.5">
                        {report.key_takeaways.map((t, i) => (
                          <li key={i} className="text-sm text-muted-foreground">
                            — {t}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <footer className="border-t pt-4 text-xs text-muted-foreground">
          Compiled from approved summaries and approved notes only. Coaching
          notes, emotion readings and transcripts are not included.
        </footer>
      </article>
    </div>
  );
}
