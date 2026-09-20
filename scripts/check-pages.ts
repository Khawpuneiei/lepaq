/**
 * Renders every screen against the live database and checks what came back.
 * Run with:  npm run dev   then   npm run check:pages
 *
 * Server Components typecheck happily and still throw at request time — a bad
 * cast on a joined row, a null where the JSX expects an object. The only way
 * to catch that is to actually render each route, so this fetches them all
 * with a real session and asserts on status plus a marker that proves the
 * page reached its own content rather than an error boundary.
 */

import "./load-env";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

let failures = 0;
const ok = (s: string, d = "") => console.log(`  ok    ${s}${d ? "  — " + d : ""}`);
const bad = (s: string, d = "") => {
  console.log(`  FAIL  ${s}${d ? "  — " + d : ""}`);
  failures++;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: link } = await db.auth.admin.generateLink({
    type: "magiclink",
    email: process.env.OWNER_EMAIL!,
  });
  const asUser = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: v } = await asUser.auth.verifyOtp({
    token_hash: link.properties!.hashed_token,
    type: "email",
  });

  const ref = new URL(url).hostname.split(".")[0];
  const value = "base64-" + Buffer.from(JSON.stringify(v.session)).toString("base64url");
  const cookie =
    value.length <= 3180
      ? `sb-${ref}-auth-token=${value}`
      : value
          .match(/.{1,3180}/g)!
          .map((c, i) => `sb-${ref}-auth-token.${i}=${c}`)
          .join("; ");

  // pick real ids so the detail pages have something to render
  const [{ data: meeting }, { data: person }, { data: company }] = await Promise.all([
    db.from("meetings").select("id").eq("status", "ready").limit(1).maybeSingle(),
    db.from("people").select("id").limit(1).maybeSingle(),
    db.from("companies").select("id").limit(1).maybeSingle(),
  ]);

  const routes: [string, string][] = [
    ["/dashboard", "Pipeline"],
    ["/meetings", "Meetings"],
    ["/meetings/new", "Add the recording"],
    ["/people", "People"],
    ["/companies", "Companies"],
    ["/follow-ups", "Follow-ups"],
    ["/settings", "Company statuses"],
  ];
  if (meeting) {
    routes.push([`/meetings/${meeting.id}`, "Summary"]);
    routes.push([`/meetings/${meeting.id}/speakers`, "Who said what?"]);
  }
  if (person) routes.push([`/people/${person.id}`, "Remember this"]);
  if (company) {
    routes.push([`/companies/${company.id}`, "Meetings"]);
    routes.push([`/companies/${company.id}/handover`, "handover"]);
  }

  console.log(`\nRendering ${routes.length} routes against live data\n`);

  for (const [route, marker] of routes) {
    try {
      const res = await fetch(`${BASE}${route}`, { headers: { cookie } });
      const html = await res.text();

      if (!res.ok) {
        bad(route, `status ${res.status}`);
        continue;
      }
      // Next renders the error boundary with a 200, so status alone proves nothing
      if (html.includes("That did not load") || html.includes("Application error")) {
        bad(route, "rendered the error boundary");
        continue;
      }
      if (!html.includes(marker)) {
        bad(route, `rendered, but "${marker}" is missing`);
        continue;
      }
      ok(route, `${(html.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      bad(route, err instanceof Error ? err.message : String(err));
    }
  }

  console.log(
    failures === 0 ? "\nEvery screen rendered.\n" : `\n${failures} screen(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
