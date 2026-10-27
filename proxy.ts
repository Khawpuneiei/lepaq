import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 renamed Middleware to Proxy. Same file position (project root),
 * same behaviour — see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
 *
 * Two jobs: refresh the Supabase auth cookie on every request, and keep
 * signed-out visitors out of the app shell. The share page /s/[token], the
 * login page and the /demo walkthrough are the only public routes.
 */

/**
 * Same two locks as the route and the button. Without this the dev sign-in
 * cannot work at all: the proxy would bounce the very request that exists to
 * create a session, straight back to /login.
 */
const DEV_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true";

const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/s/",
  // the product walkthrough: real components, made-up data, no queries
  "/demo",
  // machine-to-machine: each checks its own signature or secret
  "/api/transcription/callback",
  "/api/cron/",
  ...(DEV_LOGIN_ENABLED ? ["/api/dev/login"] : []),
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p),
  );
}

/**
 * The proxy runs before every request, so anything that throws in here takes
 * down the whole site — including /login, which is where you would go to
 * work out what is wrong. Passing `process.env.X!` straight into
 * createServerClient made a missing variable do exactly that: an opaque
 * "Internal Server Error" on every route, with nothing to indicate that the
 * cause was configuration rather than code.
 *
 * Checked here instead, and answered with a 503 that says what to do.
 */
function missingEnv(): string[] {
  return ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(
    (key) => !process.env[key],
  );
}

export async function proxy(request: NextRequest) {
  const missing = missingEnv();
  if (missing.length > 0) {
    console.error(
      `[proxy] missing environment variable(s): ${missing.join(", ")}. ` +
        "Set them in the deployment's environment settings and redeploy.",
    );
    return new NextResponse(
      `Lepaq is not configured.\n\n` +
        `Missing: ${missing.join(", ")}\n\n` +
        `Add these in your hosting provider's environment variables, for the\n` +
        `environment you are deploying to, then REDEPLOY — NEXT_PUBLIC_* values\n` +
        `are baked in at build time, so adding them without a rebuild changes\n` +
        `nothing.`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not remove: this refreshes an expired token and rewrites the cookie.
  //
  // Wrapped because this is the single most dangerous await in the codebase.
  // It runs before every request, and an unhandled throw here — a malformed
  // SUPABASE_URL, a project that has been paused, a network blip — turns the
  // entire site into "Internal Server Error" with no clue as to why. Failing
  // closed with the reason attached is strictly better than failing opaquely.
  let user = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[proxy] could not reach Supabase:", detail);
    return new NextResponse(
      `Lepaq cannot reach its database.\n\n${detail}\n\n` +
        `Check NEXT_PUBLIC_SUPABASE_URL is the full https://<ref>.supabase.co\n` +
        `URL, that the anon key belongs to that same project, and that the\n` +
        `project is not paused — Supabase pauses free projects after about a\n` +
        `week of inactivity.`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  const { pathname } = request.nextUrl;

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // so the user lands back where they were aiming after signing in
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets. API routes are included on purpose:
     * they need the refreshed session too.
     *
     * `ffmpeg/` and `.wasm` are excluded explicitly. The browser-side
     * compressor loads a 32MB core from /public, and without this the proxy
     * answers that request with a redirect to /login — the fetch succeeds,
     * returns HTML, and the wasm fails to instantiate with an error that
     * points nowhere near the cause. It would also run a Supabase session
     * check against every megabyte of a static asset.
     */
    "/((?!_next/static|_next/image|favicon.ico|ffmpeg/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|wasm)$).*)",
  ],
};
