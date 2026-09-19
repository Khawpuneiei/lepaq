/**
 * Makes a live Supabase project ready for the app. Run with: npm run bootstrap
 *
 * Two gaps this fills that the migration alone cannot:
 *
 *  1. The storage bucket. `insert into storage.buckets` needs privileges the
 *     SQL editor does not always have, so it is created through the storage
 *     API here instead.
 *
 *  2. Users who existed BEFORE the migration ran. handle_new_user only fires
 *     on insert into auth.users, so an account created earlier has no profile
 *     row and no status lists — which means the analysis step would have no
 *     allowed status labels to choose from.
 *
 * Safe to re-run.
 */

import "./load-env";
import { createClient } from "@supabase/supabase-js";

const COMPANY_STATUSES: [string, string, boolean][] = [
  ["New Lead", "#64748B", false],
  ["Qualified", "#0EA5E9", false],
  ["Proposal", "#1E3A8A", false],
  ["Negotiation", "#E8D48B", false],
  ["Won", "#10B981", true],
  ["On Hold", "#94A3B8", false],
  ["Lost", "#DC2626", false],
];

const PERSON_STATUSES: [string, string][] = [
  ["Champion", "#10B981"],
  ["Supporter", "#0EA5E9"],
  ["Neutral", "#64748B"],
  ["Sceptic", "#E8D48B"],
  ["Blocker", "#F97316"],
  ["Unknown", "#94A3B8"],
];

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  // ---- 1. storage bucket --------------------------------------------------
  const { data: buckets } = await db.storage.listBuckets();
  if (buckets?.some((b) => b.id === "meeting-audio")) {
    console.log("bucket        already exists");
  } else {
    const { error } = await db.storage.createBucket("meeting-audio", {
      public: false,
      fileSizeLimit: 52428800, // 50MB, the Supabase free tier ceiling
    });
    if (error) throw new Error(`could not create bucket: ${error.message}`);
    console.log("bucket        created (private, 50MB limit)");
  }

  // ---- 2. backfill users that predate the trigger -------------------------
  const { data: list, error: listError } = await db.auth.admin.listUsers({
    perPage: 1000,
  });
  if (listError) throw listError;

  for (const user of list.users) {
    const label = user.email ?? user.id;

    const { data: profile } = await db
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profile) {
      const name =
        (user.user_metadata?.full_name as string | undefined) ??
        user.email?.split("@")[0] ??
        "You";
      const { error } = await db.from("profiles").insert({ id: user.id, full_name: name });
      if (error) throw new Error(`profile for ${label}: ${error.message}`);
      console.log(`profile       created for ${label} (${name})`);
    } else {
      console.log(`profile       already exists for ${label}`);
    }

    const { count } = await db
      .from("status_options")
      .select("*", { head: true, count: "exact" })
      .eq("owner_id", user.id);

    if (!count) {
      const rows = [
        ...COMPANY_STATUSES.map(([label, color, isWon], i) => ({
          owner_id: user.id,
          applies_to: "company",
          label,
          color,
          sort_order: i + 1,
          is_won: isWon,
        })),
        ...PERSON_STATUSES.map(([label, color], i) => ({
          owner_id: user.id,
          applies_to: "person",
          label,
          color,
          sort_order: i + 1,
        })),
      ];
      const { error } = await db.from("status_options").insert(rows);
      if (error) throw new Error(`statuses for ${label}: ${error.message}`);
      console.log(`statuses      created ${rows.length} for ${label}`);
    } else {
      console.log(`statuses      ${count} already exist for ${label}`);
    }
  }

  // ---- 3. can a normal user actually sign an upload? ----------------------
  // This is the storage RLS policy check. The migration creates these
  // policies; if they did not apply, uploading from the browser fails with a
  // permissions error and nothing else in the app reveals why.
  const ownerId = process.env.OWNER_USER_ID;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (ownerId && ownerEmail) {
    const { data: link, error: linkError } = await db.auth.admin.generateLink({
      type: "magiclink",
      email: ownerEmail,
    });

    if (linkError || !link.properties?.hashed_token) {
      console.log(`storage rls   SKIPPED — could not mint a test session`);
    } else {
      const asUser = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { auth: { persistSession: false } },
      );
      const { data: session, error: otpError } = await asUser.auth.verifyOtp({
        token_hash: link.properties.hashed_token,
        type: "email",
      });

      if (otpError || !session.session) {
        console.log(`storage rls   SKIPPED — ${otpError?.message ?? "no session"}`);
      } else {
        const { error: signError } = await asUser.storage
          .from("meeting-audio")
          .createSignedUploadUrl(`${ownerId}/bootstrap-check.mp3`);

        if (signError) {
          console.log(`storage rls   FAIL — ${signError.message}`);
          console.log(
            "\n  The storage policies from 0001_init.sql did not apply. Paste the\n" +
              "  section under '-- Storage:' at the bottom of that file into the\n" +
              "  Supabase SQL editor and run it, then re-run this script.",
          );
          process.exit(1);
        }
        console.log("storage rls   ok — a signed upload URL can be created as the user");
      }
    }
  }

  console.log("\nBootstrap complete.\n");
}

main().catch((err) => {
  console.error("\nBootstrap failed:", err.message ?? err);
  process.exit(1);
});
