import "server-only";

import { structuredCall } from "@/lib/ai/respond";
import {
  ANALYSIS_JSON_SCHEMA,
  Analysis,
  clampAnalysis,
} from "@/lib/ai/schema";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserMessage,
  type AnalysisTranscriptLine,
  type MappingParticipant,
} from "@/lib/ai/prompts";
import type { TalkRatioRow } from "@/lib/types";

export interface AnalyzeArgs {
  title: string;
  shortNote: string | null;
  meetingDate: string | null;
  durationSec: number | null;
  companyName: string | null;
  currentCompanyStatus: string | null;
  allowedStatuses: string[];
  participants: MappingParticipant[];
  knownFacts: { person: string; category: string; fact: string }[];
  talkRatio: TalkRatioRow[];
  transcript: AnalysisTranscriptLine[];
}

export async function analyzeMeeting(
  args: AnalyzeArgs,
): Promise<{ analysis: Analysis; model: string }> {
  if (args.transcript.length === 0) {
    throw new Error(
      "There is nothing to analyse — the transcript is empty. Check that the recording contains speech.",
    );
  }

  const { value, model } = await structuredCall({
    system: ANALYSIS_SYSTEM_PROMPT,
    user: buildAnalysisUserMessage(args),
    schemaName: "meeting_analysis",
    schema: ANALYSIS_JSON_SCHEMA,
    parse: (v) => clampAnalysis(Analysis.parse(v)),
  });

  return { analysis: sanitiseAnalysis(value, args), model };
}

/**
 * Last line of defence before anything is written to the database.
 *
 * The prompt already forbids each of these, but a rule in a prompt is a
 * request and a check in code is a guarantee — and two of these would be
 * user-visible bugs rather than style problems:
 *
 *  - a suggested_status the user has never defined would render a status chip
 *    that their own settings cannot produce;
 *  - an evidence_idx outside the transcript would make the quote icon jump to
 *    a line that does not exist.
 */
function sanitiseAnalysis(a: Analysis, args: AnalyzeArgs): Analysis {
  const allowed = new Set(args.allowedStatuses);
  const validIdx = new Set(args.transcript.map((t) => t.idx));
  const knownNames = new Set(args.participants.map((p) => p.display_name));

  const clampIdx = (idx: number) => (validIdx.has(idx) ? idx : -1);

  return {
    ...a,
    decisions: a.decisions.map((d) => ({ ...d, evidence_idx: clampIdx(d.evidence_idx) })),
    action_items: a.action_items.map((item) => ({
      ...item,
      evidence_idx: clampIdx(item.evidence_idx),
      // a due date the model formatted loosely is worse than no due date
      due_date: isIsoDate(item.due_date) ? item.due_date : null,
      assignee_name:
        item.assignee_name && knownNames.has(item.assignee_name)
          ? item.assignee_name
          : item.assignee_name,
    })),
    company: {
      ...a.company,
      suggested_status:
        a.company.suggested_status && allowed.has(a.company.suggested_status)
          ? a.company.suggested_status
          : null,
    },
    people: a.people.filter((p) => knownNames.has(p.display_name)),
  };
}

function isIsoDate(value: string | null): value is string {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}
