/**
 * Hand-written mirror of supabase/migrations/0001_init.sql.
 *
 * Once a real Supabase project exists you can replace this with
 *   npx supabase gen types typescript --project-id <id> > lib/database.types.ts
 * but a hand-written copy keeps the repo typechecking with no cloud access.
 */

export type MeetingStatus =
  | "uploaded"
  | "transcribing"
  /** transcript exists, waiting for the user to confirm who is who */
  | "awaiting_speakers"
  | "analyzing"
  | "review"
  | "ready"
  | "failed";

export type Sentiment = "positive" | "neutral" | "mixed" | "negative";
export type Confidence = "low" | "medium" | "high";
export type CompanyKind = "prospect" | "client" | "partner" | "internal";
export type StatusScope = "company" | "person";

export type FactCategory =
  | "food_like"
  | "food_dislike"
  | "hobby"
  | "interest"
  | "dislike"
  | "communication_style"
  | "personal"
  | "other";

export interface Profile {
  id: string;
  full_name: string | null;
  job_title: string | null;
  delete_audio_after_processing: boolean;
  created_at: string;
}

export interface StatusOption {
  id: string;
  owner_id: string;
  applies_to: StatusScope;
  label: string;
  color: string;
  sort_order: number;
  is_won: boolean | null;
}

export interface Company {
  id: string;
  owner_id: string;
  name: string;
  kind: CompanyKind;
  status_id: string | null;
  deal_value: number | null;
  notes: string | null;
  created_at: string;
}

export interface Person {
  id: string;
  owner_id: string;
  company_id: string | null;
  full_name: string;
  position: string | null;
  email: string | null;
  status_id: string | null;
  created_at: string;
}

export interface Meeting {
  id: string;
  owner_id: string;
  company_id: string | null;
  title: string;
  short_note: string | null;
  meeting_date: string | null;
  audio_path: string | null;
  audio_bytes: number | null;
  audio_mime: string | null;
  audio_deleted_at: string | null;
  duration_sec: number | null;
  status: MeetingStatus;
  progress_note: string | null;
  error: string | null;
  consent_confirmed: boolean;
  share_token: string | null;
  created_at: string;
}

export interface MeetingParticipant {
  id: string;
  meeting_id: string;
  person_id: string | null;
  display_name: string;
  position: string | null;
  is_me: boolean | null;
  speaker_label: string | null;
  mapping_confidence: number | null;
}

export interface TranscriptSegment {
  id: number;
  meeting_id: string;
  idx: number;
  chunk_index: number;
  raw_speaker_label: string;
  speaker_label: string;
  start_sec: number | null;
  end_sec: number | null;
  text: string;
  excluded: boolean;
}

export interface SpeakerMapping {
  id: string;
  meeting_id: string;
  raw_speaker_label: string;
  participant_id: string | null;
  confidence: number | null;
  reason: string | null;
  sample_quotes: string[];
  segment_count: number | null;
  confirmed: boolean;
}

export interface TranscriptionChunk {
  id: string;
  meeting_id: string;
  chunk_index: number;
  start_sec: number;
  end_sec: number;
  status: "pending" | "running" | "done" | "failed";
  segments: {
    chunkIndex: number;
    rawSpeakerLabel: string;
    startSec: number;
    endSec: number;
    text: string;
  }[];
  error: string | null;
  updated_at: string;
}

export interface Decision {
  text: string;
  evidence_idx: number;
}

export interface CoachImprovement {
  observation: string;
  suggestion: string;
}

export interface Coach {
  went_well: string[];
  improve: CoachImprovement[];
  talk_ratio_comment: string;
  next_meeting_openers: string[];
  questions_to_ask_next: string[];
}

export interface TalkRatioRow {
  name: string;
  seconds: number;
  share: number;
  is_me: boolean;
}

export interface MeetingReport {
  meeting_id: string;
  summary: string | null;
  key_takeaways: string[];
  decisions: Decision[];
  risks: string[];
  coach: Coach | Record<string, never>;
  talk_ratio: TalkRatioRow[];
  follow_up_email: string | null;
  suggested_company_status: string | null;
  suggested_status_reason: string | null;
  model: string | null;
  approved_at: string | null;
  updated_at: string;
}

export interface ActionItem {
  id: string;
  meeting_id: string;
  owner_id: string;
  person_id: string | null;
  title: string;
  assignee_name: string | null;
  due_date: string | null;
  evidence_idx: number | null;
  done: boolean;
  approved: boolean;
  created_at: string;
}

export interface ParticipantRead {
  id: string;
  meeting_id: string;
  person_id: string | null;
  display_name: string | null;
  sentiment: Sentiment | null;
  emotions: string[];
  engagement: number | null;
  summary: string | null;
  evidence_quote: string | null;
  confidence: Confidence | null;
  created_at: string;
}

export interface PersonFact {
  id: string;
  owner_id: string;
  person_id: string;
  meeting_id: string | null;
  category: FactCategory;
  fact: string;
  evidence_quote: string | null;
  approved: boolean;
  created_at: string;
}

/** Shape returned by /api/meetings/[id]/status while the pipeline runs. */
export interface ProcessingState {
  status: MeetingStatus;
  progress_note: string | null;
  error: string | null;
  chunks: { done: number; total: number };
}
