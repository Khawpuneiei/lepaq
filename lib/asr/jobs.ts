import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { friendlyError } from "@/lib/api";
import { AUDIO_BUCKET } from "@/lib/constants";
import type { RawSegment, SpeakerEmbedding } from "@/lib/ai/transcribe";
import { finishTranscription } from "@/lib/pipeline/finishTranscription";

/**
 * Whole-file transcription jobs on the GPU service (WhisperLah + pyannote on
 * Modal). The contract, agreed with the service:
 *
 *   POST {ASR_URL}/jobs        bearer ASR_API_TOKEN, {job_id, audio_url, callback_url, mode, num_speakers?}
 *                              -> 202 {job_id, status}; re-posting a job_id never queues twice
 *   GET  {ASR_URL}/jobs/{id}   -> {job_id, status, attempts, model_version, error?, result?}
 *   POST callback_url          X-Lepaq-Timestamp + X-Lepaq-Signature: v1=<hex HMAC-SHA256(ASR_CALLBACK_SECRET, "{ts}.{raw body}")>
 *                              body {job_id, status: done|failed, model_version, error?, result?}
 *
 * One request for the whole recording, so there are no parts, no resume
 * rounds, no 300 s function limit to fit inside, and speaker A is the same
 * person all meeting.
 */

/** Long enough for the queue, a cold start, and the service's two retries. */
const AUDIO_URL_TTL_SECONDS = 6 * 60 * 60;

/** Ask the service about a job we have not heard from for this long. */
export const JOB_QUIET_MS = 2 * 60 * 1000;

/** Give up on a job that has not finished after this long. */
export const JOB_TIMEOUT_MS = 60 * 60 * 1000;

/** Reject callbacks signed further than this from our clock. */
const SIGNATURE_SKEW_SECONDS = 300;

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

function config() {
  const url = process.env.ASR_URL;
  const token = process.env.ASR_API_TOKEN;
  if (!url || !token) {
    throw new Error("TRANSCRIBE_BACKEND=jobs but ASR_URL or ASR_API_TOKEN is not set.");
  }
  return { url: url.replace(/\/$/, ""), token };
}

function callbackUrl() {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) throw new Error("NEXT_PUBLIC_APP_URL is not set, so the GPU service has nowhere to report back.");
  return `${base.replace(/\/$/, "")}/api/transcription/callback`;
}

/**
 * Create a job for this meeting's recording and hand it to the service.
 * Returns once the service has queued it; the transcript arrives later.
 */
export async function startTranscriptionJob(
  admin: SupabaseClient,
  meeting: { id: string; audio_path: string },
): Promise<string> {
  const { url, token } = config();

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

  const { data: job, error: insertError } = await admin
    .from("transcription_jobs")
    .insert({ meeting_id: meeting.id })
    .select("id")
    .single();
  if (insertError || !job) {
    throw new Error(`Could not record the transcription job: ${insertError?.message ?? "no row"}`);
  }

  const res = await fetch(`${url}/jobs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: job.id,
      audio_url: signed.signedUrl,
      callback_url: callbackUrl(),
      mode: process.env.WHISPERLAH_MODE === "near" ? "near" : "room",
      // the participant list is what the user told us; the diarizer still
      // decides on its own when nobody was listed
      ...(participantCount && participantCount > 1 ? { num_speakers: participantCount } : {}),
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    const message = `The transcription service refused the job (${res.status}): ${detail}`;
    await admin
      .from("transcription_jobs")
      .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    throw new Error(message);
  }

  return job.id as string;
}

/** Ask the service where a job is. Used when a callback has not arrived. */
export async function fetchJobReport(jobId: string): Promise<JobReport> {
  const { url, token } = config();
  const res = await fetch(`${url}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    return { job_id: jobId, status: "failed", error: "The transcription service has no record of this job." };
  }
  if (!res.ok) throw new Error(`Job status returned ${res.status}`);
  return (await res.json()) as JobReport;
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
  const secret = process.env.ASR_CALLBACK_SECRET;
  if (!secret || !timestamp || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > SIGNATURE_SKEW_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const given = signature.startsWith("v1=") ? signature.slice(3) : "";
  if (given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(given, "utf8"), Buffer.from(expected, "utf8"));
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
    .select("id, meeting_id, status")
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

  // Claim the job: whichever caller flips it to done/failed first does the
  // rest; a duplicate gets no row back and stops here.
  const { data: claimed } = await admin
    .from("transcription_jobs")
    .update({
      status: report.status,
      checked_at: now,
      completed_at: now,
      model_version: report.model_version ?? null,
      error: report.status === "failed" ? (report.error ?? "Transcription failed.") : null,
    })
    .eq("id", job.id)
    .in("status", ["queued", "running"])
    .select("id");
  if (!claimed || claimed.length === 0) return true;

  // A newer job for the same meeting (the user pressed Retry) wins; this
  // one's answer is no longer wanted.
  const { data: latest } = await admin
    .from("transcription_jobs")
    .select("id")
    .eq("meeting_id", job.meeting_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest && latest.id !== job.id) return true;

  if (report.status === "failed") {
    await failMeeting(admin, job.meeting_id, report.error ?? "Transcription failed on the GPU service.");
    return true;
  }

  const { data: meeting } = await admin
    .from("meetings")
    .select("id, owner_id, title, short_note, meeting_date, audio_path, status")
    .eq("id", job.meeting_id)
    .maybeSingle();
  if (!meeting || meeting.status !== "transcribing") return true;

  try {
    const result = report.result;
    if (!result || !Array.isArray(result.segments)) {
      throw new Error("The transcription service reported success but sent no transcript.");
    }

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

    await finishTranscription({
      admin,
      meeting,
      segments,
      embeddings: Object.entries(result.speakers ?? {}).map(([label, v]) => ({
        label,
        model: v.model,
        embedding: Array.isArray(v.embedding) ? v.embedding : [],
      })),
      chunked: false,
    });
  } catch (err) {
    await failMeeting(admin, meeting.id, friendlyError(err));
  }
  return true;
}

/**
 * For a meeting still transcribing on the GPU service: if its newest job has
 * gone quiet, ask the service about it, and give up on it after
 * JOB_TIMEOUT_MS. Called from /status (so an open processing screen keeps
 * things moving even if a callback is lost) and from the daily cron.
 */
export async function reconcileJob(
  admin: SupabaseClient,
  job: { id: string; meeting_id: string; created_at: string; checked_at: string },
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
    report = {
      job_id: job.id,
      status: "failed",
      error: "Transcription took more than an hour and was stopped. Press Retry.",
    };
  }

  await applyJobReport(admin, report);
}

async function failMeeting(admin: SupabaseClient, meetingId: string, error: string) {
  await admin
    .from("meetings")
    .update({ status: "failed", error, progress_note: null })
    .eq("id", meetingId);
}
