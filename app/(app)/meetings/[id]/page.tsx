import { notFound, redirect } from "next/navigation";

import { MeetingDetail } from "@/components/meeting/meeting-detail";
import { createClient } from "@/lib/supabase/server";
import type {
  ActionItem,
  Meeting,
  MeetingParticipant,
  MeetingReport,
  ParticipantRead,
  PersonFact,
  TranscriptSegment,
} from "@/lib/types";

export default async function MeetingPage({ params }: PageProps<"/meetings/[id]">) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: meeting } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!meeting) notFound();

  const [
    { data: report },
    { data: participants },
    { data: actionItems },
    { data: facts },
    { data: reads },
    { data: segments },
  ] = await Promise.all([
    supabase.from("meeting_reports").select("*").eq("meeting_id", id).maybeSingle(),
    supabase.from("meeting_participants").select("*").eq("meeting_id", id),
    supabase
      .from("action_items")
      .select("*")
      .eq("meeting_id", id)
      .order("created_at", { ascending: true }),
    supabase.from("person_facts").select("*").eq("meeting_id", id),
    supabase.from("participant_reads").select("*").eq("meeting_id", id),
    supabase
      .from("transcript_segments")
      .select("*")
      .eq("meeting_id", id)
      .order("idx", { ascending: true }),
  ]);

  let company = null;
  if (meeting.company_id) {
    const { data } = await supabase
      .from("companies")
      .select("id, name, status_options(label, color)")
      .eq("id", meeting.company_id)
      .maybeSingle();

    if (data) {
      const status = data.status_options as unknown as
        | { label: string; color: string }
        | null;
      company = {
        id: data.id,
        name: data.name,
        status_label: status?.label ?? null,
        status_color: status?.color ?? null,
      };
    }
  }

  return (
    <MeetingDetail
      meeting={meeting as Meeting}
      report={(report as MeetingReport) ?? null}
      participants={(participants ?? []) as MeetingParticipant[]}
      actionItems={(actionItems ?? []) as ActionItem[]}
      facts={(facts ?? []) as PersonFact[]}
      reads={(reads ?? []) as ParticipantRead[]}
      segments={(segments ?? []) as TranscriptSegment[]}
      company={company}
      appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""}
    />
  );
}
