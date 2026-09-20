import {
  DEFAULT_INTEREST_COLUMNS,
  NEVER_SUGGEST_AS_COLUMN,
  factCategoryLabel,
} from "@/lib/constants";
import type { InterestColumn } from "@/lib/types";

/**
 * One place that decides which fact belongs in which column, so the Table of
 * Interest and the "Remember this" card on a profile can never disagree about
 * where something lives.
 */

export interface MinimalFact {
  category: string;
  fact: string;
}

export interface ColumnBucket<T extends MinimalFact> {
  column: InterestColumn;
  facts: T[];
}

/** A category that has facts but no column yet — offered to the user to add. */
export interface ColumnSuggestion {
  key: string;
  label: string;
  count: number;
  examples: string[];
}

/** Categories a column claims. Falls back to the key itself. */
export function columnCategories(column: InterestColumn): string[] {
  return column.categories?.length ? column.categories : [column.key];
}

export function bucketFacts<T extends MinimalFact>(
  facts: T[],
  columns: InterestColumn[],
): { buckets: ColumnBucket<T>[]; notes: T[] } {
  const claimed = new Set(columns.flatMap(columnCategories));

  return {
    buckets: columns.map((column) => {
      const cats = new Set(columnCategories(column));
      return { column, facts: facts.filter((f) => cats.has(f.category)) };
    }),
    notes: facts.filter((f) => !claimed.has(f.category)),
  };
}

/**
 * Categories the model has actually produced that no column displays.
 *
 * This is the whole point of an open vocabulary: if a client spent ten minutes
 * on their football team, 'sport' shows up here and the user can promote it to
 * a column in one click. Genuinely miscellaneous categories are excluded —
 * offering "add Other as a column" would be noise.
 *
 * Nothing becomes a column on its own. A suggestion is a suggestion, which is
 * the same approve-before-use rule the rest of the app runs on.
 */
export function suggestColumns(
  facts: MinimalFact[],
  columns: InterestColumn[],
  minCount = 1,
): ColumnSuggestion[] {
  const claimed = new Set(columns.flatMap(columnCategories));
  const byKey = new Map<string, string[]>();

  for (const f of facts) {
    if (claimed.has(f.category)) continue;
    if (NEVER_SUGGEST_AS_COLUMN.has(f.category)) continue;
    const list = byKey.get(f.category) ?? [];
    list.push(f.fact);
    byKey.set(f.category, list);
  }

  return [...byKey.entries()]
    .filter(([, examples]) => examples.length >= minCount)
    .map(([key, examples]) => ({
      key,
      label: factCategoryLabel(key),
      count: examples.length,
      examples: examples.slice(0, 3),
    }))
    .sort((a, b) => b.count - a.count);
}

/** Used when a user somehow has no columns yet, so the table is never blank. */
export function fallbackColumns(ownerId: string): InterestColumn[] {
  return DEFAULT_INTEREST_COLUMNS.map((c, i) => ({
    id: `fallback-${c.key}`,
    owner_id: ownerId,
    key: c.key,
    label: c.label,
    icon: c.icon,
    categories: c.categories,
    sort_order: i + 1,
    is_default: true,
    created_at: new Date().toISOString(),
  }));
}
