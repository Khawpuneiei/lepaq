/**
 * How much room does one meeting actually take?  npm run check:footprint
 *
 * Measures the real rows in the database rather than guessing, then projects
 * forward. Sizes are of the JSON payload, which undercounts what Postgres
 * stores on disk (row headers, indexes, toast) — roughly 1.5-2x the numbers
 * below in practice. That is called out rather than hidden, because the
 * interesting question is which table grows, not the exact megabyte.
 */

import "./load-env";
import { createClient } from "@supabase/supabase-js";

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null), "utf8");
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const tables = [
    "profiles", "status_options", "companies", "people", "meetings",
    "meeting_participants", "transcript_segments", "speaker_mappings",
    "transcription_chunks", "meeting_reports", "action_items",
    "participant_reads", "person_facts",
  ];

  console.log("\nPer-table size (JSON payload of every row)\n");
  const sizes = new Map<string, { rows: number; size: number }>();
  let total = 0;

  for (const t of tables) {
    let rows = 0;
    let size = 0;
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(t).select("*").range(from, from + 999);
      if (error) {
        console.log(`  ${t.padEnd(22)} (not present: ${error.message.slice(0, 40)})`);
        break;
      }
      if (!data || data.length === 0) break;
      rows += data.length;
      size += bytes(data);
      if (data.length < 1000) break;
    }
    sizes.set(t, { rows, size });
    total += size;
    console.log(`  ${t.padEnd(22)} ${String(rows).padStart(6)} rows  ${kb(size).padStart(10)}`);
  }

  console.log(`  ${"TOTAL".padEnd(22)} ${" ".repeat(11)}${kb(total).padStart(10)}\n`);

  // ---- the one meeting we can measure properly ---------------------------
  const { data: meetings } = await db
    .from("meetings")
    .select("id, title, duration_sec")
    .order("duration_sec", { ascending: false })
    .limit(1);

  const m = meetings?.[0];
  if (!m?.duration_sec) {
    console.log("No meeting with a duration to extrapolate from.\n");
    return;
  }

  const hours = m.duration_sec / 3600;
  console.log(`Longest meeting: "${m.title}" — ${(m.duration_sec / 60).toFixed(0)} min\n`);

  let segSize = 0;
  let segRows = 0;
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("transcript_segments")
      .select("*")
      .eq("meeting_id", m.id)
      .range(from, from + 999);
    if (!data?.length) break;
    segRows += data.length;
    segSize += bytes(data);
    if (data.length < 1000) break;
  }

  const { data: chunks } = await db
    .from("transcription_chunks")
    .select("*")
    .eq("meeting_id", m.id);
  const chunkSize = bytes(chunks);

  const { data: report } = await db
    .from("meeting_reports")
    .select("*")
    .eq("meeting_id", m.id);
  const reportSize = bytes(report);

  const perMeeting = segSize + chunkSize + reportSize;

  console.log("  transcript_segments   " + `${segRows} rows`.padStart(12) + "  " + kb(segSize).padStart(10));
  console.log("  transcription_chunks  " + `${chunks?.length ?? 0} rows`.padStart(12) + "  " + kb(chunkSize).padStart(10) + "   <- duplicate copy of the same transcript");
  console.log("  meeting_reports       " + "1 row".padStart(12) + "  " + kb(reportSize).padStart(10));
  console.log("  " + "per meeting".padEnd(22) + " ".repeat(12) + "  " + kb(perMeeting).padStart(10));
  console.log("  " + "per hour of audio".padEnd(22) + " ".repeat(12) + "  " + kb(perMeeting / hours).padStart(10));

  // ---- project against the free tier -------------------------------------
  const DB_LIMIT = 500 * 1024 * 1024;
  const perHour = perMeeting / hours;
  const perHourNoChunks = (segSize + reportSize) / hours;
  const overhead = 1.8; // indexes + row headers + toast, conservatively

  console.log("\nAgainst a 500 MB database limit (verify current limits on the pricing page)\n");
  console.log(`  as built, with the chunk copies kept : ${Math.floor(DB_LIMIT / (perHour * overhead))} hours of meetings`);
  console.log(`  if chunk jsonb is cleared on success : ${Math.floor(DB_LIMIT / (perHourNoChunks * overhead))} hours of meetings`);
  console.log(`  (assuming ~${overhead}x on-disk overhead over the JSON payload)`);

  console.log("\nStorage, with 'delete audio after processing' on\n");
  const { data: objects } = await db.storage.from("meeting-audio").list();
  console.log(`  objects currently in the bucket      : ${objects?.length ?? 0}`);
  console.log(`  audio is transient, so the cap that matters is peak concurrent`);
  console.log(`  upload size (50 MB each), not cumulative.`);

  console.log(`\n  One hour of audio costs ~21 MB of egress when the process route`);
  console.log(`  downloads it back. Against 5 GB/month that is ~${Math.floor((5 * 1024) / 21)} hours of meetings.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
