import type { Sentiment } from "@/lib/types";

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
 * Length is not a reason to reject a file: the GPU service takes the whole
 * recording in one job, and the per-part backend splits it
 * (lib/audio/chunk.ts).
 */
export const MAX_UPLOAD_MB = Number(
  process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 50,
);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * Meetings a guest (a Supabase anonymous user) may process before continuing
 * with Google: 1, enforced by lib/auth/guest.ts, or 0 to let guests look
 * around only. Here rather than there so the sign-in copy can say it.
 */
export const GUEST_MEETING_LIMIT: 0 | 1 = 1;

/**
 * Tries a guest gets at each paid step of that one meeting, counted by the
 * server (migration 0006): /process calls that start GPU work or reuse a
 * stored transcript, and Claude reports from /analyze and /regenerate. Enough
 * for a Retry or two and a few regenerations after fixing speakers.
 */
export const GUEST_TRANSCRIBE_RUNS = 5;
export const GUEST_ANALYSIS_RUNS = 5;

/** Above this, the per-part backend re-encodes or splits the audio before sending it. */
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

/**
 * Labels for the categories that ship with the app. A category the model
 * proposed will not be in here, so always go through `factCategoryLabel`,
 * which falls back to humanising the key.
 */
export const FACT_CATEGORY_LABEL: Record<string, string> = {
  food_like: "Food they like",
  food_dislike: "Food they avoid",
  drink: "Drink",
  movie: "Film or show",
  hobby: "Hobby",
  interest: "Interest",
  dislike: "Dislikes",
  communication_style: "How they like to communicate",
  personal: "Personal",
  other: "Other",
};

/** "sport" -> "Sport", "board_games" -> "Board games". */
export function factCategoryLabel(key: string) {
  if (FACT_CATEGORY_LABEL[key]) return FACT_CATEGORY_LABEL[key];
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Categories the model must never return, enforced in code as well as in the
 * prompt and the database check constraint.
 *
 * Spec 9 rule 4 keeps these out of the product. An open category vocabulary
 * is exactly where that rule could quietly erode — "health" is a plausible
 * thing for a model to volunteer after somebody mentions a marathon — so the
 * list is checked on the way in rather than trusted to the prompt.
 */
export const BLOCKED_FACT_CATEGORIES = new Set([
  "health", "medical", "illness", "religion", "religious", "politics",
  "political", "ethnicity", "race", "sexuality", "sexual_orientation",
  "finances", "financial", "salary", "income", "family_problems", "divorce",
]);

/** Shape the model returns into something storable, or reject it. */
export function normaliseFactCategory(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (!key || !/^[a-z][a-z0-9_]{0,38}$/.test(key)) return null;
  if (BLOCKED_FACT_CATEGORIES.has(key)) return null;
  return key;
}

/**
 * Only used when a user has no interest_columns rows yet — normally they come
 * from the database, because the whole point is that the user owns them.
 */
export const DEFAULT_INTEREST_COLUMNS = [
  { key: "food", label: "Favourite food", icon: "utensils", categories: ["food_like", "food_dislike"] },
  { key: "movie", label: "Favourite film", icon: "clapperboard", categories: ["movie"] },
  { key: "hobby", label: "Hobby", icon: "palette", categories: ["hobby"] },
  { key: "drink", label: "Favourite drink", icon: "coffee", categories: ["drink"] },
];

/**
 * Categories that stay in Notes rather than becoming a suggested column.
 * These are genuinely miscellaneous, so offering "add Other as a column"
 * would be noise.
 */
export const NEVER_SUGGEST_AS_COLUMN = new Set([
  "other",
  "personal",
  "interest",
  "dislike",
  "communication_style",
]);

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
