/**
 * Read a key, token or URL that this server sends out with its requests.
 *
 * Pasting one into a hosting dashboard can bring the next line of .env.local
 * along with it, and the next line is often another secret. In a key, the
 * line break makes fetch() refuse the header with "Headers.set: "<the whole
 * value>" is an invalid header value"; in a URL, the URL parser drops it and
 * the next line becomes part of the host name. Either way the value lands in
 * an error that reaches the browser, the logs or the meeting's error. Space
 * around the value is dropped here; anything left inside it is refused by
 * name, without repeating the value.
 */
export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (/\s/.test(value)) {
    throw new Error(
      `${name} has a space or line break inside it, so more than one line was probably pasted into it. Keep only its own value, then redeploy.`,
    );
  }
  return value;
}
