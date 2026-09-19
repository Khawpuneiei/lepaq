import type { FactCategory, Sentiment } from "@/lib/types";

export const AUDIO_BUCKET = "meeting-audio";

/** Accepted upload types. Keep in sync with the dropzone hint text. */
export const ACCEPTED_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
  "video/webm",
] as const;

export const ACCEPTED_AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".wav",
  ".webm",
  ".mp4",
] as const;

/**
 * Browser-side ceiling. Supabase free tier refuses storage objects over 50MB,
 * so raising this past 50 also needs a paid Supabase plan.
 *
 * Anything above the OpenAI 25MB per-request limit is handled server-side by
 * splitting the audio (lib/audio/chunk.ts) — it is no longer a reason to
 * reject the file at the dropzone.
 */
export const MAX_UPLOAD_MB = Number(
  process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 50,
);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/** OpenAI rejects audio uploads above 25MB. We aim under it with headroom. */
export const OPENAI_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
export const CHUNK_TARGET_BYTES = 20 * 1024 * 1024;

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  positive: "Positive",
  neutral: "Neutral",
  mixed: "Mixed",
  negative: "Negative",
};

/**
 * Orange, not red, for negative: a cautious client is not an error (spec 8.3).
 */
export const SENTIMENT_CLASS: Record<Sentiment, string> = {
  positive: "bg-success-soft text-on-success-soft border-transparent",
  neutral: "bg-muted text-muted-foreground border-transparent",
  mixed: "bg-butter text-on-butter border-butter-strong",
  negative:
    "bg-sentiment-negative/15 text-sentiment-negative border-transparent",
};

export const SENTIMENT_DOT: Record<Sentiment, string> = {
  positive: "bg-sentiment-positive",
  neutral: "bg-sentiment-neutral",
  mixed: "bg-sentiment-mixed",
  negative: "bg-sentiment-negative",
};

/** Sentiment as a number so it can be drawn on a timeline. */
export const SENTIMENT_SCORE: Record<Sentiment, number> = {
  negative: 1,
  mixed: 2,
  neutral: 3,
  positive: 4,
};

export const FACT_CATEGORY_LABEL: Record<FactCategory, string> = {
  food_like: "Food they like",
  food_dislike: "Food they avoid",
  hobby: "Hobby",
  interest: "Interest",
  dislike: "Dislikes",
  communication_style: "How they like to communicate",
  personal: "Personal",
  other: "Other",
};

/** Grouping used by the "Remember this" card on a person profile. */
export const FACT_GROUPS: {
  key: string;
  label: string;
  icon: string;
  categories: FactCategory[];
}[] = [
  {
    key: "food",
    label: "Food",
    icon: "utensils",
    categories: ["food_like", "food_dislike"],
  },
  {
    key: "interests",
    label: "Interests",
    icon: "heart",
    categories: ["hobby", "interest"],
  },
  {
    key: "style",
    label: "Working with them",
    icon: "message-circle",
    categories: ["communication_style", "dislike"],
  },
  { key: "personal", label: "Personal", icon: "user", categories: ["personal", "other"] },
];

export const MEETING_STATUS_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  transcribing: "Transcribing",
  awaiting_speakers: "Check speakers",
  analyzing: "Analysing",
  review: "Needs review",
  ready: "Approved",
  failed: "Failed",
};

/** States where the pipeline is working and the client should keep polling. */
export const IN_FLIGHT_STATUSES = ["uploaded", "transcribing", "analyzing"];

/** States where the meeting is waiting on the user, not on a machine. */
export const NEEDS_USER_STATUSES = ["awaiting_speakers", "review"];

/** Minutes of note-taking assumed saved per meeting, for the dashboard stat. */
export const MINUTES_SAVED_PER_MEETING = 25;

export const CONSENT_SCRIPT =
  "Do you mind if I record this so I can focus on our conversation instead of taking notes?";
