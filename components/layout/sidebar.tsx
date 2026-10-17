"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CircleCheckBig,
  LayoutDashboard,
  Mic,
  Settings,
  Users,
} from "lucide-react";

import { LepaqLogo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";

/**
 * Six items, deliberately (spec 7.1). A typical CRM sidebar has nine; six
 * says "this is lighter". Resist adding Reports or Automations here.
 */
const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/meetings", label: "Meetings", icon: Mic },
  { href: "/people", label: "People", icon: Users },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/follow-ups", label: "Follow-ups", icon: CircleCheckBig },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150",
              "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sidebar-ring",
              active &&
                "bg-sidebar-accent text-sidebar-accent-foreground font-medium",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", active && "text-sidebar-primary")}
              aria-hidden
            />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex w-60 shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      <div className="px-5 py-5">
        <Link href="/dashboard" aria-label="Lepaq, go to dashboard" className="inline-flex">
          <LepaqLogo className="text-2xl text-white" />
        </Link>
        {/* the deck's line, so the app and the pitch say the same thing */}
        <p className="mt-2 text-xs text-sidebar-foreground/70">
          Every coffee chat, remembered.
        </p>
      </div>
      <SidebarNav />
      <div className="mt-auto p-4">
        <p className="text-xs leading-relaxed text-sidebar-foreground/60">
          Everything here is private to you until you press Share.
        </p>
      </div>
    </aside>
  );
}
