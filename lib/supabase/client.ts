"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser client. Uses the anon key, so every read and write is still subject
 * to the row level security policies in 0001_init.sql.
 *
 * Most CRUD in this app (companies, people, statuses, facts, action items)
 * goes straight through here — spec 6 deliberately has no API route for it.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
