import { notFound, redirect } from "next/navigation";

import { SpeakerReview, type SpeakerRow } from "@/components/meeting/speaker-review";
import { isMajorLabel } from "@/lib/ai/mapSpeakers";
import { createClient } from "@/lib/supabase/server";
import { fetchAllSegments } from "@/lib/supabase/paginate";

export const metadata = { title: "Speakers · Rapport" };

export default async function SpeakersPage({ params }: PageProps<"/meetings/[id]/speakers">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, title, status")
    .eq("id", id)
    .maybeSingle();

  if (!meeting) notFound();

  // Nothing to confirm until transcription has finished.
  if (["uploaded", "transcribing", "failed"].includes(meeting.status)) {
    redirect(`/meetings/${id}`);
  }

  const [{ data: mappings }, { data: participants }, segments] =
    await Promise.all([
      supabase
        .from("speaker_mappings")
        .select("*")
        .eq("meeting_id", id)
        .order("segment_count", { ascending: false }),
      supabase
        .from("meeting_participants")
        .select("id, display_name, position, is_me")
        .eq("meeting_id", id),
      // paged: the per-label second counts drive the major/minor split, so a
      // truncated read would misclassify the voices near the end of a long call
      fetchAllSegments<{
        raw_speaker_label: string;
        chunk_index: number;
        start_sec: number | null;
        end_sec: number | null;
      }>(supabase, id, "raw_speaker_label, chunk_index, start_sec, end_sec"),
    ]);

  if (!mappings || mappings.length === 0) {
    redirect(`/meetings/${id}`);
  }

  // Seconds per label, so the review list leads with the voices that matter.
  const seconds = new Map<string, number>();
  const chunkOf = new Map<string, number>();
  for (const s of segments) {
    const d = Math.max(0, Number(s.end_sec ?? 0) - Number(s.start_sec ?? 0));
    seconds.set(s.raw_speaker_label, (seconds.get(s.raw_speaker_label) ?? 0) + d);
    if (!chunkOf.has(s.raw_speaker_label)) {
      chunkOf.set(s.raw_speaker_label, s.chunk_index);
    }
  }

  const chunked = new Set(segments.map((s) => s.chunk_index)).size > 1;

  // major/minor is derived here rather than stored, so the threshold can be
  // tuned in one place without a migration
  const rows: SpeakerRow[] = mappings
    .map((m) => {
      const secs = seconds.get(m.raw_speaker_label) ?? 0;
      return {
        raw_speaker_label: m.raw_speaker_label,
        participant_id: m.participant_id,
        confidence: m.confidence,
        reason: m.reason,
        sample_quotes: (m.sample_quotes ?? []) as string[],
        segment_count: m.segment_count,
        seconds: secs,
        chunk_index: chunkOf.get(m.raw_speaker_label) ?? null,
        major: isMajorLabel(secs, m.segment_count ?? 0),
      };
    })
    .sort((a, b) => b.seconds - a.seconds);

  return (
    <SpeakerReview
      meetingId={id}
      rows={rows}
      participants={(participants ?? []).map((p) => ({
        id: p.id,
        display_name: p.display_name,
        position: p.position,
        is_me: Boolean(p.is_me),
      }))}
      chunked={chunked}
    />
  );
}
