import { redirect } from "next/navigation";

import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/page-header";
import { StatusEditor } from "@/components/shared/status-editor";
import {
  DangerZone,
  PrivacyForm,
  ProfileForm,
} from "@/components/shared/settings-forms";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { createClient } from "@/lib/supabase/server";
import type { StatusOption } from "@/lib/types";

export const metadata = { title: "Settings · Lepaq" };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: statuses }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase
      .from("status_options")
      .select("*")
      .eq("owner_id", user.id)
      .order("sort_order", { ascending: true }),
  ]);

  const all = (statuses ?? []) as StatusOption[];

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" description={user.email ?? undefined} />

      <div className="space-y-6">
        <ProfileForm
          userId={user.id}
          fullName={profile?.full_name ?? ""}
          jobTitle={profile?.job_title ?? ""}
        />

        <StatusEditor
          scope="company"
          title="Company statuses"
          description="These are the columns on your pipeline board, in this order."
          initial={all.filter((s) => s.applies_to === "company")}
          ownerId={user.id}
        />

        <StatusEditor
          scope="person"
          title="Person statuses"
          description="How you think about individuals, not deals."
          initial={all.filter((s) => s.applies_to === "person")}
          ownerId={user.id}
        />

        <PrivacyForm
          userId={user.id}
          deleteAudio={profile?.delete_audio_after_processing ?? true}
        />

        <Card className="flex items-center justify-between gap-4 p-5">
          <div>
            <h3 className="font-medium">Appearance</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Light is the default. Dark is easier at night, harder for long
              reading.
            </p>
          </div>
          <ThemeToggle />
        </Card>

        <DangerZone userId={user.id} />
      </div>
    </div>
  );
}
