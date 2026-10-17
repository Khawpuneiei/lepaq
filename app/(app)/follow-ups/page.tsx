import { redirect } from "next/navigation";

import { PageHeader } from "@/components/shared/page-header";
import { FollowUpsList, type FollowUpRow } from "@/components/shared/follow-ups-list";
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
      <FollowUpsList rows={rows} />
    </div>
  );
}
