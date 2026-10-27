/**
 * Read an API route's JSON body in the browser.
 *
 * A route that throws outside its own error handling answers 500 with an
 * empty body, and a platform error page (a Vercel timeout, a body that is
 * too large) is plain text. res.json() turns both into "Unexpected end of
 * JSON input", which names neither the route nor the status. This throws a
 * message that does, so it points at the right server log.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    let route = "The server";
    try {
      route = new URL(res.url).pathname;
    } catch {
      // no URL on a synthetic Response; keep the generic name
    }
    const body = text.trim()
      ? `"${text.trim().replace(/\s+/g, " ").slice(0, 120)}"`
      : "an empty response";
    throw new Error(`${route} answered ${res.status} with ${body}. Its server log has the cause.`);
  }
}
