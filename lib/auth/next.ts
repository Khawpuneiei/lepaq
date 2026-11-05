/**
 * Where to send someone after they sign in. Only a path on this site is
 * accepted: "//evil.example" and "/\evil.example" are protocol-relative URLs
 * to another host, so a crafted ?next= would otherwise turn the login page
 * into a redirect to anywhere.
 *
 * The answer is plain ASCII. It ends up in a Location header, which carries
 * bytes, and a character such as "☃" makes building the response throw.
 */
export function safeNext(raw: string | null | undefined, fallback = "/dashboard"): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  // a control character or backslash anywhere can be read as a host by some
  // browsers once the path is normalised
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  try {
    // a lone surrogate makes encodeURIComponent throw
    return raw.replace(/[^\x21-\x7e]/gu, (c) => encodeURIComponent(c));
  } catch {
    return fallback;
  }
}
