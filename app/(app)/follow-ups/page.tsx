import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import {
  FollowUpsList,
  type FollowUpRow,
  type FollowUpsNextStep,
} from "@/components/shared/follow-ups-list";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Follow-ups · Lepaq" };

export default async function FollowUpsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Only approved items. An unapproved draft is not a commitment yet.
  const { data: items } = await supabase
    .from("action_items")
    .select("*, meetings(id, title, company_id, companies(name))")
    .eq("owner_id", user.id)
    .eq("approved", true)
    .order("due_date", { ascending: true, nullsFirst: false });

  // For the empty list: the step that would put something on it.
  const { data: waiting } = await supabase
    .from("meetings")
    .select("id, title, status")
    .eq("owner_id", user.id)
    .in("status", ["review", "awaiting_speakers"])
    .order("created_at", { ascending: false })
    .limit(1);
  const { count: meetingCount } = await supabase
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", user.id);

  const next = waiting?.[0];
  const nextStep: FollowUpsNextStep = next
    ? next.status === "review"
      ? {
          href: `/meetings/${next.id}`,
          label: "Review report",
          note: `“${next.title}” is waiting for your review.`,
        }
      : {
          href: `/meetings/${next.id}/speakers`,
          label: "Check speakers",
          note: `“${next.title}” needs its speakers confirmed before the report is written.`,
        }
    : meetingCount
      ? { href: "/meetings", label: "See meetings", note: null }
      : { href: "/meetings/new", label: "Upload recording", note: null };

  const rows: FollowUpRow[] = (items ?? []).map((i) => {
    const meeting = i.meetings as unknown as {
      id: string;
      title: string;
      companies: { name: string } | null;
    } | null;

    return {
      id: i.id,
      title: i.title,
      assignee_name: i.assignee_name,
      due_date: i.due_date,
      done: i.done,
      meeting_id: meeting?.id ?? null,
      meeting_title: meeting?.title ?? null,
      company_name: meeting?.companies?.name ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Follow-ups"
        description="Everything you agreed to, from every meeting you have approved."
      />
      <FollowUpsList rows={rows} nextStep={nextStep} />
    </div>
  );
}
