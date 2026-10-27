import { NextResponse } from "next/server";

import { apiError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileJob } from "@/lib/asr/jobs";

export const runtime = "nodejs";
// a quiet GPU job that turns out to be done is carried on to speaker mapping here
export const maxDuration = 300;

/** Polled every few seconds by the processing screen (spec 3). */
export async function GET(_request: Request, ctx: RouteContext<"/api/meetings/[id]/status">) {
  try {
    const { id } = await ctx.params;
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);

    // A GPU job that has gone quiet is asked about here, so an open
    // processing screen keeps things moving even if a callback was lost.
    if (meeting.status === "transcribing") {
      const admin = createAdminClient();
      const { data: job } = await admin
        .from("transcription_jobs")
        .select("id, meeting_id, created_at, checked_at")
        .eq("meeting_id", id)
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (job) {
        try {
          await reconcileJob(admin, job);
        } catch (err) {
          console.warn("[status] reconcile failed", job.id, err);
        }
      }
    }

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
