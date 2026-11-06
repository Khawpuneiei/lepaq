import { NextResponse } from "next/server";

import { ApiError, apiError, friendlyError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { AUDIO_BUCKET, CHUNK_TARGET_BYTES } from "@/lib/constants";
import { cleanupWorkDir, prepareAudio, type AudioPart } from "@/lib/audio/chunk";
import { mapWithConcurrency } from "@/lib/concurrency";
import {
  TRANSCRIBE_BACKEND,
  transcribePart,
  type RawSegment,
  type SpeakerEmbedding,
} from "@/lib/ai/transcribe";
import { finishTranscription } from "@/lib/pipeline/finishTranscription";
import { processWithJob } from "@/lib/asr/jobs";
import { chargeGuest, claimGuestMeeting, GuestRefusal, refundGuestTranscription } from "@/lib/auth/guest";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Stop starting new chunks after this and hand back {complete:false}. The
 * client immediately POSTs again, and the next invocation picks up the chunks
 * still marked pending. Well under maxDuration so an in-flight chunk has room
 * to land and be saved.
 */
const SOFT_DEADLINE_MS = 230_000;

/**
 * Transcribe and diarize, then propose a speaker mapping.
 *
 * On the GPU jobs backend (the default) this only starts one job for the
 * whole recording and returns {queued:true}; the result arrives through the
 * callback or the status poll. A Retry reuses a transcript the job already
 * made.
 *
 * On the per-part backend it does the work itself, and is safe to call
 * repeatedly: work already done is stored per part, so a second call resumes
 * rather than restarting. That is what makes long recordings survive the
 * Vercel function ceiling there.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/meetings/[id]/process">) {
  const started = Date.now();
  const { id } = await ctx.params;
  // Built inside a try: thrown out here, a missing setting would reach the
  // browser as an empty 500 ("Unexpected end of JSON input"), naming nothing.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return apiError(err);
  }
  let workDir: string | null = null;

  try {
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);

    if (meeting.status === "review" || meeting.status === "ready") {
      throw new ApiError("This meeting has already been analysed.", 409);
    }

    // A guest gets one meeting, refused here before anything changes, and a
    // few tries at it, counted where the money is spent
    await claimGuestMeeting(admin, user, meeting.id);
    const spend = {
      charge: () => chargeGuest(admin, user, meeting.id, "transcribe"),
      refund: () => refundGuestTranscription(admin, user, meeting.id),
    };

    // ---- whole-file job on the GPU service ---------------------------------
    // Nothing is downloaded or split here: the service fetches the audio from
    // a signed URL and reports back to /api/transcription/callback. Calling
    // this again while a job is in flight does not start a second one, and a
    // Retry after a later step failed reuses the transcript it already made.
    if (TRANSCRIBE_BACKEND === "jobs") {
      return NextResponse.json(
        await processWithJob(admin, meeting, Date.now(), spend),
      );
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

    // every call here downloads and transcribes (or finishes) something
    await spend.charge();

    await admin
      .from("meetings")
      .update({ status: "transcribing", error: null, progress_note: "Preparing audio" })
      .eq("id", id);

    // ---- fetch the audio -------------------------------------------------
    const { data: blob, error: downloadError } = await admin.storage
      .from(AUDIO_BUCKET)
      .download(meeting.audio_path);

    if (downloadError || !blob) {
      throw new ApiError(
        "Could not read the uploaded audio. It may still be uploading — wait a moment and press Retry.",
        404,
      );
    }

    const buffer = Buffer.from(await blob.arrayBuffer());

    // ---- split if needed --------------------------------------------------
    const prepared = await prepareAudio(buffer, meeting.audio_path, {
      chunkSeconds: Number(process.env.AUDIO_CHUNK_SECONDS ?? 600),
      sizeLimitBytes: CHUNK_TARGET_BYTES,
    });
    workDir = prepared.workDir;

    await admin
      .from("meetings")
      .update({ duration_sec: Math.round(prepared.durationSec) || null })
      .eq("id", id);

    // Register every part. onConflict keeps rows from an earlier attempt,
    // including their stored segments, so resuming is free.
    await admin.from("transcription_chunks").upsert(
      prepared.parts.map((p) => ({
        meeting_id: id,
        chunk_index: p.index,
        start_sec: p.startSec,
        end_sec: p.endSec,
      })),
      { onConflict: "meeting_id,chunk_index", ignoreDuplicates: true },
    );

    const { data: chunkRows } = await admin
      .from("transcription_chunks")
      .select("chunk_index, status")
      .eq("meeting_id", id);

    const doneIndexes = new Set(
      (chunkRows ?? []).filter((c) => c.status === "done").map((c) => c.chunk_index),
    );
    const pending = prepared.parts.filter((p) => !doneIndexes.has(p.index));
    const total = prepared.parts.length;

    // ---- transcribe -------------------------------------------------------
    let deadlineHit = false;

    const runPart = async (part: AudioPart) => {
      if (Date.now() - started > SOFT_DEADLINE_MS) {
        deadlineHit = true;
        return;
      }

      await admin
        .from("transcription_chunks")
        .update({ status: "running", updated_at: new Date().toISOString() })
        .eq("meeting_id", id)
        .eq("chunk_index", part.index);

      try {
        const result = await transcribePart(part, {
          namespaceLabels: prepared.chunked,
        });

        await admin
          .from("transcription_chunks")
          .update({
            status: "done",
            segments: result.segments,
            speakers: result.speakers,
            error: null,
            updated_at: new Date().toISOString(),
          })
          .eq("meeting_id", id)
          .eq("chunk_index", part.index);

        doneIndexes.add(part.index);
        await admin
          .from("meetings")
          .update({
            progress_note:
              total > 1
                ? `Transcribed ${doneIndexes.size} of ${total} parts`
                : "Transcribing",
          })
          .eq("id", id);
      } catch (err) {
        await admin
          .from("transcription_chunks")
          .update({
            status: "failed",
            error: friendlyError(err),
            updated_at: new Date().toISOString(),
          })
          .eq("meeting_id", id)
          .eq("chunk_index", part.index);
        throw err;
      }
    };

    await mapWithConcurrency(
      pending,
      Math.max(1, Number(process.env.AUDIO_CHUNK_CONCURRENCY ?? 3)),
      runPart,
    );

    if (doneIndexes.size < total) {
      // Out of time, not out of luck. The client POSTs here again.
      await admin
        .from("meetings")
        .update({
          progress_note: `Transcribed ${doneIndexes.size} of ${total} parts`,
        })
        .eq("id", id);

      return NextResponse.json({
        complete: false,
        reason: deadlineHit ? "deadline" : "incomplete",
        done: doneIndexes.size,
        total,
      });
    }

    // ---- stitch ----------------------------------------------------------
    const { data } = await admin
      .from("transcription_chunks")
      .select("chunk_index, segments, speakers")
      .eq("meeting_id", id)
      .order("chunk_index", { ascending: true });
    const finished = (data ?? []) as unknown as {
      chunk_index: number;
      segments: RawSegment[] | null;
      speakers?: Record<string, SpeakerEmbedding> | null;
    }[];

    const segments: RawSegment[] = finished
      .flatMap((c) => c.segments ?? [])
      .sort((a, b) => a.startSec - b.startSec || a.chunkIndex - b.chunkIndex);

    const { speakers } = await finishTranscription({
      admin,
      meeting,
      segments,
      embeddings: finished.flatMap((c) =>
        Object.entries(c.speakers ?? {}).map(([label, v]) => ({ label, ...v })),
      ),
      chunked: prepared.chunked,
    });

    return NextResponse.json({
      complete: true,
      total,
      segments: segments.length,
      chunked: prepared.chunked,
      speakers,
    });
  } catch (err) {
    let failed = admin
      .from("meetings")
      .update({
        status: "failed",
        error: friendlyError(err),
        progress_note: null,
      })
      .eq("id", id);
    // A guest refused here is told why on a meeting that is waiting or has
    // failed, but one that another request is working on (a second tab's
    // Retry) is left alone: marking it failed would make the job's callback
    // drop the transcript that request paid for.
    if (err instanceof GuestRefusal) failed = failed.in("status", ["uploaded", "failed"]);
    await failed;
    return apiError(err);
  } finally {
    if (workDir) await cleanupWorkDir(workDir);
  }
}
