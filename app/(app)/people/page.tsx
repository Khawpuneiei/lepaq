import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { PeopleView, type PersonRow } from "@/components/people/people-view";
import { createClient } from "@/lib/supabase/server";
import type { FactCategory, Sentiment } from "@/lib/types";

export const metadata = { title: "People · Rapport" };

export default async function PeoplePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: people } = await supabase
    .from("people")
    .select("*, companies(name), status_options(label, color)")
    .eq("owner_id", user.id)
    .order("full_name", { ascending: true });

  const ids = (people ?? []).map((p) => p.id);

  const empty = { data: [] as never[] };

  const [{ data: reads }, { data: facts }, { data: participantRows }] =
    await Promise.all([
      ids.length
        ? supabase
            .from("participant_reads")
            .select("person_id, sentiment, created_at, meetings(meeting_date)")
            .in("person_id", ids)
            .order("created_at", { ascending: true })
        : Promise.resolve(empty),
      ids.length
        ? supabase
            .from("person_facts")
            .select("person_id, category, fact, created_at")
            .in("person_id", ids)
            .eq("approved", true)
            .order("created_at", { ascending: true })
        : Promise.resolve(empty),
      ids.length
        ? supabase
            .from("meeting_participants")
            .select("person_id, meetings(id, meeting_date)")
            .in("person_id", ids)
        : Promise.resolve(empty),
    ]);

  // Latest reading wins. Reads come back oldest-first, so the last write for a
  // person is the most recent meeting — which is the status to show when
  // somebody has been met three times (an average would describe a
  // relationship that no longer exists).
  const latestSentiment = new Map<string, Sentiment>();
  for (const r of reads ?? []) {
    const row = r as unknown as { person_id: string | null; sentiment: string | null };
    if (row.person_id && row.sentiment) {
      latestSentiment.set(row.person_id, row.sentiment as Sentiment);
    }
  }

  const factsByPerson = new Map<string, { category: FactCategory; fact: string }[]>();
  for (const f of facts ?? []) {
    const row = f as unknown as {
      person_id: string;
      category: FactCategory;
      fact: string;
    };
    const list = factsByPerson.get(row.person_id) ?? [];
    list.push({ category: row.category, fact: row.fact });
    factsByPerson.set(row.person_id, list);
  }

  // How many distinct meetings each person has been in, and the most recent.
  const meetingsByPerson = new Map<string, Set<string>>();
  const lastMet = new Map<string, string>();
  for (const p of participantRows ?? []) {
    const row = p as unknown as {
      person_id: string | null;
      meetings: { id: string; meeting_date: string | null } | null;
    };
    if (!row.person_id || !row.meetings) continue;

    const set = meetingsByPerson.get(row.person_id) ?? new Set<string>();
    set.add(row.meetings.id);
    meetingsByPerson.set(row.person_id, set);

    const date = row.meetings.meeting_date;
    if (date && (!lastMet.has(row.person_id) || date > lastMet.get(row.person_id)!)) {
      lastMet.set(row.person_id, date);
    }
  }

  const rows: PersonRow[] = (people ?? []).map((p) => {
    const company = p.companies as unknown as { name: string } | null;
    const status = p.status_options as unknown as
      | { label: string; color: string }
      | null;

    return {
      id: p.id,
      full_name: p.full_name,
      position: p.position,
      company_id: p.company_id,
      company_name: company?.name ?? null,
      status_label: status?.label ?? null,
      status_color: status?.color ?? null,
      sentiment: latestSentiment.get(p.id) ?? null,
      last_met: lastMet.get(p.id) ?? null,
      meeting_count: meetingsByPerson.get(p.id)?.size ?? 0,
      facts: factsByPerson.get(p.id) ?? [],
    };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="People"
        description="One row per person. Meet someone again and it updates their row rather than adding another."
      />
      <PeopleView people={rows} />
    </div>
  );
}
