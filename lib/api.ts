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

export function apiError(err: unknown) {
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
    if (/rate limit/i.test(err.message)) {
      return "The AI service is rate limited. Wait a minute and press Retry.";
    }
    if (/credit balance|billing/i.test(err.message)) {
      return "The Anthropic account has no credit left. Top it up and press Retry.";
    }
    if (/ANTHROPIC_API_KEY|OPENAI_API_KEY/.test(err.message)) {
      return "The AI service is not configured. Add ANTHROPIC_API_KEY to the environment and redeploy.";
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}
