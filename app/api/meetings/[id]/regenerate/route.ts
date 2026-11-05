import { NextResponse } from "next/server";

import { ApiError, apiError, friendlyError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAnalysis } from "@/lib/pipeline/runAnalysis";
import { chargeGuest, GuestRefusal } from "@/lib/auth/guest";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Re-run the analysis over the current transcript.
 *
 * Used after fixing a speaker in the transcript, or after striking a line.
 * It costs one LLM call and no transcription, because the audio is usually
 * gone by now and the transcript is the source of truth either way.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/meetings/[id]/regenerate">) {
  const { id } = await ctx.params;
  // Built inside a try: thrown out here, a missing setting would reach the
  // browser as an empty 500 ("Unexpected end of JSON input"), naming nothing.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return apiError(err);
  }

  try {
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);

    if (!["review", "ready", "failed", "analyzing"].includes(meeting.status)) {
      throw new ApiError(
        "Confirm the speakers first — there is nothing to regenerate yet.",
        409,
      );
    }
    // a guest's Claude reports are counted, as in /analyze
    await chargeGuest(admin, user, id, "analyze");

    const result = await runAnalysis(admin, id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // a guest over the limit is told so; the meeting stays as it was
    if (!(err instanceof GuestRefusal)) {
      await admin
        .from("meetings")
        .update({ status: "failed", error: friendlyError(err), progress_note: null })
        .eq("id", id);
    }
    return apiError(err);
  }
}
