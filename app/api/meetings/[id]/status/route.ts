import { NextResponse } from "next/server";

import { apiError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileMeeting } from "@/lib/asr/jobs";
import { TRANSCRIBE_BACKEND } from "@/lib/ai/transcribe";

export const runtime = "nodejs";
// a quiet GPU job that turns out to be done is carried on to speaker mapping here
export const maxDuration = 300;

/** Polled every few seconds by the processing screen (spec 3). */
export async function GET(_request: Request, ctx: RouteContext<"/api/meetings/[id]/status">) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);

    // A GPU job that has gone quiet is asked about here, so an open page
    // keeps things moving even if a callback was lost.
    let current = meeting;
    if (meeting.status === "transcribing" && TRANSCRIBE_BACKEND === "jobs") {
      try {
        await reconcileMeeting(createAdminClient(), id);
        current = await requireOwnedMeeting(id, user.id);
      } catch (err) {
        console.warn("[status] reconcile failed", id, err);
      }
    }

    const supabase = await createClient();
    const { data: chunks } = await supabase
      .from("transcription_chunks")
      .select("status")
      .eq("meeting_id", id);

    return NextResponse.json({
      status: current.status,
      progress_note: current.progress_note,
      error: current.error,
      chunks: {
        done: (chunks ?? []).filter((c) => c.status === "done").length,
        total: (chunks ?? []).length,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
