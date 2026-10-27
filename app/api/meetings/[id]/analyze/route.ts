import { NextResponse } from "next/server";
import { z } from "zod";

import { ApiError, apiError, friendlyError, requireOwnedMeeting, requireUser } from "@/lib/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAnalysis } from "@/lib/pipeline/runAnalysis";
import { TRANSCRIBE_BACKEND } from "@/lib/ai/transcribe";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  mappings: z.array(
    z.object({
      raw_speaker_label: z.string(),
      participant_id: z.string().uuid().nullable(),
    }),
  ),
});

/**
 * Runs once the user has confirmed the speaker mapping.
 *
 * Confirming does two things before the analysis call: it rewrites every
 * transcript line to the canonical speaker name, and it records which raw
 * diarization labels the user accepted. For a chunked recording several raw
 * labels (c0_A, c1_B, c2_A) usually collapse onto one participant, which is
 * exactly what makes a long meeting readable.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/meetings/[id]/analyze">) {
  const { id } = await ctx.params;
  // Built inside a try: thrown out here, a missing setting would reach the
  // browser as an empty 500 ("Unexpected end of JSON input"), naming nothing.
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return apiError(err);
  }

  try {
    const user = await requireUser();
    await requireOwnedMeeting(id, user.id);

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid speaker mapping.", 422);

    const { data: participants } = await admin
      .from("meeting_participants")
      .select("id, display_name")
      .eq("meeting_id", id);

    const nameById = new Map((participants ?? []).map((p) => [p.id, p.display_name]));

    // 1. record what the user chose
    for (const m of parsed.data.mappings) {
      await admin
        .from("speaker_mappings")
        .update({ participant_id: m.participant_id, confirmed: true })
        .eq("meeting_id", id)
        .eq("raw_speaker_label", m.raw_speaker_label);
    }

    // 2. rewrite the transcript to canonical names
    for (const m of parsed.data.mappings) {
      const label = m.participant_id
        ? (nameById.get(m.participant_id) ?? `Speaker ${m.raw_speaker_label}`)
        : `Speaker ${m.raw_speaker_label}`;

      await admin
        .from("transcript_segments")
        .update({ speaker_label: label })
        .eq("meeting_id", id)
        .eq("raw_speaker_label", m.raw_speaker_label);
    }

    // 3. point each participant at one of their labels, for the talk ratio
    for (const p of participants ?? []) {
      const theirs = parsed.data.mappings.filter((m) => m.participant_id === p.id);
      await admin
        .from("meeting_participants")
        .update({ speaker_label: theirs.length ? p.display_name : null })
        .eq("id", p.id);
    }

    const result = await runAnalysis(admin, id, user.id);

    // Each chunk kept its own copy of its segments so a run that hit the
    // function ceiling could resume without re-paying OpenAI. That copy has
    // done its job: the transcript is in transcript_segments, the speakers are
    // confirmed, and /process refuses to run again once a meeting reaches
    // 'review'. Keeping it would leave a duplicate transcript in the database
    // forever — about 35% of everything a meeting stores.
    //
    // The rows stay, so chunk_index/status/timing history is still there. Only
    // the redundant payload goes.
    await admin
      .from("transcription_chunks")
      // the voice embeddings parked here are in speaker_embeddings by now too
      .update(TRANSCRIBE_BACKEND === "whisperlah" ? { segments: [], speakers: {} } : { segments: [] })
      .eq("meeting_id", id)
      .eq("status", "done");

    // Same for the copy a GPU job kept so a failed step could be retried
    // without transcribing again.
    if (TRANSCRIBE_BACKEND === "jobs") {
      await admin
        .from("transcription_jobs")
        .update({ result: null })
        .eq("meeting_id", id)
        .not("result", "is", null);
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    await admin
      .from("meetings")
      .update({ status: "failed", error: friendlyError(err), progress_note: null })
      .eq("id", id);
    return apiError(err);
  }
}
