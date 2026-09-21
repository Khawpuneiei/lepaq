import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next.js 16 renamed Middleware to Proxy. Same file position (project root),
 * same behaviour — see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
 *
 * Two jobs: refresh the Supabase auth cookie on every request, and keep
 * signed-out visitors out of the app shell. The share page /s/[token] and the
 * login page are the only public routes.
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
  ...(DEV_LOGIN_ENABLED ? ["/api/dev/login"] : []),
];

function isPublic(pathname: string) {
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p),
  );
}

export async function proxy(request: NextRequest) {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
