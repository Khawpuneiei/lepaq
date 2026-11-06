import Link from "next/link";
import { redirect } from "next/navigation";
import { Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { DraftBadge } from "@/components/shared/chips";
import { createClient } from "@/lib/supabase/server";
import { MEETING_STATUS_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/utils";
import { formatDuration } from "@/lib/talkRatio";

export const metadata = { title: "Meetings · Lepaq" };

export default async function MeetingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meetings } = await supabase
    .from("meetings")
    .select("*, companies(name)")
    .eq("owner_id", user.id)
    .order("meeting_date", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Meetings"
        description="Everything you have captured, newest first."
      >
        <Button asChild>
          <Link href="/meetings/new">Upload recording</Link>
        </Button>
      </PageHeader>

      {(meetings ?? []).length === 0 ? (
        <EmptyState
          icon={Mic}
          title="No meetings yet"
          description="Upload a recording and you will get a report, follow-ups and a read on everyone in the room."
          action={
            <Button asChild>
              <Link href="/meetings/new">Add your first meeting</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {(meetings ?? []).map((m) => {
            const company = m.companies as unknown as { name: string } | null;
            const href =
              m.status === "awaiting_speakers"
                ? `/meetings/${m.id}/speakers`
                : `/meetings/${m.id}`;

            return (
              <Card key={m.id} className="p-4 transition-shadow hover:shadow-card">
                <Link href={href} className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(m.meeting_date)}
                      {company ? ` · ${company.name}` : ""}
                      {m.duration_sec ? ` · ${formatDuration(m.duration_sec)}` : ""}
                    </p>
                  </div>

                  {m.status === "review" && <DraftBadge />}
                  {m.status !== "review" && (
                    <Badge
                      variant="outline"
                      className={
                        m.status === "failed"
                          ? "border-danger/40 text-danger"
                          : m.status === "ready"
                            ? "border-success/40 text-on-success-soft"
                            : "text-muted-foreground"
                      }
                    >
                      {MEETING_STATUS_LABEL[m.status] ?? m.status}
                    </Badge>
                  )}
                </Link>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
