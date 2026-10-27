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
