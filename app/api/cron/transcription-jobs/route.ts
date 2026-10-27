import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { reconcileMeeting } from "@/lib/asr/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Carrying a finished job on to speaker mapping can take a minute, so stop
 * starting new meetings after this and leave the rest for the next run (or
 * for /status, the moment someone opens one).
 */
const BUDGET_MS = 150_000;

/**
 * Safety net for lost callbacks on meetings nobody has open: for every
 * meeting still at `transcribing`, asks the GPU service about its job, gives
 * up on one older than the timeout, and fails one whose transcript arrived
 * but was never saved, so its Retry button shows. An open page does the same
 * through /status, so this only matters for a tab that was closed.
 *
 * Vercel Cron calls it with `Authorization: Bearer $CRON_SECRET`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const started = Date.now();
  const admin = createAdminClient();
  const { data: meetings } = await admin
    .from("meetings")
    .select("id")
    .eq("status", "transcribing")
    .order("created_at", { ascending: true })
    .limit(100);

  let checked = 0;
  for (const meeting of meetings ?? []) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      await reconcileMeeting(admin, meeting.id);
    } catch (err) {
      console.error("[cron] reconcile failed", meeting.id, err);
    }
    checked++;
  }

  const left = (meetings?.length ?? 0) - checked;
  if (left > 0) console.warn(`[cron] out of time; ${left} meeting(s) left for the next run`);

  return NextResponse.json({ checked, left });
}
