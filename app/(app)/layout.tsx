import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { guestCanStartMeeting, isGuest } from "@/lib/auth/guest";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // proxy.ts already redirects, but a layout must not assume it ran.
  if (!user) redirect("/login");

  const guest = isGuest(user);
  const [{ data: profile }, canStart] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    guest ? guestCanStartMeeting(user.id) : true,
  ]);

  return (
    <>
      <AppShell
        name={profile?.full_name ?? ""}
        email={user.email ?? ""}
        isGuest={guest}
        guestCanStartMeeting={canStart}
      >
        {children}
      </AppShell>
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
