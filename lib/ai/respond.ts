import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { LLM_EFFORT, LLM_FALLBACK_MODEL, LLM_MODEL, claude } from "@/lib/ai/claude";

/**
 * Room for adaptive thinking plus the longest analysis JSON. Thinking counts
 * against this cap, so a tight value shows up as stop_reason "max_tokens"
 * before any text.
 */
const MAX_TOKENS = 32_000;

/**
 * Why the primary model's answer was not used. Each of these can come out
 * differently on a second, larger model; a 400 or a missing key cannot, so
 * those are thrown straight through.
 */
class FallbackWorthy extends Error {}

/**
 * One place where a structured-output call to Claude is made, so the two
 * analysis steps cannot drift apart.
 *
 * Claude Haiku answers first. Claude Sonnet is asked only when Haiku refuses,
 * runs out of tokens, returns JSON that fails the zod check, or is rate
 * limited / overloaded after the SDK's own retries. `model` in the result is
 * whichever one actually answered, and is stored with the report.
 *
 * Request shape that matters on these models:
 *  - no `temperature` and no assistant prefill: both are a 400;
 *  - no `fallbacks` list: Haiku has no server-side fallback and rejects it;
 *  - the response can open with `thinking` blocks, so text is found by type.
 */
export async function structuredCall<T>(args: {
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
  parse: (value: unknown) => T;
}): Promise<{ value: T; model: string }> {
  try {
    return await callOnce(LLM_MODEL, args);
  } catch (err) {
    if (!isFallbackWorthy(err) || LLM_FALLBACK_MODEL === LLM_MODEL) throw err;
    console.warn(
      `[llm] ${args.schemaName}: ${LLM_MODEL} failed (${describe(err)}); retrying on ${LLM_FALLBACK_MODEL}`,
    );
    return await callOnce(LLM_FALLBACK_MODEL, args);
  }
}

async function callOnce<T>(
  model: string,
  args: {
    system: string;
    user: string;
    schemaName: string;
    schema: unknown;
    parse: (value: unknown) => T;
  },
): Promise<{ value: T; model: string }> {
  // Streamed so a long analysis never runs into the SDK's HTTP timeout.
  const response = await claude()
    .messages.stream({
      model,
      max_tokens: MAX_TOKENS,
      // The system prompt is the same for every meeting, so it is cached;
      // everything meeting-specific is in the user turn after it.
      system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: args.user }],
      output_config: {
        effort: LLM_EFFORT,
        format: { type: "json_schema", schema: args.schema as Record<string, unknown> },
      },
    })
    .finalMessage();

  if (response.stop_reason === "refusal") {
    throw new FallbackWorthy(
      `${args.schemaName}: ${model} declined the request${
        response.stop_details?.category ? ` (${response.stop_details.category})` : ""
      }.`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new FallbackWorthy(`${args.schemaName}: ${model} ran out of output tokens.`);
  }

  const raw = response.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
  if (!raw) {
    throw new FallbackWorthy(`${args.schemaName}: ${model} returned no text.`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new FallbackWorthy(`${args.schemaName}: ${model} returned invalid JSON.`);
  }

  try {
    return { value: args.parse(json), model };
  } catch (err) {
    throw new FallbackWorthy(
      `${args.schemaName}: ${model} returned JSON that failed validation: ${describe(err)}`,
    );
  }
}

/** `error.type` values of an error event sent mid-stream, after the 200 */
const TRANSIENT_STREAM_ERRORS = new Set(["overloaded_error", "api_error", "rate_limit_error"]);

function isFallbackWorthy(err: unknown): boolean {
  if (err instanceof FallbackWorthy) return true;
  if (err instanceof Anthropic.APIUserAbortError) return false;
  // the SDK has already retried these twice
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true; // 5xx, including 529 overloaded
  if (err instanceof Anthropic.APIConnectionError) return true;
  // A stream can fail after its 200: an error event arrives as an APIError
  // with no status, and a dropped connection as a plain AnthropicError
  // ("terminated"). The SDK does not retry either.
  if (err instanceof Anthropic.APIError) {
    return err.status === undefined && TRANSIENT_STREAM_ERRORS.has(err.type ?? "");
  }
  if (err instanceof Anthropic.AnthropicError) return true;
  return false;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message.slice(0, 200) : String(err);
}
