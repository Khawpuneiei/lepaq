import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { Toaster } from "@/components/ui/sonner";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // proxy.ts already redirects, but a layout must not assume it ran.
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <>
      <AppShell name={profile?.full_name ?? ""} email={user.email ?? ""}>
        {children}
      </AppShell>
      <Toaster richColors closeButton position="top-right" />
    </>
  );
}
