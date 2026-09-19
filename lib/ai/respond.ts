import "server-only";

import { LLM_MODEL, REASONING_EFFORT, openai } from "@/lib/ai/openai";

/**
 * One place where a structured-output call to the Responses API is made, so
 * the two analysis steps cannot drift apart.
 *
 * `reasoning` is only meaningful on a reasoning model. Setting
 * OPENAI_REASONING_EFFORT=none omits it, which is what you want if you swap
 * OPENAI_LLM_MODEL to something non-reasoning — otherwise the API rejects it.
 */
export async function structuredCall<T>(args: {
  system: string;
  user: string;
  schemaName: string;
  schema: unknown;
  parse: (value: unknown) => T;
}): Promise<{ value: T; model: string }> {
  const response = await openai().responses.create({
    model: LLM_MODEL,
    ...(REASONING_EFFORT === ("none" as string)
      ? {}
      : { reasoning: { effort: REASONING_EFFORT } }),
    input: [
      { role: "system", content: args.system },
      { role: "user", content: args.user },
    ],
    text: {
      format: {
        type: "json_schema",
        name: args.schemaName,
        schema: args.schema as Record<string, unknown>,
        strict: true,
      },
    },
  });

  const raw = response.output_text;
  if (!raw) {
    throw new Error(
      `${args.schemaName}: the model returned no text. This usually means the request was refused or truncated.`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`${args.schemaName}: the model returned invalid JSON.`);
  }

  return { value: args.parse(json), model: LLM_MODEL };
}
