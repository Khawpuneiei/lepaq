import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthApiError, isAuthSessionMissingError, type AuthError } from "@supabase/supabase-js";

import { adoptGuest } from "@/lib/auth/guest";
import { safeNext } from "@/lib/auth/next";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Where Supabase sends the browser back after Google (signInWithOAuth, PKCE:
 * the browser client left a code verifier in a cookie when it started, and
 * the code is exchanged here for the session).
 *
 * A guest who pressed Continue with Google arrives still holding the guest's
 * session. Once the Google account is known, everything the guest made moves
 * into it and the guest is deleted (rapport_adopt_guest, migration 0006). If
 * the Google account already has meetings, people or companies of its own,
 * or a password, nothing moves and the person stays the guest: the new
 * session is never written, and is revoked.
 * This is done here, not with Supabase's manual identity linking, because a
 * link attaches the Google account to whoever started it, in any browser;
 * here the same browser has to hold both.
 *
 * Every redirect from here is a relative Location. A route handler's
 * request.url names the host the server is bound to, which self-hosted or
 * in a container is not the one in the address bar (next start gives
 * localhost), and the session cookie set here belongs to the address bar's
 * host: an absolute redirect to the other one arrives signed out.
 */
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}

type Reason = "failed" | "google_taken" | "move_failed";
const toError = (reason: Reason) => redirectTo(`/auth/error?reason=${reason}`);

/**
 * Supabase saying for certain that this browser's session is over. Anything
 * else (unreachable, a 5xx, a rate limit, a token it could not check) leaves
 * it unknown, and a guest's session cannot be got back once it is replaced.
 */
const DEAD_SESSION_CODES = new Set([
  "session_not_found",
  "session_expired",
  "refresh_token_not_found",
  "refresh_token_already_used",
  "user_not_found",
]);
function sessionIsGone(error: AuthError) {
  return (
    isAuthSessionMissingError(error) ||
    (isAuthApiError(error) && DEAD_SESSION_CODES.has(error.code ?? ""))
  );
}

type HeldCookie = { name: string; value: string; options: CookieOptions };

export async function GET(request: NextRequest) {
  const url = request.nextUrl;

  const errorCode = url.searchParams.get("error_code") ?? url.searchParams.get("error");
  if (errorCode) {
    console.warn("[auth/callback]", errorCode, url.searchParams.get("error_description"));
    return toError("failed");
  }

  const code = url.searchParams.get("code");
  if (!code) return toError("failed");

  // Both clients below hold their cookie writes back until it is clear which
  // session this browser should end up with.
  const cookieStore = await cookies();
  const holdingClient = (held: HeldCookie[]) =>
    createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          held.push(...toSet);
        },
      },
    });
  const write = (held: HeldCookie[]) =>
    held.forEach(({ name, value, options }) => cookieStore.set(name, value, options));

  // Who this browser is now: a guest continuing with Google, or nobody. When
  // Supabase cannot say, stop before the exchange: carrying on would replace
  // a guest's only session with the Google one, stranding everything the
  // guest made, and so would writing the cookie removal a failed refresh
  // asks for.
  const beforeHeld: HeldCookie[] = [];
  const {
    data: { user: before },
    error: beforeError,
  } = await holdingClient(beforeHeld).auth.getUser();
  if (beforeError && !sessionIsGone(beforeError)) {
    console.warn("[auth/callback] could not tell who is signed in", beforeError.status, beforeError.code, beforeError.message);
    return toError("failed");
  }
  // a refreshed guest token, or the removal of a session that is over
  write(beforeHeld);
  const guestId = before?.is_anonymous ? before.id : null;

  const held: HeldCookie[] = [];
  const exchanger = holdingClient(held);

  const { data, error } = await exchanger.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    console.warn("[auth/callback] code exchange failed", error?.code, error?.message);
    return toError("failed");
  }

  if (guestId && data.user.id !== guestId) {
    let outcome: Awaited<ReturnType<typeof adoptGuest>>;
    try {
      outcome = await adoptGuest(createAdminClient(), guestId, data.user.id);
    } catch (err) {
      console.error("[auth/callback] could not move the guest", err);
      outcome = "error";
    }
    if (outcome !== "moved") {
      // stay the guest: drop the Google session instead of writing it
      await exchanger.auth.signOut({ scope: "local" }).catch(() => {});
      return toError(outcome === "kept" ? "google_taken" : "move_failed");
    }
  }

  write(held);
  return redirectTo(safeNext(url.searchParams.get("next")));
}
