import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import { AUDIO_BUCKET } from "@/lib/constants";
import { mapSpeakers } from "@/lib/ai/mapSpeakers";
import type { RawSegment, SpeakerEmbedding } from "@/lib/ai/transcribe";

/**
 * Everything that happens once a whole transcript exists, whichever way it
 * arrived: the chunked loop in /process, or one GPU job reporting back through
 * /api/transcription/callback or the status poll.
 *
 * Writes the transcript, the voice embeddings, a proposed speaker mapping,
 * deletes the audio if the user asked for that, and leaves the meeting at
 * `awaiting_speakers` for the human check.
 */
export async function finishTranscription(args: {
  admin: SupabaseClient;
  meeting: {
    id: string;
    owner_id: string;
    title: string;
    short_note: string | null;
    meeting_date: string | null;
    audio_path: string | null;
  };
  segments: RawSegment[];
  embeddings: ({ label: string } & SpeakerEmbedding)[];
  /** labels are namespaced per part (c0_A), so the mapping prompt says so */
  chunked: boolean;
}): Promise<{ segments: number; speakers: number }> {
  const { admin, meeting } = args;
  const id = meeting.id;

  const segments = args.segments
    .slice()
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
  // One centroid per speaker label, tagged with the model that made it.
  // Stored per meeting; nothing reads them yet beyond tests of cross-meeting
  // matching. Deleted with the meeting.
  await admin.from("speaker_embeddings").delete().eq("meeting_id", id);
  const embeddingRows = args.embeddings
    .filter((e) => e.model && e.embedding.length > 0)
    .map((e) => ({
      meeting_id: id,
      raw_speaker_label: e.label,
      model: e.model,
      dim: e.embedding.length,
      embedding: JSON.stringify(e.embedding),
    }));
  if (embeddingRows.length > 0) {
    const { error } = await admin.from("speaker_embeddings").insert(embeddingRows);
    if (error) throw new ApiError(error.message, 500);
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
    chunked: args.chunked,
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
    .eq("id", meeting.owner_id)
    .maybeSingle();

  if (profile?.delete_audio_after_processing && meeting.audio_path) {
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

  return { segments: segments.length, speakers: proposals.length };
}
