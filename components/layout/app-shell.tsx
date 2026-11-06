import type { ReactNode } from "react";

import { GuestBanner } from "@/components/layout/guest-banner";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

/**
 * The signed-in frame: sidebar, top bar, page. Shared by the (app) layout and
 * the /demo walkthrough, so the demo is the real chrome rather than a copy of
 * it that drifts.
 */
export function AppShell({
  name,
  email,
  isGuest = false,
  guestCanStartMeeting = true,
  activeHref,
  children,
}: {
  name: string;
  email: string;
  /** A Supabase anonymous user: no email, lost on sign-out. */
  isGuest?: boolean;
  /** For a guest: whether their one meeting is still unused. */
  guestCanStartMeeting?: boolean;
  /** Overrides the URL when deciding which nav item is lit. */
  activeHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar activeHref={activeHref} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={name} email={email} isGuest={isGuest} />
        {isGuest && <GuestBanner canStartMeeting={guestCanStartMeeting} />}
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
