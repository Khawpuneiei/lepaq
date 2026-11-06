import { afterEach, describe, expect, it } from "vitest";

import { readEnv } from "@/lib/env";

const KEY = "LEPAQ_TEST_ONLY_VALUE";

afterEach(() => {
  delete process.env[KEY];
});

describe("readEnv", () => {
  it("is undefined when the variable is unset, empty or only spaces", () => {
    expect(readEnv(KEY)).toBeUndefined();
    process.env[KEY] = "";
    expect(readEnv(KEY)).toBeUndefined();
    process.env[KEY] = "   \n";
    expect(readEnv(KEY)).toBeUndefined();
  });

  it("drops space around the value", () => {
    process.env[KEY] = "  https://example.test/jobs \n";
    expect(readEnv(KEY)).toBe("https://example.test/jobs");
  });

  it("refuses a value with a line break inside it, by name and without echoing it", () => {
    process.env[KEY] = "first-secret\nSECOND_KEY=second-secret";
    expect(() => readEnv(KEY)).toThrow(KEY);
    try {
      readEnv(KEY);
    } catch (err) {
      expect((err as Error).message).not.toContain("first-secret");
      expect((err as Error).message).not.toContain("second-secret");
    }
  });

  it("refuses a value with a space or tab inside it", () => {
    process.env[KEY] = "abc def";
    expect(() => readEnv(KEY)).toThrow(/space or line break/);
    process.env[KEY] = "abc\tdef";
    expect(() => readEnv(KEY)).toThrow();
  });
});
