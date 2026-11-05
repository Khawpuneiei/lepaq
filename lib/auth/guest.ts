import "server-only";

import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import { GUEST_ANALYSIS_RUNS, GUEST_MEETING_LIMIT, GUEST_TRANSCRIBE_RUNS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Guests are Supabase anonymous users: a real account with no email, and no
 * way back in once they sign out. Every meeting one processes costs GPU time
 * and Claude calls, and anyone can make a guest, so a guest gets one meeting
 * and a few tries at each paid step of it. Continuing with Google moves
 * everything the guest made into the Google account (adoptGuest), and the
 * limits no longer apply.
 *
 * The limits are counted in guest_meetings by the server (migration 0006),
 * never read from meetings or job rows: a guest can rewrite those through
 * row level security. GUEST_MEETING_LIMIT 0 lets a guest look around without
 * processing anything.
 */

const LIMIT_MESSAGE =
  "A guest account can process one meeting. Continue with Google, from the banner at the top, to process more: your meetings come with you.";
const USED_UP_MESSAGE =
  "A guest account can only try this a few times. Continue with Google, from the banner at the top, to carry on: your meetings come with you.";
const NONE_MESSAGE =
  "A guest account can look around but not process meetings. Continue with Google, from the banner at the top, to start.";
const SETUP_MESSAGE =
  "Guest accounts are not set up on this database yet. Run supabase/migrations/0006_guest_meetings.sql in the Supabase SQL editor.";

/**
 * Every refusal from the limits below. A route that marks its meeting failed
 * on errors skips that for these: refusing a sixth regeneration must not
 * turn a finished meeting into a failed one.
 */
export class GuestRefusal extends ApiError {}

export function isGuest(user: Pick<User, "is_anonymous">): boolean {
  return user.is_anonymous === true;
}

/**
 * Whether a guest may still start a meeting, for the banner and the
 * new-meeting page, so nobody records a whole meeting only to be refused at
 * the end. Once per request. A database without 0006 says yes here and is
 * refused, with the setup message, where it counts.
 */
export const guestCanStartMeeting = cache(async (userId: string): Promise<boolean> => {
  if (GUEST_MEETING_LIMIT === 0) return false;
  const { data, error } = await createAdminClient()
    .from("guest_meetings")
    .select("meeting_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[guest] could not read guest_meetings", error.message);
    return true;
  }
  return !data;
});

/**
 * For POST /api/meetings: says so before the upload rather than after it.
 * Not the real gate (a guest can insert a meeting row straight through RLS);
 * the charges below are.
 */
export async function assertGuestMayStart(admin: SupabaseClient, user: User) {
  if (!isGuest(user)) return;
  if (GUEST_MEETING_LIMIT === 0) throw new GuestRefusal(NONE_MESSAGE, 403);

  const { data, error } = await admin
    .from("guest_meetings")
    .select("meeting_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[guest] could not read guest_meetings", error.message);
    throw new GuestRefusal(SETUP_MESSAGE, 503);
  }
  if (data) throw new GuestRefusal(LIMIT_MESSAGE, 403);
}

type Kind = "claim" | "transcribe" | "analyze" | "refund_transcribe";

async function charge(admin: SupabaseClient, user: User, meetingId: string, kind: Kind) {
  if (!isGuest(user)) return;
  if (GUEST_MEETING_LIMIT === 0) throw new GuestRefusal(NONE_MESSAGE, 403);

  const { data, error } = await admin.rpc("rapport_guest_charge", {
    p_user: user.id,
    p_meeting: meetingId,
    p_kind: kind,
    p_transcribe_limit: GUEST_TRANSCRIBE_RUNS,
    p_analyze_limit: GUEST_ANALYSIS_RUNS,
  });
  if (error) {
    console.error("[guest] could not charge", kind, meetingId, error.message);
    throw new GuestRefusal(SETUP_MESSAGE, 503);
  }
  if (data === "other_meeting") throw new GuestRefusal(LIMIT_MESSAGE, 403);
  if (data === "used_up") throw new GuestRefusal(USED_UP_MESSAGE, 403);
  if (data !== "ok") {
    console.error("[guest] unexpected answer from rapport_guest_charge", data);
    throw new GuestRefusal(SETUP_MESSAGE, 503);
  }
}

/**
 * At the top of /process: makes this meeting the guest's one, or refuses if
 * another meeting already is, before anything else happens. Counts nothing,
 * so asking about a job that is already running stays free. Atomic: two
 * meetings processed at the same moment cannot both claim it.
 */
export function claimGuestMeeting(admin: SupabaseClient, user: User, meetingId: string) {
  return charge(admin, user, meetingId, "claim");
}

/**
 * Right before a paid step, for a guest: claims the meeting as above and
 * counts one try, refusing once GUEST_TRANSCRIBE_RUNS or GUEST_ANALYSIS_RUNS
 * are used. "transcribe" is a /process call that starts GPU work or reuses
 * a stored transcript (which runs speaker mapping on Claude again), and is
 * refused as well once the reports are used up, since its transcript could
 * go nowhere; "analyze" is one Claude report from /analyze or /regenerate.
 * Members pass straight through.
 */
export function chargeGuest(
  admin: SupabaseClient,
  user: User,
  meetingId: string,
  kind: "transcribe" | "analyze",
) {
  return charge(admin, user, meetingId, kind);
}

/**
 * Gives back a "transcribe" try that spent nothing: the GPU service turned
 * the job down, or another request had started it a moment before. Never
 * throws; the worst a failure here does is cost the guest one try.
 */
export async function refundGuestTranscription(
  admin: SupabaseClient,
  user: User,
  meetingId: string,
) {
  try {
    await charge(admin, user, meetingId, "refund_transcribe");
  } catch (err) {
    console.error("[guest] could not refund a transcription", meetingId, err);
  }
}

/**
 * A guest pressed Continue with Google and came back signed in as memberId.
 * Moves everything the guest made into that account and deletes the guest,
 * unless the account already has meetings, companies or people of its own,
 * or a password ("kept": nothing changed). "error" when the database could
 * not do it, usually because migration 0006 has not been run.
 */
export async function adoptGuest(
  admin: SupabaseClient,
  guestId: string,
  memberId: string,
): Promise<"moved" | "kept" | "error"> {
  const { data, error } = await admin.rpc("rapport_adopt_guest", {
    p_guest: guestId,
    p_member: memberId,
  });
  if (error) {
    console.error("[guest] could not move the guest", guestId, "into", memberId, error.message);
    return "error";
  }
  return data === "moved" ? "moved" : "kept";
}
