import Link from "next/link";
import { redirect } from "next/navigation";
import { Users } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SentimentDot, StatusChip } from "@/components/shared/chips";
import { createClient } from "@/lib/supabase/server";
import { initials, pluralise } from "@/lib/utils";
import type { Sentiment } from "@/lib/types";

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

  const [{ data: reads }, { data: facts }] = await Promise.all([
    ids.length
      ? supabase
          .from("participant_reads")
          .select("person_id, sentiment, created_at")
          .in("person_id", ids)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as { person_id: string | null; sentiment: string | null }[] }),
    ids.length
      ? supabase
          .from("person_facts")
          .select("person_id")
          .in("person_id", ids)
          .eq("approved", true)
      : Promise.resolve({ data: [] as { person_id: string }[] }),
  ]);

  const latestSentiment = new Map<string, Sentiment>();
  for (const r of reads ?? []) {
    if (r.person_id && r.sentiment) {
      latestSentiment.set(r.person_id, r.sentiment as Sentiment);
    }
  }

  const factCount = new Map<string, number>();
  for (const f of facts ?? []) {
    factCount.set(f.person_id, (factCount.get(f.person_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="People"
        description="Everyone you have met, and what you know about them."
      />

      {(people ?? []).length === 0 ? (
        <EmptyState
          icon={Users}
          title="No people yet"
          description="People are created automatically from the participants you name when you upload a meeting."
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {(people ?? []).map((p) => {
            const company = p.companies as unknown as { name: string } | null;
            const status = p.status_options as unknown as
              | { label: string; color: string }
              | null;
            const facts = factCount.get(p.id) ?? 0;

            return (
              <Card key={p.id} className="p-4 transition-shadow hover:shadow-card">
                <Link href={`/people/${p.id}`} className="flex items-start gap-3">
                  <Avatar className="size-10">
                    <AvatarFallback className="bg-muted text-xs">
                      {initials(p.full_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{p.full_name}</p>
                      <SentimentDot sentiment={latestSentiment.get(p.id) ?? null} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[p.position, company?.name].filter(Boolean).join(" · ") ||
                        "No company"}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <StatusChip label={status?.label} color={status?.color} />
                      {facts > 0 && (
                        <span className="text-xs text-muted-foreground">
                          {pluralise(facts, "thing")} remembered
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
