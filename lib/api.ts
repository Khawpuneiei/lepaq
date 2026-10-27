import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve the signed-in user or throw. proxy.ts already redirects browsers,
 * but a route handler must never rely on that: a direct POST skips the proxy
 * redirect entirely.
 */
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new ApiError("You need to sign in.", 401);
  return user;
}

/**
 * Ownership check for every /api/meetings/[id]/* route. RLS would catch this
 * anyway for the anon client, but the pipeline runs with the service role,
 * so the check has to be explicit there.
 */
export async function requireOwnedMeeting(meetingId: string, userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) throw new ApiError(error.message, 500);
  if (!data) throw new ApiError("Meeting not found.", 404);
  return data;
}

/**
 * fetch() quotes the whole value when it refuses a header, and that value is
 * usually a key. lib/env.ts readEnv stops the ones this app reads; this
 * catches any other, before the message reaches the browser, the log or the
 * meeting's error.
 */
const INVALID_HEADER = /invalid header value/i;
const HEADER_KEY_MESSAGE =
  "A key in this environment's variables has a line break inside it, so more than one line was probably pasted into it. Keep only the key itself in each, then redeploy.";

export function apiError(err: unknown) {
  if (err instanceof Error && INVALID_HEADER.test(err.message)) {
    console.error("[api]", HEADER_KEY_MESSAGE);
    return NextResponse.json({ error: HEADER_KEY_MESSAGE }, { status: 500 });
  }
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message =
    err instanceof Error ? err.message : "Something went wrong. Please try again.";
  console.error("[api]", err);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Readable message for the failed-state banner and the Retry button. */
export function friendlyError(err: unknown): string {
  if (err instanceof Error) {
    const m = err.message;
    if (INVALID_HEADER.test(m)) return HEADER_KEY_MESSAGE;
    // from lib/env.ts readEnv: already names the variable, and says what to do
    if (/has a space or line break inside it/.test(m)) return m;
    if (/credit balance is too low/i.test(m)) {
      return "The Anthropic account has no credit left. Top it up and press Retry.";
    }
    if (/ANTHROPIC_API_KEY/.test(m)) {
      return "The AI service is not configured. Add ANTHROPIC_API_KEY to the environment and redeploy.";
    }
    if (/WHISPERLAH_URL|WHISPERLAH_TOKEN|CALLBACK_SECRET|NEXT_PUBLIC_APP_URL/.test(m)) {
      return "The transcription service is not configured. Check the WHISPERLAH_* settings and redeploy.";
    }
    if (/rate limit/i.test(m)) {
      return "The AI service is rate limited. Wait a minute and press Retry.";
    }
    return m;
  }
  return "Something went wrong. Please try again.";
}
