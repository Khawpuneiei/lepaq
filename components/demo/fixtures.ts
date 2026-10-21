/**
 * Made-up data for the /demo walkthrough, in the exact shapes the real
 * components take. Everyone here is fictional and shares names with the seed
 * script, so the demo and `npm run seed` tell the same story.
 *
 * Nothing in this file is fetched or written. If a type in lib/types.ts
 * changes, the compiler points here, which is the point of typing it.
 */

import type { PickedFile } from "@/components/meeting/upload-dropzone";
import type { ParticipantOption, SpeakerRow } from "@/components/meeting/speaker-review";
import type { PersonRow } from "@/components/people/people-view";
import { fallbackColumns } from "@/lib/interests";
import type {
  ActionItem,
  InterestColumn,
  Meeting,
  MeetingParticipant,
  MeetingReport,
  ParticipantRead,
  PersonFact,
  TranscriptSegment,
} from "@/lib/types";

export const DEMO_OWNER = "demo-owner";
export const DEMO_ME = { name: "Sarah Johnson", email: "sarah@lepaq.demo" };
const MEETING_ID = "demo-meeting";
const CREATED = "2026-10-15T09:30:00.000Z";

// ---- the recording ----------------------------------------------------------

const MB = 1024 * 1024;

/**
 * 22 minutes off an iPhone, at the same bitrate as the real 61-minute test
 * file (86.3 MB) — and the compressed size the browser encoder produces for
 * that length (mono 16 kHz 48 kbps, ~6 KB/s).
 */
export const PICKED_FILE: PickedFile = {
  file: { name: "Coffee with Priya.m4a", size: Math.round(7.6 * MB) } as File,
  durationSec: 22 * 60 + 14,
  originalBytes: Math.round(31.4 * MB),
  compressed: true,
};

// ---- speakers ----------------------------------------------------------------

export const SPEAKER_PARTICIPANTS: ParticipantOption[] = [
  { id: "p-sarah", display_name: "Sarah Johnson", position: "Account Executive", is_me: true },
  { id: "p-priya", display_name: "Priya Raman", position: "Head of Procurement", is_me: false },
];

export const SPEAKER_ROWS: SpeakerRow[] = [
  {
    raw_speaker_label: "B",
    participant_id: "p-priya",
    confidence: 0.52,
    reason: "Talks about her team's WMS migration, so probably Priya — but café noise blurs the voice.",
    sample_quotes: [
      "We are migrating our WMS in Q3. My team cannot take a second go-live in the same quarter.",
      "Tuas would be the one. It's our busiest, so if it works there it works anywhere.",
    ],
    segment_count: 74,
    seconds: 781,
    chunk_index: 0,
    major: true,
  },
  {
    raw_speaker_label: "A",
    participant_id: "p-sarah",
    confidence: 0.93,
    reason: "Asks the questions and commits to sending the pilot plan.",
    sample_quotes: [
      "Thanks for making time, Priya. I know procurement week is brutal.",
      "I'll send a pilot plan with the Q4 date by Friday.",
    ],
    segment_count: 61,
    seconds: 552,
    chunk_index: 0,
    major: true,
  },
  {
    raw_speaker_label: "C",
    participant_id: null,
    confidence: 0.2,
    reason: null,
    sample_quotes: ["Mm-hmm."],
    segment_count: 3,
    seconds: 4,
    chunk_index: 0,
    major: false,
  },
  {
    raw_speaker_label: "D",
    participant_id: null,
    confidence: 0.1,
    reason: null,
    sample_quotes: ["Two kopi-o kosong for Sarah?"],
    segment_count: 1,
    seconds: 2,
    chunk_index: 0,
    major: false,
  },
];

// ---- the meeting -----------------------------------------------------------

export const COMPANY = {
  id: "c-northpeak",
  name: "Northpeak Logistics",
  status_label: "Proposal",
  status_color: "#1E3A8A",
};

export function meeting(status: Meeting["status"]): Meeting {
  return {
    id: MEETING_ID,
    owner_id: DEMO_OWNER,
    company_id: COMPANY.id,
    title: "Northpeak — coffee with Priya",
    short_note: null,
    meeting_date: "2026-10-15",
    audio_path: null,
    audio_bytes: PICKED_FILE.file.size,
    audio_mime: "audio/mpeg",
    // deleted after transcription, the default
    audio_deleted_at: "2026-10-15T09:41:00.000Z",
    duration_sec: PICKED_FILE.durationSec,
    status,
    progress_note: null,
    error: null,
    consent_confirmed: true,
    share_token: null,
    created_at: CREATED,
  };
}

export const PARTICIPANTS: MeetingParticipant[] = [
  {
    id: "mp-sarah",
    meeting_id: MEETING_ID,
    person_id: null,
    display_name: "Sarah Johnson",
    position: "Account Executive",
    is_me: true,
    speaker_label: "A",
    mapping_confidence: 0.93,
  },
  {
    id: "mp-priya",
    meeting_id: MEETING_ID,
    person_id: "person-priya",
    display_name: "Priya Raman",
    position: "Head of Procurement",
    is_me: false,
    speaker_label: "B",
    mapping_confidence: 1,
  },
];

const LINES: [speaker: "Sarah Johnson" | "Priya Raman", start: number, text: string][] = [
  ["Sarah Johnson", 0, "Thanks for making time, Priya. I know procurement week is brutal."],
  ["Priya Raman", 6, "It's okay lah, I needed the coffee anyway. Kopi-o kosong, always."],
  ["Sarah Johnson", 14, "Same as last time. How is the marathon training going?"],
  ["Priya Raman", 21, "Thirty-two K on Sunday. December is coming very fast."],
  ["Sarah Johnson", 30, "And after that, the Hokkaido trip?"],
  ["Priya Raman", 35, "Yes! Two weeks after the race. That's my reward."],
  ["Sarah Johnson", 141, "Okay, the real reason I asked you here. I heard the timeline was the problem."],
  ["Priya Raman", 152, "Honestly, yes. We are migrating our WMS in Q3. My team cannot take a second go-live in the same quarter."],
  ["Sarah Johnson", 174, "That's fair. What if go-live moved to Q4, after the migration is stable?"],
  ["Priya Raman", 189, "Q4 would work much better. But I still need to see it working before I sign anything."],
  ["Sarah Johnson", 211, "Then let's run a four-week pilot in one warehouse first. Your pick of site."],
  ["Priya Raman", 229, "Tuas would be the one. It's our busiest, so if it works there it works anywhere."],
  ["Sarah Johnson", 409, "Tuas it is. I'll send a pilot plan with the Q4 date by Friday."],
  ["Priya Raman", 424, "Please copy Daniel. He will ask about the payment schedule."],
  ["Sarah Johnson", 438, "Four quarters instead of two, I remember. I'll put both options in."],
  ["Priya Raman", 455, "Good. And add the integration timeline — my IT people will ask that first."],
  ["Sarah Johnson", 598, "Noted. Can I book a call with your IT lead next week?"],
  ["Priya Raman", 611, "Thursday afternoon is free. I'll ask Ravi to join."],
  ["Sarah Johnson", 1176, "Last thing — any good laksa near the Tuas site for when I visit?"],
  ["Priya Raman", 1190, "Not in Tuas. Go to Katong, the stall opposite the church. Best laksa in Singapore, I'm serious."],
  ["Sarah Johnson", 1207, "I'll hold you to that."],
  ["Priya Raman", 1212, "And the café next door plays Wong Kar-wai on loop. In the Mood for Love — my favourite."],
];

export const SEGMENTS: TranscriptSegment[] = LINES.map(([speaker, start, text], idx) => ({
  id: idx + 1,
  meeting_id: MEETING_ID,
  idx,
  chunk_index: 0,
  raw_speaker_label: speaker === "Sarah Johnson" ? "A" : "B",
  speaker_label: speaker,
  start_sec: start,
  end_sec: start + Math.max(4, Math.round(text.length / 14)),
  text,
  excluded: false,
}));

export const REPORT: MeetingReport = {
  meeting_id: MEETING_ID,
  summary:
    "Coffee with Priya to work through her objection to the timeline. Her team is migrating its WMS in Q3 and cannot absorb a second go-live in the same quarter. Moving go-live to Q4 removed most of her resistance, but she wants to see it working first, so we agreed a four-week pilot at Tuas, Northpeak's busiest warehouse. Sarah sends a pilot plan with the Q4 date by Friday, copies Daniel on both payment options, and books a call with Priya's IT lead for Thursday.",
  key_takeaways: [
    "The objection was timing, not price: a Q3 go-live clashes with the WMS migration.",
    "Priya will back a Q4 go-live if a pilot proves it first.",
    "Tuas is the pilot site because it is the busiest — a strong proof point if it works.",
    "Daniel will scrutinise the payment schedule; IT will ask about integration first.",
  ],
  decisions: [
    { text: "Go-live moves to Q4, after the WMS migration", evidence_idx: 9 },
    { text: "Four-week pilot at the Tuas warehouse", evidence_idx: 11 },
    { text: "Pilot plan to be sent by Friday", evidence_idx: 12 },
  ],
  risks: [
    "Priya will not sign without seeing the pilot work.",
    "Integration questions from IT could delay the pilot start.",
  ],
  coach: {
    went_well: ["You led with Priya's marathon, not the deal — she relaxed straight away."],
    improve: [
      {
        observation: "You offered Q4 before asking what date her team could actually take.",
        suggestion: "Ask for her date first, then confirm it works for you.",
      },
    ],
    talk_ratio_comment: "Priya spoke most — right for a meeting about her objection.",
    next_meeting_openers: ["How did the 32 K go on Sunday?"],
    questions_to_ask_next: ["Who else signs off on the Tuas pilot besides you and Daniel?"],
  },
  talk_ratio: [
    { name: "Priya Raman", seconds: 781, share: 0.59, is_me: false },
    { name: "Sarah Johnson", seconds: 552, share: 0.41, is_me: true },
  ],
  follow_up_email:
    "Hi Priya,\n\nThanks for the coffee — and for being straight about the timeline.\n\nTo recap what we agreed:\n- Go-live moves to Q4, after your WMS migration\n- A four-week pilot at Tuas first\n- I'll send the pilot plan with the Q4 date by Friday, copying Daniel on both payment options\n\nI'll also book Thursday afternoon with Ravi for the integration questions.\n\nBest,\nSarah",
  suggested_company_status: "Negotiation",
  suggested_status_reason:
    "Priya agreed a pilot and a revised go-live, which moves the deal past the proposal stage.",
  model: "gpt-5.6-luna",
  approved_at: null,
  updated_at: CREATED,
};

export const ACTION_ITEMS: ActionItem[] = [
  ["Send pilot plan with the Q4 go-live date", "2026-10-17", 12],
  ["Add two- and four-quarter payment options, copy Daniel", "2026-10-17", 14],
  ["Book integration call with Priya's IT lead for Thursday", "2026-10-22", 17],
].map(([title, due, idx], i) => ({
  id: `ai-${i}`,
  meeting_id: MEETING_ID,
  owner_id: DEMO_OWNER,
  person_id: i === 2 ? "person-priya" : null,
  title: title as string,
  assignee_name: "Sarah Johnson",
  due_date: due as string,
  evidence_idx: idx as number,
  done: false,
  approved: false,
  created_at: CREATED,
}));

/** Priya's facts as the model found them — in their own category each. */
const PRIYA_FACTS: [category: string, fact: string, quote: string][] = [
  ["drink", "Kopi-o kosong, every time", "Kopi-o kosong, always."],
  ["hobby", "Training for a December marathon", "Thirty-two K on Sunday. December is coming very fast."],
  ["travel", "Hokkaido, two weeks after the race", "Two weeks after the race. That's my reward."],
  ["food_like", "Laksa in Katong, opposite the church", "Best laksa in Singapore, I'm serious."],
  ["movie", "In the Mood for Love", "In the Mood for Love — my favourite."],
];

export const FACTS: PersonFact[] = PRIYA_FACTS.map(([category, fact, quote], i) => ({
  id: `f-${i}`,
  owner_id: DEMO_OWNER,
  person_id: "person-priya",
  meeting_id: MEETING_ID,
  category,
  fact,
  evidence_quote: quote,
  approved: false,
  created_at: CREATED,
}));

export const READS: ParticipantRead[] = [
  {
    id: "r-priya",
    meeting_id: MEETING_ID,
    person_id: "person-priya",
    display_name: "Priya Raman",
    sentiment: "positive",
    emotions: ["relieved", "cautious"],
    engagement: 4,
    summary: "Relaxed once the timeline moved. Still wants proof before she commits.",
    evidence_quote: "Q4 would work much better. But I still need to see it working before I sign anything.",
    confidence: "medium",
    created_at: CREATED,
  },
];

// ---- people --------------------------------------------------------------------

const person = (
  id: string,
  full_name: string,
  position: string,
  company_name: string,
  status: [label: string, color: string],
  sentiment: PersonRow["sentiment"],
  meeting_count: number,
  last_met: string,
  facts: [category: string, fact: string][],
): PersonRow => ({
  id,
  full_name,
  position,
  company_id: null,
  company_name,
  status_label: status[0],
  status_color: status[1],
  sentiment,
  last_met,
  meeting_count,
  facts: facts.map(([category, fact]) => ({ category, fact })),
});

const CHAMPION: [string, string] = ["Champion", "#10B981"];
const SUPPORTER: [string, string] = ["Supporter", "#0EA5E9"];
const SCEPTIC: [string, string] = ["Sceptic", "#E8D48B"];

/** The People page after the meeting is approved: Priya's facts are in. */
export const PEOPLE: PersonRow[] = [
  person("person-alicia", "Alicia Fernandez", "Partnerships Lead", "Tanjong Partners", CHAMPION, "positive", 3, "2026-10-08", [
    ["food_dislike", "Avoids coriander"],
    ["hobby", "Salsa on Wednesday nights"],
  ]),
  person("person-rahim", "Captain Rahim Yusof", "Fleet Manager", "Harbourline Marine", CHAMPION, "neutral", 4, "2026-10-03", [
    ["food_like", "Nasi lemak"],
    ["hobby", "Fishing off Pulau Ubin"],
    ["travel", "Japan with family in June"],
  ]),
  person("person-grace", "Grace Lim", "Operations Lead", "Meridian Foods", SUPPORTER, "positive", 2, "2026-10-06", [
    ["movie", "Anything by Studio Ghibli"],
    ["hobby", "Pottery classes"],
    ["drink", "Oat latte"],
  ]),
  person("person-jonathan", "Jonathan Ng", "Managing Director", "Kestrel Retail Group", CHAMPION, "positive", 5, "2026-09-29", [
    ["drink", "Single-origin pour-over"],
    ["hobby", "Long rides to Kranji"],
  ]),
  person("person-weiming", "Mr Tan Wei Ming", "COO", "Northpeak Logistics", CHAMPION, "positive", 3, "2026-10-13", [
    ["food_like", "Chicken rice, extra chilli"],
    ["hobby", "Golf on Saturday mornings"],
    ["drink", "Teh tarik"],
  ]),
  person(
    "person-priya",
    "Priya Raman",
    "Head of Procurement",
    "Northpeak Logistics",
    SCEPTIC,
    "positive",
    2,
    "2026-10-15",
    PRIYA_FACTS.map(([category, fact]) => [category, fact]),
  ),
];

export const COLUMNS: InterestColumn[] = fallbackColumns(DEMO_OWNER).map((c) => ({
  ...c,
  created_at: CREATED,
}));

/** What "Add column" on the Travel suggestion inserts. */
export const COLUMNS_WITH_TRAVEL: InterestColumn[] = [
  ...COLUMNS,
  {
    id: "col-travel",
    owner_id: DEMO_OWNER,
    key: "travel",
    label: "Travel",
    icon: "sparkles",
    categories: ["travel"],
    sort_order: COLUMNS.length + 1,
    is_default: false,
    created_at: CREATED,
  },
];
