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
import { mapSpeakers } from "@/lib/ai/mapSpeakers";

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
 * Safe to call repeatedly: work already done is stored per chunk, so a second
 * call resumes rather than restarting. That is what makes long recordings
 * survive the Vercel function ceiling without a queue or a worker.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/meetings/[id]/process">) {
  const started = Date.now();
  const { id } = await ctx.params;
  const admin = createAdminClient();
  let workDir: string | null = null;

  try {
    const user = await requireUser();
    const meeting = await requireOwnedMeeting(id, user.id);

    if (meeting.status === "review" || meeting.status === "ready") {
      throw new ApiError("This meeting has already been analysed.", 409);
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
            // only the self-hosted backend has voice embeddings; leaving the
            // key out keeps the OpenAI path working before migration 0004
            ...(Object.keys(result.speakers).length > 0 ? { speakers: result.speakers } : {}),
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
    // `speakers` exists only once migration 0004 has run, so ask for it only
    // when the backend that fills it is on
    const chunkColumns: string =
      TRANSCRIBE_BACKEND === "whisperlah"
        ? "chunk_index, segments, speakers"
        : "chunk_index, segments";
    const { data } = await admin
      .from("transcription_chunks")
      .select(chunkColumns)
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

    if (segments.length === 0) {
      throw new ApiError(
        "No speech was found in that recording. Check the file plays, and that it is not silent.",
        422,
      );
    }

    // idx is assigned once, here, so evidence citations are stable and the
    // transcript reads 0..n-1 no matter how many parts it arrived in
    await admin.from("transcript_segments").delete().eq("meeting_id", id);
    const rows = segments.map((s, idx) => ({
      meeting_id: id,
      idx,
      chunk_index: s.chunkIndex,
      raw_speaker_label: s.rawSpeakerLabel,
      speaker_label: s.rawSpeakerLabel,
      start_sec: s.startSec,
      end_sec: s.endSec,
      text: s.text,
    }));

    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin
        .from("transcript_segments")
        .insert(rows.slice(i, i + 500));
      if (error) throw new ApiError(error.message, 500);
    }

    // ---- voice embeddings -------------------------------------------------
    // Only the self-hosted backend returns them: one centroid per speaker
    // label, tagged with the model that made it. Stored per meeting for now;
    // nothing reads them yet beyond tests of cross-part and cross-meeting
    // matching. Deleted with the meeting.
    const embeddingRows = finished.flatMap((c) =>
      Object.entries(c.speakers ?? {}).map(
        ([label, v]) => ({
          meeting_id: id,
          raw_speaker_label: label,
          model: v.model,
          dim: v.embedding.length,
          embedding: JSON.stringify(v.embedding),
        }),
      ),
    );
    if (TRANSCRIBE_BACKEND === "whisperlah") {
      await admin.from("speaker_embeddings").delete().eq("meeting_id", id);
      if (embeddingRows.length > 0) {
        const { error } = await admin.from("speaker_embeddings").insert(embeddingRows);
        if (error) throw new ApiError(error.message, 500);
      }
    }

    // ---- propose a speaker mapping ---------------------------------------
    await admin
      .from("meetings")
      .update({ progress_note: "Identifying speakers" })
      .eq("id", id);

    const { data: participants } = await admin
      .from("meeting_participants")
      .select("id, display_name, position, is_me")
      .eq("meeting_id", id);

    const proposals = await mapSpeakers({
      title: meeting.title,
      shortNote: meeting.short_note,
      meetingDate: meeting.meeting_date,
      participants: (participants ?? []).map((p) => ({
        display_name: p.display_name,
        position: p.position,
        is_me: Boolean(p.is_me),
      })),
      segments,
      chunked: prepared.chunked,
    });

    const byName = new Map((participants ?? []).map((p) => [p.display_name, p.id]));

    await admin.from("speaker_mappings").delete().eq("meeting_id", id);
    await admin.from("speaker_mappings").insert(
      proposals.map((p) => ({
        meeting_id: id,
        raw_speaker_label: p.rawSpeakerLabel,
        participant_id: p.displayName ? (byName.get(p.displayName) ?? null) : null,
        confidence: p.confidence,
        reason: p.reason,
        sample_quotes: p.sampleQuotes,
        segment_count: p.segmentCount,
        confirmed: false,
      })),
    );

    // ---- audio retention --------------------------------------------------
    // Everything downstream works from the transcript, so once we are here the
    // recording itself is no longer needed. Spec 9 barrier 1.
    const { data: profile } = await admin
      .from("profiles")
      .select("delete_audio_after_processing")
      .eq("id", user.id)
      .maybeSingle();

    if (profile?.delete_audio_after_processing) {
      await admin.storage.from(AUDIO_BUCKET).remove([meeting.audio_path]);
      await admin
        .from("meetings")
        .update({ audio_deleted_at: new Date().toISOString() })
        .eq("id", id);
    }

    await admin
      .from("meetings")
      .update({ status: "awaiting_speakers", progress_note: null, error: null })
      .eq("id", id);

    return NextResponse.json({
      complete: true,
      total,
      segments: segments.length,
      chunked: prepared.chunked,
      speakers: proposals.length,
    });
  } catch (err) {
    await admin
      .from("meetings")
      .update({
        status: "failed",
        error: friendlyError(err),
        progress_note: null,
      })
      .eq("id", id);
    return apiError(err);
  } finally {
    if (workDir) await cleanupWorkDir(workDir);
  }
}
