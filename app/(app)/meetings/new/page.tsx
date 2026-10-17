import { redirect } from "next/navigation";

import { NewMeetingWizard } from "@/components/meeting/new-meeting-wizard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "New meeting · Lepaq" };

export default async function NewMeetingPage({ searchParams }: PageProps<"/meetings/new">) {
  // ?record=1 is the one-tap entry from the top bar: open straight into recording
  const { record } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: companies }, { data: people }, { data: profile }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name")
      .eq("owner_id", user.id)
      .order("name", { ascending: true }),
    supabase
      .from("people")
      .select("id, full_name, position, companies(name)")
      .eq("owner_id", user.id)
      .order("full_name", { ascending: true }),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);

  return (
    <NewMeetingWizard
      companies={companies ?? []}
      people={(people ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        position: p.position,
        company_name:
          (p.companies as unknown as { name: string } | null)?.name ?? null,
      }))}
      myName={profile?.full_name ?? ""}
      startRecording={record === "1"}
    />
  );
}
