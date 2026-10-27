/**
 * Checks the live environment before running the pipeline for real.
 * Run with: npm run preflight
 *
 * Verifies, without writing anything: env vars present, Supabase reachable,
 * every table from the migrations exists, the storage bucket exists, the
 * Claude key can see both models, and whatever TRANSCRIBE_BACKEND needs is
 * set (and, for OpenAI, that the transcription model is visible).
 */

import "./load-env";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const TABLES = [
  "profiles",
  "status_options",
  "companies",
  "people",
  "meetings",
  "meeting_participants",
  "transcript_segments",
  "speaker_mappings",
  "transcription_chunks",
  "meeting_reports",
  "action_items",
  "participant_reads",
  "person_facts",
];

const BACKEND = process.env.TRANSCRIBE_BACKEND || "openai";

/** what each transcription backend cannot run without */
const BACKEND_ENV: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  whisperlah: ["WHISPERLAH_URL"],
  jobs: ["WHISPERLAH_URL", "WHISPERLAH_TOKEN", "CALLBACK_SECRET", "NEXT_PUBLIC_APP_URL"],
};

/** tables the backend writes to on top of the base schema */
const BACKEND_TABLES: Record<string, string[]> = {
  openai: [],
  whisperlah: ["speaker_embeddings"],
  jobs: ["speaker_embeddings", "transcription_jobs"],
};

let failures = 0;
const ok = (label: string, detail = "") => console.log(`  ok    ${label}${detail ? "  — " + detail : ""}`);
const bad = (label: string, detail = "") => {
  console.log(`  FAIL  ${label}${detail ? "  — " + detail : ""}`);
  failures++;
};

async function main() {
  console.log("\nEnvironment");
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
  ];
  if (!BACKEND_ENV[BACKEND]) {
    bad("TRANSCRIBE_BACKEND", `"${BACKEND}" is not one of ${Object.keys(BACKEND_ENV).join(", ")}`);
  } else {
    ok("TRANSCRIBE_BACKEND", BACKEND);
    required.push(...BACKEND_ENV[BACKEND]);
  }
  for (const k of required) {
    if (process.env[k]) ok(k, `set (${process.env[k]!.length} chars)`);
    else bad(k, "missing");
  }
  if (failures) process.exit(1);

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  console.log("\nDatabase schema");
  const missing: string[] = [];
  for (const t of [...TABLES, ...(BACKEND_TABLES[BACKEND] ?? [])]) {
    // A real row select, not head:true — a HEAD count returns no body and
    // supabase-js reports success even when the table does not exist, which
    // turns a missing migration into a green preflight.
    const { error } = await db.from(t).select("*").limit(1);
    if (error) {
      missing.push(t);
      bad(t, error.message.slice(0, 80));
    } else {
      ok(t);
    }
  }

  if (missing.length) {
    console.log(
      `\n  ${missing.length} table(s) missing. Run supabase/migrations/0001_init.sql in the Supabase SQL editor.`,
    );
  }

  console.log("\nStorage");
  const { data: buckets, error: bucketError } = await db.storage.listBuckets();
  if (bucketError) {
    bad("list buckets", bucketError.message);
  } else {
    const bucket = buckets.find((b) => b.id === "meeting-audio");
    if (!bucket) bad("meeting-audio bucket", "not found");
    else {
      ok("meeting-audio bucket", `public=${bucket.public}`);
      const limit = (bucket as { file_size_limit?: number | null }).file_size_limit;
      ok("object size limit", limit ? `${(limit / 1024 / 1024).toFixed(0)} MB` : "project default");
    }
  }

  console.log("\nAuth");
  const ownerId = process.env.OWNER_USER_ID;
  if (!ownerId) {
    bad("OWNER_USER_ID", "not set");
  } else {
    const { data, error } = await db.auth.admin.getUserById(ownerId);
    if (error || !data.user) bad("owner user", error?.message ?? "not found");
    else {
      ok("owner user", data.user.email ?? ownerId);
      const { data: profile } = await db
        .from("profiles")
        .select("id, full_name")
        .eq("id", ownerId)
        .maybeSingle();
      if (profile) ok("profile row", profile.full_name ?? "(no name)");
      else bad("profile row", "missing — the new-user trigger did not run for this user");

      const { count } = await db
        .from("status_options")
        .select("*", { head: true, count: "exact" })
        .eq("owner_id", ownerId);
      if (count && count > 0) ok("status options", `${count} rows`);
      else bad("status options", "none — pipeline will have no allowed statuses");
    }
  }

  console.log("\nClaude");
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const models = [
    ["LLM_MODEL", process.env.LLM_MODEL || "claude-haiku-5-5"],
    ["LLM_FALLBACK_MODEL", process.env.LLM_FALLBACK_MODEL || "claude-sonnet-5-5"],
  ] as const;
  for (const [key, id] of models) {
    try {
      // the Models API is free, so this checks the key and each id without spending
      await anthropic.models.retrieve(id);
      ok(key, `${id} available`);
    } catch (err) {
      bad(key, `${id}: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
    }
  }

  if (BACKEND === "openai") {
    console.log("\nOpenAI (transcription)");
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const id = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-transcribe-diarize";
    try {
      // listing models is free; nothing here spends credit
      const models = await openai.models.list();
      const ids = new Set(models.data.map((m) => m.id));
      if (ids.has(id)) ok("OPENAI_TRANSCRIBE_MODEL", `${id} available`);
      else bad("OPENAI_TRANSCRIBE_MODEL", `${id} NOT in this account's model list`);
    } catch (err) {
      bad("OPENAI_API_KEY", err instanceof Error ? err.message.slice(0, 120) : String(err));
    }
  }

  console.log(
    failures === 0
      ? "\nPreflight passed.\n"
      : `\nPreflight found ${failures} problem(s).\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
