"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GoogleIcon } from "@/components/layout/google-icon";
import { continueWithGoogle } from "@/lib/auth/google";
import { createClient } from "@/lib/supabase/client";

/** Leaves the guest account and signs in with Google instead. */
export function SignOutToGoogle() {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    const problem = await continueWithGoogle(supabase, "/dashboard");
    if (problem) {
      toast.error(problem);
      setBusy(false);
    }
  }

  return (
    <Button variant="outline" onClick={go} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon className="size-4" />}
      Sign out and use Google
    </Button>
  );
}
