"use client";

import { useState, type ComponentProps } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/layout/google-icon";
import { continueWithGoogle } from "@/lib/auth/google";
import { createClient } from "@/lib/supabase/client";

/**
 * For a signed-in guest: signs in with Google from this browser and comes
 * back to this page, and /auth/callback moves everything the guest made into
 * the Google account.
 */
export function ContinueWithGoogleButton({
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "disabled">) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const iconSize = props.size === "sm" ? "size-3.5" : "size-4";

  async function go() {
    setBusy(true);
    const problem = await continueWithGoogle(createClient(), pathname || "/dashboard");
    if (problem) {
      toast.error(problem);
      setBusy(false);
    }
  }

  return (
    <Button {...props} onClick={go} disabled={busy}>
      {busy ? <Loader2 className={`${iconSize} animate-spin`} /> : <GoogleIcon className={iconSize} />}
      {children}
    </Button>
  );
}
