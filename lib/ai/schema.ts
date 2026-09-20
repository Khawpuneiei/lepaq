import { z } from "zod";

/**
 * Two representations of the same contract, on purpose.
 *
 *   - the zod schema validates what actually came back, and is the type the
 *     rest of the app consumes;
 *   - the JSON Schema constant is what OpenAI structured output is given.
 *
 * They are written by hand rather than derived with a zod-to-json-schema
 * helper because strict structured output has hard requirements that are easy
 * to violate silently: every object needs `additionalProperties: false`, every
 * property must appear in `required` (optionality is expressed as a null
 * union), and length keywords like maxItems are not honoured. Caps such as
 * "at most 6 takeaways" are therefore enforced in code by
 * `clampAnalysis`, not by the schema.
 */

export const SENTIMENTS = ["positive", "neutral", "mixed", "negative"] as const;
export const CONFIDENCES = ["low", "medium", "high"] as const;
/**
 * The categories that ship with the app. NOT an enum in the JSON schema any
 * more: the user owns their Table of Interest columns, so the model has to be
 * able to return a key nobody thought of in advance. The per-meeting user
 * message lists the columns this user actually has, and normaliseFactCategory
 * plus the database check constraint police what comes back.
 */
export const FACT_CATEGORIES = [
  "food_like",
  "food_dislike",
  "drink",
  "movie",
  "hobby",
  "interest",
  "dislike",
  "communication_style",
  "personal",
  "other",
] as const;

// ---------------------------------------------------------------------------
// Speaker mapping
// ---------------------------------------------------------------------------

export const SpeakerMappingResult = z.object({
  mappings: z.array(
    z.object({
      speaker_label: z.string(),
      display_name: z.string().nullable(),
      confidence: z.number(),
      reason: z.string(),
    }),
  ),
  unmapped_labels: z.array(z.string()),
});

export type SpeakerMappingResult = z.infer<typeof SpeakerMappingResult>;

export const SPEAKER_MAPPING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          speaker_label: {
            type: "string",
            description: "The diarization label exactly as given, e.g. A or c1_B",
          },
          display_name: {
            type: ["string", "null"],
            description:
              "Participant name exactly as supplied, or null if no participant matches",
          },
          confidence: {
            type: "number",
            description: "0 to 1. Below 0.6 the UI will ask the user to choose.",
          },
          reason: {
            type: "string",
            description: "Short evidence, e.g. 'Introduces herself at 00:12'",
          },
        },
        required: ["speaker_label", "display_name", "confidence", "reason"],
      },
    },
    unmapped_labels: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["mappings", "unmapped_labels"],
} as const;

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

export const Analysis = z.object({
  summary: z.string(),
  key_takeaways: z.array(z.string()),
  decisions: z.array(
    z.object({
      text: z.string(),
      evidence_idx: z.number(),
    }),
  ),
  risks: z.array(z.string()),
  action_items: z.array(
    z.object({
      title: z.string(),
      assignee_name: z.string().nullable(),
      due_date: z.string().nullable(),
      evidence_idx: z.number(),
    }),
  ),
  follow_up_email: z.string(),
  company: z.object({
    suggested_status: z.string().nullable(),
    reason: z.string(),
  }),
  people: z.array(
    z.object({
      display_name: z.string(),
      sentiment: z.enum(SENTIMENTS),
      emotions: z.array(z.string()),
      engagement: z.number(),
      read_summary: z.string(),
      evidence_quote: z.string(),
      confidence: z.enum(CONFIDENCES),
      facts: z.array(
        z.object({
          category: z.string(),
          fact: z.string(),
          evidence_quote: z.string(),
        }),
      ),
    }),
  ),
  coach: z.object({
    went_well: z.array(z.string()),
    improve: z.array(
      z.object({
        observation: z.string(),
        suggestion: z.string(),
      }),
    ),
    talk_ratio_comment: z.string(),
    next_meeting_openers: z.array(z.string()),
    questions_to_ask_next: z.array(z.string()),
  }),
});

export type Analysis = z.infer<typeof Analysis>;

export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: {
      type: "string",
      description: "4 to 6 sentences in plain language.",
    },
    key_takeaways: {
      type: "array",
      description: "At most 6.",
      items: { type: "string" },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          text: { type: "string" },
          evidence_idx: {
            type: "number",
            description: "Index of the transcript line that shows this.",
          },
        },
        required: ["text", "evidence_idx"],
      },
    },
    risks: {
      type: "array",
      description: "At most 5.",
      items: { type: "string" },
    },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          assignee_name: {
            type: ["string", "null"],
            description: "Participant name, or null if nobody was named.",
          },
          due_date: {
            type: ["string", "null"],
            description: "ISO date (YYYY-MM-DD). null if no date was stated.",
          },
          evidence_idx: { type: "number" },
        },
        required: ["title", "assignee_name", "due_date", "evidence_idx"],
      },
    },
    follow_up_email: {
      type: "string",
      description: "Under 160 words, British English spelling.",
    },
    company: {
      type: "object",
      additionalProperties: false,
      properties: {
        suggested_status: {
          type: ["string", "null"],
          description:
            "Exactly one of the allowed status labels, or null to leave it unchanged.",
        },
        reason: { type: "string" },
      },
      required: ["suggested_status", "reason"],
    },
    people: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          display_name: {
            type: "string",
            description: "Exactly as supplied in the participant list.",
          },
          sentiment: { type: "string", enum: SENTIMENTS },
          emotions: {
            type: "array",
            description: "At most 4 single words, e.g. curious, hesitant.",
            items: { type: "string" },
          },
          engagement: { type: "number", description: "Whole number, 1 to 5." },
          read_summary: { type: "string" },
          evidence_quote: {
            type: "string",
            description: "Verbatim, at most 20 words.",
          },
          confidence: { type: "string", enum: CONFIDENCES },
          facts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                category: {
                  type: "string",
                  description:
                    "snake_case key, at most 39 characters. Use one of the keys listed in the user message where it fits; otherwise coin a short new one.",
                },
                fact: { type: "string" },
                evidence_quote: { type: "string" },
              },
              required: ["category", "fact", "evidence_quote"],
            },
          },
        },
        required: [
          "display_name",
          "sentiment",
          "emotions",
          "engagement",
          "read_summary",
          "evidence_quote",
          "confidence",
          "facts",
        ],
      },
    },
    coach: {
      type: "object",
      additionalProperties: false,
      properties: {
        went_well: { type: "array", description: "At most 3.", items: { type: "string" } },
        improve: {
          type: "array",
          description: "At most 4.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              observation: { type: "string" },
              suggestion: { type: "string" },
            },
            required: ["observation", "suggestion"],
          },
        },
        talk_ratio_comment: { type: "string" },
        next_meeting_openers: {
          type: "array",
          description: "At most 3.",
          items: { type: "string" },
        },
        questions_to_ask_next: {
          type: "array",
          description: "At most 4.",
          items: { type: "string" },
        },
      },
      required: [
        "went_well",
        "improve",
        "talk_ratio_comment",
        "next_meeting_openers",
        "questions_to_ask_next",
      ],
    },
  },
  required: [
    "summary",
    "key_takeaways",
    "decisions",
    "risks",
    "action_items",
    "follow_up_email",
    "company",
    "people",
    "coach",
  ],
} as const;

/**
 * Apply the caps the JSON Schema cannot express, and pull values back into
 * range. Cheaper and more predictable than rejecting the whole response
 * because the model returned a seventh takeaway.
 */
export function clampAnalysis(a: Analysis): Analysis {
  return {
    ...a,
    key_takeaways: a.key_takeaways.slice(0, 6),
    risks: a.risks.slice(0, 5),
    people: a.people.map((p) => ({
      ...p,
      emotions: p.emotions.slice(0, 4),
      engagement: Math.min(5, Math.max(1, Math.round(p.engagement))),
    })),
    coach: {
      ...a.coach,
      went_well: a.coach.went_well.slice(0, 3),
      improve: a.coach.improve.slice(0, 4),
      next_meeting_openers: a.coach.next_meeting_openers.slice(0, 3),
      questions_to_ask_next: a.coach.questions_to_ask_next.slice(0, 4),
    },
  };
}
