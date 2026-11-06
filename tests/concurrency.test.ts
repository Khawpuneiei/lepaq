import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "@/lib/concurrency";

const tick = () => new Promise((r) => setTimeout(r, 1));

describe("mapWithConcurrency", () => {
  it("returns an empty array for no items and never calls fn", async () => {
    let calls = 0;
    expect(await mapWithConcurrency([], 3, async () => calls++)).toEqual([]);
    expect(calls).toBe(0);
  });

  it("keeps results in input order even when later items finish first", async () => {
    const delays = [30, 1, 15, 5];
    const out = await mapWithConcurrency(delays, 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:1", "2:15", "3:5"]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
    });
    expect(peak).toBe(3);
  });

  it("works when the limit is larger than the number of items", async () => {
    expect(await mapWithConcurrency([1, 2], 10, async (n) => n * 2)).toEqual([2, 4]);
  });

  it("passes on an error thrown by a task", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("part 2 failed");
        return n;
      }),
    ).rejects.toThrow("part 2 failed");
  });
});
