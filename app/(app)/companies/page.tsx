import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusChip } from "@/components/shared/chips";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, pluralise } from "@/lib/utils";

export const metadata = { title: "Companies · Rapport" };

export default async function CompaniesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: companies }, { data: people }] = await Promise.all([
    supabase
      .from("companies")
      .select("*, status_options(label, color)")
      .eq("owner_id", user.id)
      .order("name", { ascending: true }),
    supabase.from("people").select("company_id").eq("owner_id", user.id),
  ]);

  const peopleCount = new Map<string, number>();
  for (const p of people ?? []) {
    if (p.company_id) {
      peopleCount.set(p.company_id, (peopleCount.get(p.company_id) ?? 0) + 1);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Companies" description="Who you are working with." />

      {(companies ?? []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="Add a company while uploading a meeting and it will appear here."
        />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {(companies ?? []).map((c) => {
            const status = c.status_options as unknown as
              | { label: string; color: string }
              | null;
            const money = formatMoney(c.deal_value);

            return (
              <Card key={c.id} className="p-4 transition-shadow hover:shadow-card">
                <Link href={`/companies/${c.id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{c.name}</p>
                    <span className="shrink-0 text-xs capitalize text-muted-foreground">
                      {c.kind}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <StatusChip label={status?.label} color={status?.color} />
                    {money && (
                      <span className="text-xs text-muted-foreground">{money}</span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {pluralise(peopleCount.get(c.id) ?? 0, "person", "people")}
                    </span>
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
