import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  dueLabel,
  formatDate,
  formatMoney,
  formatShortDate,
  greeting,
  initials,
  pluralise,
  randomToken,
  truncate,
} from "@/lib/utils";

// vitest.config.mts pins TZ to Asia/Singapore (UTC+8).

describe("formatDate / formatShortDate", () => {
  it("formats an ISO date", () => {
    expect(formatDate("2026-11-06")).toBe("6 Nov 2026");
    expect(formatShortDate("2026-11-06")).toBe("6 Nov");
  });

  it("shows the local day for a UTC timestamp late in the evening", () => {
    // 20:30 UTC on 5 Nov is 04:30 on 6 Nov in Singapore
    expect(formatDate("2026-11-05T20:30:00Z")).toBe("6 Nov 2026");
  });

  it("falls back for empty or invalid input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("")).toBe("—");
    expect(formatDate("not a date", "n/a")).toBe("n/a");
    expect(formatShortDate("2026-13-40")).toBe("—");
  });
});

describe("dueLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 23:30 on Fri 6 Nov 2026 in Singapore
    vi.setSystemTime(new Date("2026-11-06T15:30:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("has no date for empty or invalid input", () => {
    expect(dueLabel(null)).toEqual({ text: "No date", tone: "muted" });
    expect(dueLabel("garbage")).toEqual({ text: "No date", tone: "muted" });
  });

  it("is due today late in the evening", () => {
    expect(dueLabel("2026-11-06")).toEqual({ text: "Due today", tone: "warn" });
  });

  it("counts calendar days, not 24-hour periods", () => {
    // half an hour away, but tomorrow
    expect(dueLabel("2026-11-07").tone).toBe("warn");
    expect(dueLabel("2026-11-05")).toEqual({ text: "Overdue by 1 day", tone: "danger" });
    expect(dueLabel("2026-11-03")).toEqual({ text: "Overdue by 3 days", tone: "danger" });
  });

  it("warns up to a week ahead, then shows the date", () => {
    expect(dueLabel("2026-11-13")).toEqual({ text: "Due in 7 days", tone: "warn" });
    expect(dueLabel("2026-11-14")).toEqual({ text: "Due 14 Nov", tone: "muted" });
  });

  // Known bug, reported rather than hidden: the code says "Due in 1 days".
  // `it.fails` passes while the bug is there; once lib/utils.ts is fixed,
  // this test starts failing and `.fails` should be removed.
  it.fails("says 'Due in 1 day' for tomorrow", () => {
    expect(dueLabel("2026-11-07").text).toBe("Due in 1 day");
  });
});

describe("initials", () => {
  it.each([
    ["Sarah Johnson", "SJ"],
    ["  priya   raman  ", "PR"],
    ["Mary Ann Tan", "MA"],
    ["Cher", "C"],
    ["", ""],
  ])("initials(%j) is %j", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("formatMoney", () => {
  it("formats SGD with no cents and passes null through", () => {
    expect(formatMoney(84000)).toMatch(/84,000/);
    expect(formatMoney(0)).toMatch(/0/);
    expect(formatMoney(null)).toBeNull();
    expect(formatMoney(undefined)).toBeNull();
  });
});

describe("greeting", () => {
  it.each([
    ["2026-11-06T00:00:00+08:00", "Good morning"],
    ["2026-11-06T11:59:00+08:00", "Good morning"],
    ["2026-11-06T12:00:00+08:00", "Good afternoon"],
    ["2026-11-06T17:59:00+08:00", "Good afternoon"],
    ["2026-11-06T18:00:00+08:00", "Good evening"],
  ])("at %s says %s", (iso, expected) => {
    expect(greeting(new Date(iso))).toBe(expected);
  });
});

describe("randomToken", () => {
  it("is 32 lowercase hex characters by default and differs each call", () => {
    const a = randomToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken()).not.toBe(a);
    expect(randomToken(4)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("pluralise", () => {
  it("uses the singular only for exactly one", () => {
    expect(pluralise(0, "meeting")).toBe("0 meetings");
    expect(pluralise(1, "meeting")).toBe("1 meeting");
    expect(pluralise(2, "person", "people")).toBe("2 people");
  });
});

describe("truncate", () => {
  it("leaves short text alone", () => {
    expect(truncate("")).toBe("");
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("cuts at the last space before the limit", () => {
    expect(truncate("the quick brown fox", 12)).toBe("the quick…");
  });

  // Known bug, reported rather than hidden: with no space before the limit,
  // lastIndexOf returns -1, which is truthy, so slice(0, -1) keeps the whole
  // text but its last character. A 300-character URL comes back 299 long.
  it.fails("cuts a long word with no spaces at the limit", () => {
    expect(truncate("a".repeat(300), 140)).toBe(`${"a".repeat(140)}…`);
  });
});
