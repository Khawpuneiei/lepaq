/**
 * Checks the live environment before running the pipeline for real.
 * Run with: npm run preflight
 *
 * Verifies, without writing anything: env vars present, Supabase reachable,
 * every table from the migrations exists, the storage bucket exists, the
 * Claude key can see both models, and whatever TRANSCRIBE_BACKEND needs is
 * set (and, for the GPU jobs service, that it answers and takes the token).
 */

import "./load-env";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";

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
  "interest_columns",
  "guest_meetings",
];

const BACKEND = process.env.TRANSCRIBE_BACKEND || "jobs";

/** what each transcription backend cannot run without */
const BACKEND_ENV: Record<string, string[]> = {
  whisperlah: ["WHISPERLAH_URL"],
  jobs: ["WHISPERLAH_URL", "WHISPERLAH_TOKEN", "CALLBACK_SECRET", "NEXT_PUBLIC_APP_URL"],
};

/** tables the backend writes to on top of the base schema */
const BACKEND_TABLES: Record<string, string[]> = {
  whisperlah: ["speaker_embeddings"],
  jobs: ["speaker_embeddings", "transcription_jobs"],
};

/**
 * The migration to start from when a table outside 0001 is missing.
 * interest_columns comes from 0003, but 0003 builds on 0002, which has no
 * table of its own to check, so a gap there starts from 0002.
 */
const START_MIGRATION: Record<string, string> = {
  interest_columns: "0002_people_and_interests.sql",
  speaker_embeddings: "0004_speaker_embeddings.sql",
  transcription_jobs: "0005_transcription_jobs.sql",
  guest_meetings: "0006_guest_meetings.sql",
};

let failures = 0;
const ok = (label: string, detail = "") => console.log(`  ok    ${label}${detail ? "  — " + detail : ""}`);
const note = (label: string, detail = "") => console.log(`  note  ${label}${detail ? "  — " + detail : ""}`);
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
    // the app runs anything it does not know as "jobs"; say so rather than
    // let it look as if the old backend were still in use
    bad(
      "TRANSCRIBE_BACKEND",
      BACKEND === "openai"
        ? `"openai" was removed. Set it to jobs, or delete the line (jobs is the default)`
        : `"${BACKEND}" is not one of ${Object.keys(BACKEND_ENV).join(", ")}`,
    );
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
    if (!error) {
      ok(t);
    } else {
      // only "no such table" is a missing migration; a bad key or a dead URL
      // fails every table the same way, and re-running migrations over a
      // database in use can undo what the later ones changed
      if (error.code === "PGRST205" || error.code === "42P01") missing.push(t);
      bad(t, error.message.slice(0, 80));
    }
  }

  if (missing.length) {
    // A missing table means the file that creates it never ran, so neither
    // did the ones after it: start from the earliest such file
    const first = missing.map((t) => START_MIGRATION[t] ?? "0001_init.sql").sort()[0];
    console.log(
      `\n  ${missing.length} table(s) missing. In the Supabase SQL editor, run supabase/migrations/${first} and every migration after it, in order.`,
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

  if (BACKEND === "jobs") {
    console.log("\nGPU service (jobs)");
    const base = process.env.WHISPERLAH_URL!.replace(/\/$/, "");
    // None of these requests starts a GPU. /health is answered by the small
    // web container, and only the jobs service reports a model_version there
    // (the per-part server on :8765 answers /health too). Asking about a job
    // that does not exist checks the token: first without one, which must be
    // refused (so the route exists and checks auth), then with it, where 404
    // means accepted.
    const get = (path: string, token?: string) =>
      fetch(`${base}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(30_000),
      });
    try {
      const res = await get("/health");
      const body = (await res.json().catch(() => null)) as { model_version?: string } | null;
      if (res.ok && body?.model_version) ok("health", `model ${body.model_version}`);
      else if (res.ok) bad("health", `${base} answers /health but is not the jobs service (no model_version)`);
      else bad("health", `${res.status} from ${base}/health`);
    } catch (err) {
      bad("health", `${base}/health: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const probe = `/jobs/${randomUUID()}`;
      const anonymous = await get(probe);
      if (anonymous.status !== 401 && anonymous.status !== 403) {
        bad("WHISPERLAH_TOKEN", `cannot check: ${base}/jobs answered ${anonymous.status} without a token (expected 401)`);
      } else {
        const res = await get(probe, process.env.WHISPERLAH_TOKEN);
        if (res.status === 404) ok("WHISPERLAH_TOKEN", "accepted");
        else if (res.status === 401 || res.status === 403) bad("WHISPERLAH_TOKEN", `refused (${res.status})`);
        else bad("WHISPERLAH_TOKEN", `unexpected ${res.status} for an unknown job`);
      }
    } catch (err) {
      bad("WHISPERLAH_TOKEN", err instanceof Error ? err.message : String(err));
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    if (!appUrl.startsWith("https://")) {
      note(
        "callbacks",
        `${appUrl} is not public https, so results will arrive through the status poll (about 2 min late) instead of the callback`,
      );
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
