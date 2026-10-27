import "server-only";

import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

/** Lazily constructed so importing this module never throws at build time. */
export function claude(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add it.",
      );
    }
    client = new Anthropic({ apiKey, maxRetries: 2 });
  }
  return client;
}

/** Answers every structured call first: fast and cheap. */
export const LLM_MODEL = process.env.LLM_MODEL || "claude-haiku-5-5";

/**
 * Asked only when the primary model refuses, runs out of tokens, returns
 * something that fails validation, or is overloaded. Never on a 400: a bad
 * request is just as bad on the second model.
 */
export const LLM_FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || "claude-sonnet-5-5";

export const LLM_EFFORT = (process.env.LLM_EFFORT || "medium") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
