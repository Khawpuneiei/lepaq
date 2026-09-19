import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PageHeader } from "@/components/shared/page-header";
import { StatusSelect } from "@/components/people/status-select";
import { createClient } from "@/lib/supabase/server";
import { dueLabel, formatDate, formatMoney, initials } from "@/lib/utils";
import type { StatusOption } from "@/lib/types";

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!company) notFound();

  const [{ data: people }, { data: meetings }, { data: statuses }] = await Promise.all([
    supabase
      .from("people")
      .select("id, full_name, position")
      .eq("company_id", id)
      .order("full_name", { ascending: true }),
    supabase
      .from("meetings")
      .select("id, title, meeting_date, status")
      .eq("company_id", id)
      .order("meeting_date", { ascending: false }),
    supabase
      .from("status_options")
      .select("*")
      .eq("owner_id", user.id)
      .eq("applies_to", "company")
      .order("sort_order", { ascending: true }),
  ]);

  const meetingIds = (meetings ?? []).map((m) => m.id);
  const { data: openItems } = meetingIds.length
    ? await supabase
        .from("action_items")
        .select("*")
        .in("meeting_id", meetingIds)
        .eq("approved", true)
        .eq("done", false)
        .order("due_date", { ascending: true })
    : { data: [] };

  const money = formatMoney(company.deal_value);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={company.name}
        eyebrow={company.kind}
        description={money ? `Deal value ${money}` : undefined}
      >
        <StatusSelect
          table="companies"
          rowId={company.id}
          statusId={company.status_id}
          options={(statuses ?? []) as StatusOption[]}
        />
        {/* Covers the "colleague on leave" job with no new AI work (spec 7.7) */}
        <Button asChild variant="outline">
          <Link href={`/companies/${company.id}/handover`}>Handover brief</Link>
        </Button>
      </PageHeader>

      <div className="space-y-8">
        <section>
          <h2 className="mb-3 font-display text-2xl">People</h2>
          {(people ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody yet.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {(people ?? []).map((p) => (
                <Card key={p.id} className="p-3">
                  <Link href={`/people/${p.id}`} className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarFallback className="bg-muted text-[10px]">
                        {initials(p.full_name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.full_name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.position ?? "—"}
                      </p>
                    </div>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </section>

        {openItems && openItems.length > 0 && (
          <section>
            <h2 className="mb-3 font-display text-2xl">Open follow-ups</h2>
            <div className="space-y-2">
              {openItems.map((item) => {
                const due = dueLabel(item.due_date);
                return (
                  <Card key={item.id} className="flex items-center gap-3 p-4">
                    <span className="flex-1 text-sm">{item.title}</span>
                    <span
                      className={
                        due.tone === "danger"
                          ? "shrink-0 text-xs text-danger"
                          : "shrink-0 text-xs text-muted-foreground"
                      }
                    >
                      {due.text}
                    </span>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 font-display text-2xl">Meetings</h2>
          {(meetings ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings yet.</p>
          ) : (
            <div className="space-y-2">
              {(meetings ?? []).map((m) => (
                <Card key={m.id} className="p-4">
                  <Link href={`/meetings/${m.id}`} className="block">
                    <p className="truncate text-sm font-medium">{m.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(m.meeting_date)}
                    </p>
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </section>

        {company.notes && (
          <section>
            <h2 className="mb-3 font-display text-2xl">Notes</h2>
            <Card className="report-prose p-5 text-sm">{company.notes}</Card>
          </section>
        )}
      </div>
    </div>
  );
}
