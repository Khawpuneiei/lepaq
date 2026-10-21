import type { ReactNode } from "react";

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
  activeHref,
  children,
}: {
  name: string;
  email: string;
  /** Overrides the URL when deciding which nav item is lit. */
  activeHref?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar activeHref={activeHref} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={name} email={email} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
