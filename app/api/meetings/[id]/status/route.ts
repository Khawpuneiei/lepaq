import { NextResponse } from "next/server";

import { apiError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Polled every few seconds by the processing screen (spec 3). */
export async function GET(_request: Request, ctx: RouteContext<"/api/meetings/[id]/status">) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);

    const supabase = await createClient();
    const { data: chunks } = await supabase
      .from("transcription_chunks")
      .select("status")
      .eq("meeting_id", id);

    return NextResponse.json({
      status: meeting.status,
      progress_note: meeting.progress_note,
      error: meeting.error,
      chunks: {
        done: (chunks ?? []).filter((c) => c.status === "done").length,
        total: (chunks ?? []).length,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
