import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Local development sign-in. Visit /api/dev/login and you land on the
 * dashboard as OWNER_EMAIL, with no password typed anywhere.
 *
 * It does NOT weaken auth. It mints a genuine Supabase session through the
 * admin API and writes the same cookie a normal sign-in would, so RLS, the
 * proxy guard and every route behave exactly as they do for a real user.
 *
 * Two independent locks, because a route that hands out sessions must not be
 * one deploy away from being public:
 *
 *   1. NODE_ENV must not be production. `next build` sets this, so the route
 *      is dead on Vercel no matter what the environment variables say.
 *   2. DEV_AUTH_BYPASS must be exactly "true". Off unless you opt in.
 *
 * Both fail closed with a 404 rather than an explanatory error, so the route
 * is indistinguishable from not existing.
 */
export async function GET(request: Request) {
  const enabled =
    process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true";

  if (!enabled) {
    return new NextResponse("Not found", { status: 404 });
  }

  const email = process.env.OWNER_EMAIL;
  if (!email) {
    return NextResponse.json(
      { error: "Set OWNER_EMAIL in .env.local to use the dev sign-in." },
      { status: 400 },
    );
  }

  try {
    // 1. mint a one-time token for that user
    const admin = createAdminClient();
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (linkError || !link.properties?.hashed_token) {
      return NextResponse.json(
        { error: linkError?.message ?? "Could not create a sign-in token." },
        { status: 500 },
      );
    }

    // 2. redeem it through the SSR client so the session cookie is written
    //    in exactly the format the rest of the app reads
    const cookieStore = await cookies();
    const response = NextResponse.redirect(new URL("/dashboard", request.url));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
          },
        },
      },
    );

    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: "email",
    });

    if (verifyError) {
      return NextResponse.json({ error: verifyError.message }, { status: 500 });
    }

    console.warn(`[dev] signed in as ${email} via /api/dev/login`);
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Dev sign-in failed." },
      { status: 500 },
    );
  }
}
