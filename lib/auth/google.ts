import type { SupabaseClient } from "@supabase/supabase-js";

import { safeNext } from "@/lib/auth/next";

const PROVIDER_OFF =
  "Google sign-in is switched off in Supabase (Authentication → Sign In / Providers → Google).";

function callbackUrl(next: string) {
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
}

/**
 * Whether the Supabase project has Google switched on. signInWithOAuth only
 * builds a URL and leaves, so without this a project that has not finished
 * setup sends the browser to a bare JSON error on supabase.co. Unknown
 * (null) when the settings could not be read; the sign-in goes ahead then.
 */
async function googleIsOn(): Promise<boolean | null> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const settings = (await res.json()) as { external?: Record<string, unknown> };
    return settings.external?.google === true;
  } catch {
    return null;
  }
}

/**
 * Sends the browser to Google, then back to /auth/callback, which signs in
 * (or signs up). A guest goes the same way: the callback sees the guest's
 * session still in place and moves what the guest made into the Google
 * account (lib/auth/guest.ts, adoptGuest).
 *
 * Resolves with a message only when it could not leave; on success the page
 * is already navigating away.
 */
export async function continueWithGoogle(supabase: SupabaseClient, next: string): Promise<string | null> {
  if ((await googleIsOn()) === false) return PROVIDER_OFF;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl(next),
      // otherwise a browser signed in to one Google account is never asked
      queryParams: { prompt: "select_account" },
    },
  });
  return error ? error.message || "Could not reach Google. Try again." : null;
}
