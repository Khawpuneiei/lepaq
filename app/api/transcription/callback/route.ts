import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { applyJobReport, verifyCallbackSignature, type JobReport } from "@/lib/asr/jobs";

export const runtime = "nodejs";
// a finished job goes straight on to the speaker-mapping call
export const maxDuration = 300;

/**
 * The GPU service reports a finished (or failed) transcription job here.
 *
 * There is no user session: the HMAC signature over the raw body is the only
 * credential, so it is checked before the body is even parsed. The service
 * retries a 5xx or a network error (1, 4, 16 s) and gives up on any 4xx; a
 * callback that never lands is picked up by the /status poll instead.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  const ok = verifyCallbackSignature(
    raw,
    request.headers.get("x-lepaq-timestamp"),
    request.headers.get("x-lepaq-signature"),
  );
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let report: JobReport;
  try {
    report = JSON.parse(raw) as JobReport;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof report.job_id !== "string" || !["done", "failed"].includes(report.status)) {
    return NextResponse.json({ error: "job_id and a final status are required" }, { status: 400 });
  }

  const known = await applyJobReport(createAdminClient(), report);
  if (!known) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
