import { NextResponse } from "next/server";

import { ApiError, apiError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AUDIO_BUCKET } from "@/lib/constants";

export const runtime = "nodejs";

/**
 * Delete the recording but keep the transcript and report.
 *
 * This is the manual version of the "delete audio after processing" default.
 * It is one-way: re-transcribing needs the audio, so the meeting detail page
 * warns before calling this.
 */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/meetings/[id]/audio">) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);

    if (!meeting.audio_path || meeting.audio_deleted_at) {
      return NextResponse.json({ ok: true, alreadyDeleted: true });
    }

    const admin = createAdminClient();
    const { error } = await admin.storage
      .from(AUDIO_BUCKET)
      .remove([meeting.audio_path]);

    if (error) throw new ApiError(error.message, 500);

    const supabase = await createClient();
    await supabase
      .from("meetings")
      .update({ audio_deleted_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
