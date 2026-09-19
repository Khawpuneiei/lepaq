import "server-only";

import OpenAI from "openai";

let client: OpenAI | null = null;

/** Lazily constructed so importing this module never throws at build time. */
export function openai(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Copy .env.example to .env.local and add it.",
      );
    }
    client = new OpenAI({ apiKey, maxRetries: 2 });
  }
  return client;
}

export const TRANSCRIBE_MODEL =
  process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe-diarize";

export const LLM_MODEL = process.env.OPENAI_LLM_MODEL || "gpt-5.6-luna";

export const REASONING_EFFORT = (process.env.OPENAI_REASONING_EFFORT ||
  "medium") as "minimal" | "low" | "medium" | "high";

/**
 * Run tasks with a ceiling on how many are in flight at once.
 * Used to transcribe audio parts in parallel without tripping rate limits.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}
