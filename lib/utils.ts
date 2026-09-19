export { cn } from "cn";

import { differenceInCalendarDays, format, isValid, parseISO } from "date-fns";

export function formatDate(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  const d = parseISO(value);
  return isValid(d) ? format(d, "d MMM yyyy") : fallback;
}

export function formatShortDate(value: string | null | undefined, fallback = "—") {
  if (!value) return fallback;
  const d = parseISO(value);
  return isValid(d) ? format(d, "d MMM") : fallback;
}

/** "Overdue by 3 days" / "Due today" / "Due in 5 days" */
export function dueLabel(due: string | null | undefined) {
  if (!due) return { text: "No date", tone: "muted" as const };
  const d = parseISO(due);
  if (!isValid(d)) return { text: "No date", tone: "muted" as const };

  const days = differenceInCalendarDays(d, new Date());
  if (days < 0) {
    const n = Math.abs(days);
    return {
      text: `Overdue by ${n} day${n === 1 ? "" : "s"}`,
      tone: "danger" as const,
    };
  }
  if (days === 0) return { text: "Due today", tone: "warn" as const };
  if (days <= 7) return { text: `Due in ${days} days`, tone: "warn" as const };
  return { text: `Due ${format(d, "d MMM")}`, tone: "muted" as const };
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function formatMoney(value: number | null | undefined) {
  if (value == null) return null;
  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Time-of-day greeting for the dashboard. */
export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * A URL-safe random token for share links. 32 hex characters from the Web
 * Crypto API, which exists in both the Node and edge runtimes.
 */
export function randomToken(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function pluralise(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Trim a quote for display without cutting mid-word. */
export function truncate(text: string, max = 140) {
  if (text.length <= max) return text;
  return `${text.slice(0, text.lastIndexOf(" ", max) || max).trimEnd()}…`;
}
