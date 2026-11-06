import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_INTEREST_COLUMNS, normaliseFactCategory } from "@/lib/constants";
import {
  bucketFacts,
  columnCategories,
  fallbackColumns,
  suggestColumns,
} from "@/lib/interests";
import type { InterestColumn } from "@/lib/types";

function column(key: string, categories: string[] = []): InterestColumn {
  return {
    id: key,
    owner_id: "u1",
    key,
    label: key,
    icon: "x",
    categories,
    sort_order: 1,
    is_default: false,
    created_at: "2026-01-01T00:00:00Z",
  };
}

const food = column("food", ["food_like", "food_dislike"]);
const hobby = column("hobby");

describe("columnCategories", () => {
  it("uses the column's categories, or falls back to its key", () => {
    expect(columnCategories(food)).toEqual(["food_like", "food_dislike"]);
    expect(columnCategories(hobby)).toEqual(["hobby"]);
  });
});

describe("bucketFacts", () => {
  it("handles no facts and no columns", () => {
    expect(bucketFacts([], [])).toEqual({ buckets: [], notes: [] });
  });

  it("puts each fact in its column and the rest in notes", () => {
    const facts = [
      { category: "food_like", fact: "laksa" },
      { category: "food_dislike", fact: "durian" },
      { category: "hobby", fact: "climbing" },
      { category: "sport", fact: "Liverpool fan" },
    ];
    const { buckets, notes } = bucketFacts(facts, [food, hobby]);
    expect(buckets.map((b) => [b.column.key, b.facts.map((f) => f.fact)])).toEqual([
      ["food", ["laksa", "durian"]],
      ["hobby", ["climbing"]],
    ]);
    expect(notes).toEqual([{ category: "sport", fact: "Liverpool fan" }]);
  });
});

describe("suggestColumns", () => {
  const facts = [
    { category: "sport", fact: "Liverpool fan" },
    { category: "sport", fact: "plays futsal" },
    { category: "sport", fact: "runs" },
    { category: "sport", fact: "swims" },
    { category: "board_games", fact: "Catan" },
    { category: "hobby", fact: "climbing" },
    { category: "other", fact: "has a dog" },
    { category: "personal", fact: "moved in May" },
  ];

  it("offers unclaimed categories, most frequent first, with at most 3 examples", () => {
    expect(suggestColumns(facts, [hobby])).toEqual([
      {
        key: "sport",
        label: "Sport",
        count: 4,
        examples: ["Liverpool fan", "plays futsal", "runs"],
      },
      { key: "board_games", label: "Board games", count: 1, examples: ["Catan"] },
    ]);
  });

  it("never suggests miscellaneous categories such as other or personal", () => {
    const keys = suggestColumns(facts, []).map((s) => s.key);
    expect(keys).not.toContain("other");
    expect(keys).not.toContain("personal");
    expect(keys).toContain("hobby");
  });

  it("respects minCount", () => {
    expect(suggestColumns(facts, [hobby], 2).map((s) => s.key)).toEqual(["sport"]);
  });

  it("returns nothing for no facts", () => {
    expect(suggestColumns([], [])).toEqual([]);
  });
});

describe("fallbackColumns", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-06T03:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("builds the default columns for an owner, in order", () => {
    const cols = fallbackColumns("owner-1");
    expect(cols).toHaveLength(DEFAULT_INTEREST_COLUMNS.length);
    expect(cols.map((c) => c.key)).toEqual(DEFAULT_INTEREST_COLUMNS.map((c) => c.key));
    expect(cols.map((c) => c.sort_order)).toEqual([1, 2, 3, 4]);
    expect(cols.every((c) => c.owner_id === "owner-1" && c.is_default)).toBe(true);
    expect(cols[0]).toMatchObject({ id: "fallback-food", created_at: "2026-11-06T03:00:00.000Z" });
  });
});

describe("normaliseFactCategory", () => {
  it.each([
    ["Board Games", "board_games"],
    ["  food-like ", "food_like"],
    ["K-Pop!", "k_pop"],
    ["sport", "sport"],
  ])("normalises %j to %j", (raw, expected) => {
    expect(normaliseFactCategory(raw)).toBe(expected);
  });

  it.each(["health", "Religion", "sexual orientation", "Family-Problems", "salary"])(
    "blocks the sensitive category %j",
    (raw) => {
      expect(normaliseFactCategory(raw)).toBeNull();
    },
  );

  it.each(["", "   ", "123abc", "!!!", "a".repeat(40)])("rejects the malformed key %j", (raw) => {
    expect(normaliseFactCategory(raw)).toBeNull();
  });
});
