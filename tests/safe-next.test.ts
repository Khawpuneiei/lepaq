import { describe, expect, it } from "vitest";

import { safeNext } from "@/lib/safe-next";

// /auth/callback puts the answer straight into a Location header, which
// carries bytes: it has to be a path on this site, in plain ASCII.
// scripts/check-landing.ts covers the redirect cases in more depth.

const ORIGIN = "http://localhost:3000";

describe("safeNext as a Location header", () => {
  it.each([
    ["/meetings/abc?tab=report#notes", "/meetings/abc?tab=report#notes"],
    ["/☃", "/%E2%98%83"],
    ["/café?q=é", "/caf%C3%A9?q=%C3%A9"],
    ["/a b", "/a%20b"],
    // a lone surrogate would make encodeURIComponent throw
    ["/\uD800x", "/%EF%BF%BDx"],
  ])("%j -> %j", (raw, want) => {
    const got = safeNext(raw, ORIGIN);
    expect(got).toBe(want);
    expect(got).toMatch(/^[\x21-\x7e]+$/);
    expect(() => new Headers({ location: got })).not.toThrow();
  });

  it.each(["//evil.example", "/\\evil.example", "/.//evil.example", "https://evil.example", "javascript:alert(1)"])(
    "%j stays on the site",
    (raw) => {
      expect(safeNext(raw, ORIGIN)).toBe("/dashboard");
    },
  );

  it("answers the same path whatever origin the server is bound to", () => {
    // next start binds to localhost, whatever the address bar says
    expect(safeNext("/settings", "http://127.0.0.1:3100")).toBe("/settings");
    expect(safeNext("https://lepaq.example/settings", "http://127.0.0.1:3100")).toBe("/dashboard");
  });
});
