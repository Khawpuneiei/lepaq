import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError, friendlyError } from "@/lib/api";
import { AUDIO_BUCKET } from "@/lib/constants";
import { readEnv } from "@/lib/env";
import type { RawSegment, SpeakerEmbedding } from "@/lib/ai/transcribe";
import { finishTranscription } from "@/lib/pipeline/finishTranscription";

/**
 * Whole-file transcription jobs on the GPU service (WhisperLah + pyannote on
 * Modal). The contract, agreed with the service:
 *
 *   POST {WHISPERLAH_URL}/jobs       bearer WHISPERLAH_TOKEN, {job_id, audio_url, callback_url, mode, num_speakers?}
 *                                    -> 202 {job_id, status}; re-posting a job_id never queues twice
 *   GET  {WHISPERLAH_URL}/jobs/{id}  -> {job_id, status, attempts, model_version, error?, result?}
 *   POST callback_url                X-Lepaq-Timestamp + X-Lepaq-Signature: v1=<hex HMAC-SHA256(CALLBACK_SECRET, "{ts}.{raw body}")>
 *                                    body {job_id, status: done|failed, model_version, error?, result?}
 *
 * One request for the whole recording, so there are no parts, no resume
 * rounds, no 300 s function limit to fit inside, and speaker A is the same
 * person all meeting.
 *
 * The GPU scales to zero when idle, so the first job after a quiet spell
 * waits for one to start: about 4 minutes in all on Modal's L4, against
 * under a minute warm. The meeting says so meanwhile (COLD_START_NOTE)
 * instead of looking stuck.
 */

/** Long enough for the queue, a cold start, and the service's two retries. */
const AUDIO_URL_TTL_SECONDS = 6 * 60 * 60;

/** Ask the service about a job we have not heard from for this long. */
export const JOB_QUIET_MS = 2 * 60 * 1000;

/**
 * Stop waiting for a job after this long. A transcript that turns up later
 * is still used (see LOCAL_FAILURES), so this only decides how long the
 * user looks at a spinner before being offered Retry.
 */
export const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/**
 * Longer than any function may run (maxDuration 300 s). A meeting still
 * being finished from a job's transcript after this was cut off part way.
 */
export const FINISH_STALL_MS = 6 * 60 * 1000;

/** Reject callbacks signed further than this from our clock. */
const SIGNATURE_SKEW_SECONDS = 300;

const POST_TIMEOUT_MS = 30_000;
const GET_TIMEOUT_MS = 15_000;

export const COLD_START_NOTE = "Waiting for the GPU to start (up to about 4 minutes)";

const TIMED_OUT = "Transcription took more than two hours and was stopped. Press Retry.";
const UNREACHABLE = "Could not reach the transcription service. Press Retry.";
const STALLED = "Saving the transcript was interrupted. Press Retry.";

/**
 * Failures we decided on, not the service. Either way the service may still
 * finish the job, and if it does, the transcript is taken.
 */
const LOCAL_FAILURES = [TIMED_OUT, UNREACHABLE];

export interface JobResult {
  duration: number;
  language?: string;
  segments: { speaker: string; start: number; end: number; text: string }[];
  speakers?: Record<string, SpeakerEmbedding>;
}

export interface JobReport {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  model_version?: string | null;
  error?: string | null;
  result?: JobResult | null;
}

type JobRow = {
  id: string;
  meeting_id: string;
  status: JobReport["status"];
  created_at: string;
  checked_at: string;
  completed_at: string | null;
};

const JOB_COLUMNS = "id, meeting_id, status, created_at, checked_at, completed_at";

function config() {
  const url = readEnv("WHISPERLAH_URL");
  const token = readEnv("WHISPERLAH_TOKEN");
  if (!url || !token) {
    throw new Error("TRANSCRIBE_BACKEND=jobs but WHISPERLAH_URL or WHISPERLAH_TOKEN is not set.");
  }
  return { url: url.replace(/\/$/, ""), token };
}

/**
 * Where the service reports back. A Vercel preview reports to its own
 * deployment, not to NEXT_PUBLIC_APP_URL (usually the production domain,
 * running older code). Deployment Protection answers anyone else on a
 * preview with a 401, so the project's automation bypass secret goes along
 * when there is one; without it the callback is refused and /status picks
 * the result up instead, a couple of minutes later.
 */
export function callbackUrl() {
  const preview = process.env.VERCEL_ENV === "preview" && process.env.VERCEL_URL;
  const base = preview ? `https://${process.env.VERCEL_URL}` : readEnv("NEXT_PUBLIC_APP_URL");
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not set, so the GPU service has nowhere to report back.");
  const url = new URL(`${base.replace(/\/$/, "")}/api/transcription/callback`);
  if (preview && process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    url.searchParams.set("x-vercel-protection-bypass", process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  }
  return url.toString();
}

function isJobResult(value: unknown): value is JobResult {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as JobResult).segments)
  );
}

export type ProcessOutcome =
  | { complete: true; reused: true; segments: number; speakers: number }
  | { complete: false; queued: true; job_id: string };

/**
 * What /process does on this backend. In order:
 *  1. a job for this meeting is still on the GPU: say so, start nothing;
 *  2. the GPU already transcribed it and a later step failed: carry on from
 *     the stored transcript, which costs no GPU time and needs no audio;
 *  3. otherwise send the recording as a new job.
 */
export async function processWithJob(
  admin: SupabaseClient,
  meeting: {
    id: string;
    status: string;
    audio_path: string | null;
    audio_deleted_at: string | null;
  },
  now = Date.now(),
): Promise<ProcessOutcome> {
  const { data: latest } = await admin
    .from("transcription_jobs")
    .select(`${JOB_COLUMNS}, result`)
    .eq("meeting_id", meeting.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<JobRow & { result: unknown }>();

  if (
    latest &&
    (latest.status === "queued" || latest.status === "running") &&
    now - new Date(latest.created_at).getTime() < JOB_TIMEOUT_MS
  ) {
    await admin
      .from("meetings")
      .update({
        status: "transcribing",
        error: null,
        progress_note: latest.status === "running" ? "Transcribing" : COLD_START_NOTE,
      })
      .eq("id", meeting.id);
    return { complete: false, queued: true, job_id: latest.id };
  }

  if (latest?.status === "done" && isJobResult(latest.result)) {
    const completedAt = latest.completed_at ? new Date(latest.completed_at).getTime() : 0;
    // the callback (or a poll) is saving it right now
    if (meeting.status === "transcribing" && now - completedAt < FINISH_STALL_MS) {
      return { complete: false, queued: true, job_id: latest.id };
    }

    // Take it over. Moving completed_at is the lease: a second Retry fails
    // this update, and the stall check measures from here.
    let lease = admin
      .from("transcription_jobs")
      .update({ completed_at: new Date(now).toISOString() })
      .eq("id", latest.id);
    lease = latest.completed_at ? lease.eq("completed_at", latest.completed_at) : lease.is("completed_at", null);
    const { data: leased } = await lease.select("id");
    if (!leased?.length) return { complete: false, queued: true, job_id: latest.id };

    await admin
      .from("meetings")
      .update({ status: "transcribing", error: null, progress_note: "Saving the transcript" })
      .eq("id", meeting.id);

    const done = await finishFromJobResult(admin, meeting.id, latest.result);
    if (!done) throw new ApiError("The meeting changed while the transcript was being saved.", 409);
    return { complete: true, reused: true, ...done };
  }

  if (!meeting.audio_path) {
    throw new ApiError("No audio was uploaded for this meeting.", 400);
  }
  if (meeting.audio_deleted_at) {
    throw new ApiError(
      "The audio for this meeting has been deleted, so it cannot be transcribed again.",
      410,
    );
  }

  // status first: a callback only carries forward a meeting that is transcribing
  await admin
    .from("meetings")
    .update({ status: "transcribing", error: null, progress_note: COLD_START_NOTE })
    .eq("id", meeting.id);

  const jobId = await startTranscriptionJob(admin, { id: meeting.id, audio_path: meeting.audio_path }, now);
  return { complete: false, queued: true, job_id: jobId };
}

/**
 * Create a job for this meeting's recording and hand it to the service.
 * Returns once the service has queued it; the transcript arrives later.
 */
export async function startTranscriptionJob(
  admin: SupabaseClient,
  meeting: { id: string; audio_path: string },
  now = Date.now(),
): Promise<string> {
  // everything that can fail on its own goes before the insert, so a
  // misconfiguration never leaves a job row behind
  const { url, token } = config();
  const callback = callbackUrl();

  const { data: signed, error: signError } = await admin.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(meeting.audio_path, AUDIO_URL_TTL_SECONDS);
  if (signError || !signed) {
    throw new Error(`Could not sign the audio URL: ${signError?.message ?? "no URL returned"}`);
  }

  const { count: participantCount } = await admin
    .from("meeting_participants")
    .select("id", { head: true, count: "exact" })
    .eq("meeting_id", meeting.id);

  // Only one open job per meeting (a unique index says so). One that has run
  // past the timeout without anyone noticing is given up on here.
  await admin
    .from("transcription_jobs")
    .update({ status: "failed", error: TIMED_OUT, completed_at: new Date(now).toISOString() })
    .eq("meeting_id", meeting.id)
    .in("status", ["queued", "running"])
    .lt("created_at", new Date(now - JOB_TIMEOUT_MS).toISOString());

  const { data: job, error: insertError } = await admin
    .from("transcription_jobs")
    .insert({ meeting_id: meeting.id })
    .select("id")
    .single();
  if (insertError?.code === "23505") {
    // a second click a moment ago already started one
    const { data: open } = await admin
      .from("transcription_jobs")
      .select("id")
      .eq("meeting_id", meeting.id)
      .in("status", ["queued", "running"])
      .maybeSingle();
    if (open) return open.id as string;
  }
  if (insertError || !job) {
    throw new Error(`Could not record the transcription job: ${insertError?.message ?? "no row"}`);
  }

  let res: Response;
  try {
    res = await fetch(`${url}/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        job_id: job.id,
        audio_url: signed.signedUrl,
        callback_url: callback,
        mode: process.env.WHISPERLAH_MODE === "near" ? "near" : "room",
        // the participant list is what the user told us; the diarizer still
        // decides on its own when nobody was listed
        ...(participantCount && participantCount > 1 ? { num_speakers: participantCount } : {}),
      }),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    // A timeout or a dropped connection: the service may have queued it all
    // the same, and if so its callback is still taken.
    console.warn("[asr] posting the job failed", job.id, err);
    await closeJob(admin, job.id, UNREACHABLE);
    throw new Error(UNREACHABLE);
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    const message = `The transcription service refused the job (${res.status}): ${detail}`;
    await closeJob(admin, job.id, message);
    throw new Error(message);
  }

  return job.id as string;
}

/** Ask the service where a job is. Used when a callback has not arrived. */
export async function fetchJobReport(jobId: string): Promise<JobReport> {
  const { url, token } = config();
  const res = await fetch(`${url}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(GET_TIMEOUT_MS),
  });
  if (res.status === 404) {
    return { job_id: jobId, status: "failed", error: "The transcription service has no record of this job." };
  }
  if (!res.ok) throw new Error(`Job status returned ${res.status}`);
  const body = (await res.json()) as JobReport;
  if (!["queued", "running", "done", "failed"].includes(body?.status)) {
    throw new Error(`Job status came back without a status it knows`);
  }
  return { ...body, job_id: jobId };
}

/**
 * Check a callback's signature against the raw request body. The comparison
 * is constant-time and a stale timestamp is refused, so a captured callback
 * cannot be replayed later.
 */
export function verifyCallbackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  now = Date.now(),
): boolean {
  const secret = process.env.CALLBACK_SECRET;
  if (!secret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > SIGNATURE_SKEW_SECONDS) return false;

  // anything but 64 hex characters is wrong, and checking that first keeps
  // odd bytes in the header away from timingSafeEqual
  const given = signature.startsWith("v1=") ? signature.slice(3) : "";
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(Buffer.from(given, "hex"), expected);
}

/**
 * Record what the service said about a job and, when it is finished, carry
 * the meeting forward. Safe to call twice for the same report (callback and
 * status poll can race): only the call that moves the job out of
 * queued/running does the work.
 *
 * Returns false when the job is unknown, so the callback can answer 404.
 */
export async function applyJobReport(admin: SupabaseClient, report: JobReport): Promise<boolean> {
  const { data: job } = await admin
    .from("transcription_jobs")
    .select("id, meeting_id, status, error")
    .eq("id", report.job_id)
    .maybeSingle();
  if (!job) return false;

  const now = new Date().toISOString();

  if (report.status === "queued" || report.status === "running") {
    await admin
      .from("transcription_jobs")
      .update({ status: report.status, checked_at: now, model_version: report.model_version ?? null })
      .eq("id", job.id)
      .in("status", ["queued", "running"]);
    if (report.status === "running") {
      await admin
        .from("meetings")
        .update({ progress_note: "Transcribing" })
        .eq("id", job.meeting_id)
        .eq("status", "transcribing");
    }
    return true;
  }

  if (report.status === "done" && !isJobResult(report.result)) {
    report = {
      ...report,
      status: "failed",
      error: "The transcription service reported success but sent no transcript.",
    };
  }

  // Claim the job: whichever caller moves it out of queued/running first
  // does the rest, and a duplicate gets no row back and stops here. A
  // transcript for a job we gave up on ourselves is claimed the same way.
  const late =
    report.status === "done" && job.status === "failed" && LOCAL_FAILURES.includes(job.error);
  const claim = admin
    .from("transcription_jobs")
    .update({
      status: report.status,
      checked_at: now,
      completed_at: now,
      model_version: report.model_version ?? null,
      error: report.status === "failed" ? (report.error ?? "Transcription failed.") : null,
      // Kept until the meeting is analysed, so a Retry after a later step
      // fails starts from here instead of paying for the GPU again.
      result: report.status === "done" ? report.result : null,
    })
    .eq("id", job.id);
  const { data: claimed } = await (late
    ? claim.eq("status", "failed").eq("error", job.error)
    : claim.in("status", ["queued", "running"])
  ).select("id");
  if (!claimed || claimed.length === 0) return true;

  // A newer job for the same meeting (the user pressed Retry) wins; this
  // one's answer is no longer wanted.
  if (!(await isLatestJob(admin, job))) return true;

  if (report.status === "failed") {
    await failMeeting(admin, job.meeting_id, report.error ?? "Transcription failed on the GPU service.");
    return true;
  }

  if (late) {
    // the meeting was told this job failed; it has not, so pick it back up
    const { data: revived } = await admin
      .from("meetings")
      .update({ status: "transcribing", error: null, progress_note: "Saving the transcript" })
      .eq("id", job.meeting_id)
      .eq("status", "failed")
      .select("id");
    if (!revived?.length) return true;
  }

  try {
    await finishFromJobResult(admin, job.meeting_id, report.result as JobResult);
  } catch (err) {
    await failMeeting(admin, job.meeting_id, friendlyError(err));
  }
  return true;
}

/**
 * Write a job's transcript to the meeting and propose who is who. Leaves a
 * meeting that is no longer transcribing alone and returns null. Throws if
 * the transcript cannot be saved.
 */
export async function finishFromJobResult(
  admin: SupabaseClient,
  meetingId: string,
  result: JobResult,
): Promise<{ segments: number; speakers: number } | null> {
  const { data: meeting } = await admin
    .from("meetings")
    .select("id, owner_id, title, short_note, meeting_date, audio_path, status")
    .eq("id", meetingId)
    .maybeSingle();
  if (!meeting || meeting.status !== "transcribing") return null;

  if (Number.isFinite(result.duration)) {
    await admin
      .from("meetings")
      .update({ duration_sec: Math.round(result.duration) || null })
      .eq("id", meeting.id);
  }

  // one request for the whole file: labels are already meeting-wide
  const segments: RawSegment[] = result.segments
    .map((s) => ({
      chunkIndex: 0,
      rawSpeakerLabel: s.speaker,
      startSec: s.start,
      endSec: s.end,
      text: (s.text ?? "").trim(),
    }))
    .filter((s) => s.text.length > 0);

  return finishTranscription({
    admin,
    meeting,
    segments,
    embeddings: Object.entries(result.speakers ?? {}).map(([label, v]) => ({
      label,
      model: v?.model,
      embedding: Array.isArray(v?.embedding) ? v.embedding : [],
    })),
    chunked: false,
  });
}

/**
 * For a meeting at `transcribing` on this backend: keep it moving without
 * relying on the callback. Called from /status (so an open page carries on
 * even if a callback is lost) and from the daily cron.
 *
 *  - newest job still open: ask the service about it once it has gone
 *    quiet, and give up after JOB_TIMEOUT_MS;
 *  - newest job done but the meeting never got past `transcribing`: the call
 *    saving it was cut off, so fail the meeting and let Retry resume from the
 *    stored transcript.
 */
export async function reconcileMeeting(
  admin: SupabaseClient,
  meetingId: string,
  now = Date.now(),
): Promise<void> {
  const { data: job } = await admin
    .from("transcription_jobs")
    .select(JOB_COLUMNS)
    .eq("meeting_id", meetingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<JobRow>();
  if (!job) return;

  if (job.status === "queued" || job.status === "running") {
    await reconcileJob(admin, job, now);
    return;
  }

  if (
    job.status === "done" &&
    job.completed_at &&
    now - new Date(job.completed_at).getTime() > FINISH_STALL_MS
  ) {
    await failMeeting(admin, meetingId, STALLED);
  }
}

/** Ask the service about one open job that has gone quiet. */
export async function reconcileJob(
  admin: SupabaseClient,
  job: Pick<JobRow, "id" | "created_at" | "checked_at">,
  now = Date.now(),
): Promise<void> {
  if (now - new Date(job.checked_at).getTime() < JOB_QUIET_MS) return;

  // mark it checked first so concurrent polls do not all ask at once
  await admin
    .from("transcription_jobs")
    .update({ checked_at: new Date(now).toISOString() })
    .eq("id", job.id);

  let report: JobReport;
  try {
    report = await fetchJobReport(job.id);
  } catch (err) {
    console.warn("[asr] status poll failed", job.id, err);
    report = { job_id: job.id, status: "running" };
  }

  if (
    (report.status === "queued" || report.status === "running") &&
    now - new Date(job.created_at).getTime() > JOB_TIMEOUT_MS
  ) {
    report = { job_id: job.id, status: "failed", error: TIMED_OUT };
  }

  await applyJobReport(admin, report);
}

async function isLatestJob(admin: SupabaseClient, job: { id: string; meeting_id: string }) {
  const { data: latest } = await admin
    .from("transcription_jobs")
    .select("id")
    .eq("meeting_id", job.meeting_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !latest || latest.id === job.id;
}

async function closeJob(admin: SupabaseClient, jobId: string, error: string) {
  await admin
    .from("transcription_jobs")
    .update({ status: "failed", error, completed_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["queued", "running"]);
}

/** Only a meeting still waiting on transcription is this job's to fail. */
async function failMeeting(admin: SupabaseClient, meetingId: string, error: string) {
  await admin
    .from("meetings")
    .update({ status: "failed", error, progress_note: null })
    .eq("id", meetingId)
    .eq("status", "transcribing");
}
