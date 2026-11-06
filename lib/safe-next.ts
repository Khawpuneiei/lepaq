/**
 * Where to go after signing in: the ?next= path the proxy added, but only if
 * it stays on this site. Anything else goes to /dashboard.
 *
 * Checked after parsing, never by string. "//evil.example" and
 * "/\t/evil.example" both start with "/" and still leave the site, because
 * the URL parser drops tabs and newlines and reads a leading "//" as another
 * host. The origin check alone is not enough either: "/.//evil.example"
 * parses to this origin with the path "//evil.example", and the router reads
 * that path as protocol-relative and leaves. So the path may not start with
 * "//". The proxy never sends one: Next redirects any "//" path before the
 * proxy runs.
 *
 * Pure, so scripts/check-landing.ts can test it without a browser.
 */
export function safeNext(raw: string | null | undefined, origin: string): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  try {
    const url = new URL(raw, origin);
    if (url.origin !== new URL(origin).origin || url.pathname.startsWith("//")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
