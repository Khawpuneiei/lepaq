import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileJob } from "@/lib/asr/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Safety net for lost callbacks on meetings nobody has open: asks the GPU
 * service about every job still queued or running, and gives up on any older
 * than an hour. An open processing screen does the same through /status, so
 * this only matters for a tab that was closed.
 *
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: jobs } = await admin
    .from("transcription_jobs")
    .select("id, meeting_id, created_at, checked_at")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(50);

  for (const job of jobs ?? []) {
    try {
      await reconcileJob(admin, job);
    } catch (err) {
      console.error("[cron] reconcile failed", job.id, err);
    }
  }

  return NextResponse.json({ checked: jobs?.length ?? 0 });
}
