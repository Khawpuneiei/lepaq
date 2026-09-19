import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only three things may use it, and each one re-checks ownership itself:
 *   1. the processing pipeline, which downloads audio and writes AI output
 *      on behalf of a user whose session is not in scope;
 *   2. the public /s/[token] share page, which has no session at all and
 *      returns a hand-picked list of approved fields;
 *   3. scripts/seed.ts.
 *
 * The "server-only" import above makes a client-side import a build error
 * rather than a leaked key.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Copy .env.example to .env.local and fill them in.",
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
