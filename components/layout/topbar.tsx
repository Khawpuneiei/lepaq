"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Menu, Mic, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LepaqLogo } from "@/components/layout/logo";
import { SidebarNav } from "@/components/layout/sidebar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { createClient } from "@/lib/supabase/client";
import { initials } from "@/lib/utils";

export function Topbar({
  name,
  email,
  isGuest = false,
}: {
  name: string;
  email: string;
  isGuest?: boolean;
}) {
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  // a guest account cannot be signed back into, so leaving it is confirmed
  const [confirmGuestSignOut, setConfirmGuestSignOut] = useState(false);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="px-5 pt-5 text-2xl text-white">
            <LepaqLogo />
            <span className="sr-only">menu</span>
          </SheetTitle>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="ml-auto flex items-center gap-2">
        {/* One-tap capture: the tap that lands here is the gesture the
            browser needs before it asks for the microphone */}
        {/* Two ways in, named for what the user has in hand: a meeting about
            to happen, or a file that already exists. They open the same
            wizard in record or upload mode. */}
        <Button asChild className="bg-brand text-on-brand hover:bg-brand-hover">
          <Link href="/meetings/new?record=1" aria-label="Record meeting">
            <Mic className="size-4" />
            <span>
              Record<span className="hidden sm:inline"> meeting</span>
            </span>
          </Link>
        </Button>

        <Button asChild variant="outline">
          <Link href="/meetings/new" aria-label="Upload recording">
            <Upload className="size-4" />
            <span className="hidden sm:inline">Upload recording</span>
          </Link>
        </Button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Account">
              <Avatar className="size-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {initials(name || email || (isGuest ? "Guest" : ""))}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="font-medium">{name || (isGuest ? "Guest" : "Your account")}</div>
              <div className="text-xs font-normal text-muted-foreground">
                {isGuest ? "Guest account" : email}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={isGuest ? () => setConfirmGuestSignOut(true) : signOut}>
              <LogOut className="size-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={confirmGuestSignOut} onOpenChange={setConfirmGuestSignOut}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign out of the guest account?</DialogTitle>
            <DialogDescription>
              A guest account has no email or password, so there is no way back
              into it, and its meetings go with it. Continue with Google first,
              from the banner at the top, to keep them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmGuestSignOut(false)}>
              Stay signed in
            </Button>
            <Button variant="destructive" onClick={signOut}>
              Sign out and lose it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
}
