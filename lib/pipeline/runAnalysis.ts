import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { ApiError } from "@/lib/api";
import { analyzeMeeting } from "@/lib/ai/analyze";
import { computeTalkRatio } from "@/lib/talkRatio";
import { fetchAllSegments } from "@/lib/supabase/paginate";
import { findOrCreatePerson } from "@/lib/people";

/**
 * Everything that happens after the user has confirmed who is who.
 *
 * Shared by /analyze and /regenerate so the two cannot drift — regenerate is
 * exactly "do this again", which is the whole point of offering it after a
 * speaker fix or a deleted transcript line.
 *
 * Takes a service-role client: the caller has already proved ownership.
 */
export async function runAnalysis(
  admin: SupabaseClient,
  meetingId: string,
  userId: string,
) {
  await admin
    .from("meetings")
    .update({ status: "analyzing", error: null, progress_note: "Writing your report" })
    .eq("id", meetingId);

  const { data: meeting } = await admin
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .single();

  if (!meeting) throw new ApiError("Meeting not found.", 404);

  const [{ data: participants }, segments, { data: statuses }] = await Promise.all([
    admin
      .from("meeting_participants")
      .select("id, person_id, display_name, position, is_me, speaker_label")
      .eq("meeting_id", meetingId),
    // paged: a plain select stops at 1000 and would feed the model a
    // transcript that ends mid-conversation
    fetchAllSegments<{
      idx: number;
      speaker_label: string;
      start_sec: number | null;
      end_sec: number | null;
      text: string;
      excluded: boolean;
    }>(admin, meetingId, "idx, speaker_label, start_sec, end_sec, text, excluded"),
    admin
      .from("status_options")
      .select("label, sort_order")
      .eq("owner_id", userId)
      .eq("applies_to", "company")
      .order("sort_order", { ascending: true }),
  ]);

  const parts = participants ?? [];
  const allSegments = segments;
  // a segment the user struck is gone from the analysis as well as the ratio
  const usable = allSegments.filter((s) => !s.excluded);

  if (usable.length === 0) {
    throw new ApiError(
      "There are no transcript lines left to analyse. Restore a line, or re-process the recording.",
      422,
    );
  }

  // ---- company context -----------------------------------------------------
  let companyName: string | null = null;
  let currentStatus: string | null = null;
  if (meeting.company_id) {
    const { data: company } = await admin
      .from("companies")
      .select("name, status_id")
      .eq("id", meeting.company_id)
      .maybeSingle();
    companyName = company?.name ?? null;
    if (company?.status_id) {
      const { data: status } = await admin
        .from("status_options")
        .select("label")
        .eq("id", company.status_id)
        .maybeSingle();
      currentStatus = status?.label ?? null;
    }
  }

  // ---- facts already approved, so the model does not repeat them ----------
  const personIds = parts.map((p) => p.person_id).filter(Boolean) as string[];
  const knownFacts: { person: string; category: string; fact: string }[] = [];
  if (personIds.length) {
    const { data: facts } = await admin
      .from("person_facts")
      .select("person_id, category, fact")
      .in("person_id", personIds)
      .eq("approved", true);

    const nameByPerson = new Map(
      parts.filter((p) => p.person_id).map((p) => [p.person_id!, p.display_name]),
    );
    for (const f of facts ?? []) {
      knownFacts.push({
        person: nameByPerson.get(f.person_id) ?? "Unknown",
        category: f.category,
        fact: f.fact,
      });
    }
  }

  const talkRatio = computeTalkRatio(allSegments, parts);

  // ---- the call ------------------------------------------------------------
  const { analysis, model } = await analyzeMeeting({
    title: meeting.title,
    shortNote: meeting.short_note,
    meetingDate: meeting.meeting_date,
    durationSec: meeting.duration_sec,
    companyName,
    currentCompanyStatus: currentStatus,
    allowedStatuses: (statuses ?? []).map((s) => s.label),
    participants: parts.map((p) => ({
      display_name: p.display_name,
      position: p.position,
      is_me: Boolean(p.is_me),
    })),
    knownFacts,
    talkRatio,
    transcript: usable.map((s) => ({
      idx: s.idx,
      speaker: s.speaker_label,
      text: s.text,
      startSec: s.start_sec,
    })),
  });

  // ---- link participants to the people they already are --------------------
  // findOrCreatePerson, not insert: a second meeting with the same person must
  // land on the same profile, otherwise everything learned about them ends up
  // split across a row per meeting.
  const participantByName = new Map(parts.map((p) => [p.display_name, p]));

  for (const p of parts) {
    if (p.person_id || p.is_me) continue;

    const personId = await findOrCreatePerson(admin, {
      ownerId: userId,
      fullName: p.display_name,
      companyId: meeting.company_id,
      position: p.position,
    });

    if (personId) {
      await admin
        .from("meeting_participants")
        .update({ person_id: personId })
        .eq("id", p.id);
      p.person_id = personId;
    }
  }

  // ---- write the results ---------------------------------------------------
  await admin.from("meeting_reports").upsert(
    {
      meeting_id: meetingId,
      summary: analysis.summary,
      key_takeaways: analysis.key_takeaways,
      decisions: analysis.decisions,
      risks: analysis.risks,
      coach: analysis.coach,
      talk_ratio: talkRatio,
      follow_up_email: analysis.follow_up_email,
      suggested_company_status: analysis.company.suggested_status,
      suggested_status_reason: analysis.company.reason,
      model,
      approved_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "meeting_id" },
  );

  // Regenerating replaces unapproved drafts but must not silently undo work
  // the user already approved, so approved rows are left alone.
  await admin
    .from("action_items")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("approved", false);

  if (analysis.action_items.length) {
    await admin.from("action_items").insert(
      analysis.action_items.map((a) => ({
        meeting_id: meetingId,
        owner_id: userId,
        person_id: a.assignee_name
          ? (participantByName.get(a.assignee_name)?.person_id ?? null)
          : null,
        title: a.title,
        assignee_name: a.assignee_name,
        due_date: a.due_date,
        evidence_idx: a.evidence_idx >= 0 ? a.evidence_idx : null,
        approved: false,
      })),
    );
  }

  await admin.from("participant_reads").delete().eq("meeting_id", meetingId);
  await admin
    .from("person_facts")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("approved", false);

  const reads = [];
  const facts = [];

  for (const person of analysis.people) {
    const participant = participantByName.get(person.display_name);
    // No emotion read or personal-facts file on the user themselves.
    if (!participant || participant.is_me) continue;

    reads.push({
      meeting_id: meetingId,
      person_id: participant.person_id,
      display_name: person.display_name,
      sentiment: person.sentiment,
      emotions: person.emotions,
      engagement: person.engagement,
      summary: person.read_summary,
      evidence_quote: person.evidence_quote,
      confidence: person.confidence,
    });

    if (!participant.person_id) continue;
    for (const f of person.facts) {
      facts.push({
        owner_id: userId,
        person_id: participant.person_id,
        meeting_id: meetingId,
        category: f.category,
        fact: f.fact,
        evidence_quote: f.evidence_quote,
        approved: false,
      });
    }
  }

  // These two inserts used to swallow their errors, which meant a category the
  // database has not been taught yet (a migration not run) looked exactly like
  // a meeting where nobody mentioned anything personal. Fail loudly instead.
  if (reads.length) {
    const { error } = await admin.from("participant_reads").insert(reads);
    if (error) throw new ApiError(`Could not save the people read: ${error.message}`, 500);
  }
  if (facts.length) {
    const { error } = await admin.from("person_facts").insert(facts);
    if (error) {
      throw new ApiError(
        error.message.includes("person_facts_category_check")
          ? "The database does not know one of the fact categories yet. Run supabase/migrations/0002_people_and_interests.sql in the SQL editor."
          : `Could not save personal facts: ${error.message}`,
        500,
      );
    }
  }

  // The company status is never changed here. The suggestion is stored and
  // the meeting page offers an Apply button (spec 5.4 and acceptance criteria).
  await admin
    .from("meetings")
    .update({ status: "review", progress_note: null, error: null })
    .eq("id", meetingId);

  return {
    actionItems: analysis.action_items.length,
    facts: facts.length,
    people: reads.length,
  };
}
