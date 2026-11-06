import { describe, expect, it } from "vitest";

import { computeTalkRatio, formatDuration } from "@/lib/talkRatio";

const me = { display_name: "Sarah", speaker_label: "A", is_me: true };
const priya = { display_name: "Priya", speaker_label: "B", is_me: false };

describe("computeTalkRatio", () => {
  it("returns no rows for no segments and no participants", () => {
    expect(computeTalkRatio([], [])).toEqual([]);
  });

  it("gives every mapped participant a zero row when nothing was said", () => {
    expect(computeTalkRatio([], [me, priya])).toEqual([
      { name: "Sarah", seconds: 0, share: 0, is_me: true },
      { name: "Priya", seconds: 0, share: 0, is_me: false },
    ]);
  });

  it("sums time per speaker, sorts by talk time and shares add up to 1", () => {
    const rows = computeTalkRatio(
      [
        { speaker_label: "A", start_sec: 0, end_sec: 10 },
        { speaker_label: "B", start_sec: 10, end_sec: 40 },
        { speaker_label: "A", start_sec: 40, end_sec: 50 },
      ],
      [me, priya],
    );
    expect(rows.map((r) => [r.name, r.seconds])).toEqual([
      ["Priya", 30],
      ["Sarah", 20],
    ]);
    expect(rows[0].share).toBeCloseTo(0.6);
    expect(rows.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1);
  });

  it("skips excluded, zero-length and backwards segments", () => {
    const rows = computeTalkRatio(
      [
        { speaker_label: "A", start_sec: 0, end_sec: 10 },
        { speaker_label: "A", start_sec: 10, end_sec: 100, excluded: true },
        { speaker_label: "B", start_sec: 5, end_sec: 5 },
        { speaker_label: "B", start_sec: 20, end_sec: 15 },
      ],
      [me, priya],
    );
    expect(rows).toEqual([
      { name: "Sarah", seconds: 10, share: 1, is_me: true },
      { name: "Priya", seconds: 0, share: 0, is_me: false },
    ]);
  });

  it("counts speech nobody was mapped to as Unassigned, so my share is not inflated", () => {
    const rows = computeTalkRatio(
      [
        { speaker_label: "A", start_sec: 0, end_sec: 30 },
        { speaker_label: "C", start_sec: 30, end_sec: 60 },
        { speaker_label: "D", start_sec: 60, end_sec: 90 },
      ],
      [me],
    );
    expect(rows).toEqual([
      { name: "Unassigned", seconds: 60, share: 60 / 90, is_me: false },
      { name: "Sarah", seconds: 30, share: 30 / 90, is_me: true },
    ]);
  });

  it("ignores participants with no speaker label", () => {
    const rows = computeTalkRatio(
      [{ speaker_label: "A", start_sec: 0, end_sec: 5 }],
      [me, { display_name: "Ghost", speaker_label: null, is_me: null }],
    );
    expect(rows.map((r) => r.name)).toEqual(["Sarah"]);
  });
});

describe("formatDuration", () => {
  it.each([
    [null, "0:00"],
    [undefined, "0:00"],
    [0, "0:00"],
    [0.4, "0:00"],
    [-5, "0:00"],
    [5, "0:05"],
    [59.6, "1:00"],
    [61, "1:01"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3661, "1:01:01"],
  ])("formatDuration(%s) is %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});
