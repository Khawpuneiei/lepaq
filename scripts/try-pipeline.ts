/**
 * Runs the real AI pipeline over a local audio file, with no database.
 *
 *   npm run try -- <file> [--transcribe-only]
 *                         [--participants "Sarah Johnson:AE:me,Mr Tan:COO"]
 *                         [--title "..."] [--note "..."]
 *
 * This exercises exactly the code the /process and /analyze routes call —
 * prepareAudio, transcribePart, stitchTranscripts, mapSpeakers,
 * computeTalkRatio, analyzeMeeting — so a pass here means the OpenAI half of
 * the app works. It writes nothing, which makes it usable before the Supabase
 * migration has been applied.
 */

import "./load-env";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { cleanupWorkDir, prepareAudio } from "@/lib/audio/chunk";
import { mapWithConcurrency } from "@/lib/ai/openai";
import {
  stitchTranscripts,
  transcribePart,
  type PartTranscript,
  type RawSegment,
} from "@/lib/ai/transcribe";
import { mapSpeakers } from "@/lib/ai/mapSpeakers";
import { analyzeMeeting } from "@/lib/ai/analyze";
import { computeTalkRatio, formatDuration } from "@/lib/talkRatio";
import { CHUNK_TARGET_BYTES } from "@/lib/constants";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);

if (!file) {
  console.error('Usage: npm run try -- "path/to/audio.m4a"');
  process.exit(1);
}

const participants = (flag("participants") ?? "")
  .split(",")
  .filter(Boolean)
  .map((entry) => {
    const [display_name, position, me] = entry.split(":");
    return {
      display_name: display_name.trim(),
      position: position?.trim() || null,
      is_me: me?.trim() === "me",
    };
  });

const ALLOWED_STATUSES = [
  "New Lead", "Qualified", "Proposal", "Negotiation", "Won", "On Hold", "Lost",
];

function rule(label: string) {
  console.log(`\n${"─".repeat(72)}\n${label}\n`);
}

async function main() {
  const started = Date.now();

  /**
   * Transcribing an hour of audio is the expensive step, so a cached run can
   * skip straight to the two LLM calls. --save-transcript writes the stitched
   * segments, --transcript replays them.
   */
  const cachePath = flag("transcript");
  if (cachePath) {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    console.log(
      `\nReplaying cached transcript: ${path.basename(cachePath)} ` +
        `(${cached.segments.length} segments, chunked=${cached.chunked})`,
    );
    await runLlmStages(cached.segments, cached.durationSec, cached.chunked);
    rule(`DONE in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return;
  }

  const buffer = await readFile(file!);
  console.log(
    `\nFile: ${path.basename(file!)}  (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`,
  );

  // ---- 1. split ----------------------------------------------------------
  rule("1. PREPARE AUDIO");
  const prepared = await prepareAudio(buffer, path.basename(file!), {
    chunkSeconds: Number(process.env.AUDIO_CHUNK_SECONDS ?? 600),
    sizeLimitBytes: CHUNK_TARGET_BYTES,
  });

  console.log(`duration   ${formatDuration(prepared.durationSec)}`);
  console.log(`chunked    ${prepared.chunked}`);
  console.log(`parts      ${prepared.parts.length}`);
  for (const p of prepared.parts) {
    console.log(
      `  [${p.index}] ${formatDuration(p.startSec)}–${formatDuration(p.endSec)}  ${(p.bytes / 1024 / 1024).toFixed(2)} MB`,
    );
  }

  try {
    // ---- 2. transcribe ---------------------------------------------------
    rule("2. TRANSCRIBE + DIARIZE  (gpt-4o-transcribe-diarize)");
    const t0 = Date.now();
    const results: PartTranscript[] = [];

    await mapWithConcurrency(
      prepared.parts,
      Math.max(1, Number(process.env.AUDIO_CHUNK_CONCURRENCY ?? 3)),
      async (part) => {
        const r = await transcribePart(part, { namespaceLabels: prepared.chunked });
        results.push(r);
        console.log(`  part ${part.index} -> ${r.segments.length} segments`);
      },
    );

    const segments = stitchTranscripts(results);
    console.log(
      `\n${segments.length} segments in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );

    const labels = [...new Set(segments.map((s) => s.rawSpeakerLabel))];
    console.log(`speaker labels: ${labels.join(", ")}`);

    rule("TRANSCRIPT");
    const preview = segments.length > 60 ? segments.slice(0, 40) : segments;
    for (const s of preview) {
      console.log(
        `[${formatDuration(s.startSec)}] ${s.rawSpeakerLabel}: ${s.text}`,
      );
    }
    if (segments.length > preview.length) {
      console.log(`… ${segments.length - preview.length} more segments`);
    }

    const savePath = flag("save-transcript");
    if (savePath) {
      await writeFile(
        savePath,
        JSON.stringify(
          { durationSec: prepared.durationSec, chunked: prepared.chunked, segments },
          null,
          2,
        ),
      );
      console.log(`\nTranscript cached to ${savePath}`);
    }

    if (has("transcribe-only")) {
      console.log(`\nStopped after transcription (--transcribe-only).\n`);
      return;
    }

    if (participants.length === 0) {
      console.log(
        "\nNo --participants given, so speaker mapping and analysis are skipped.\n" +
          "Re-run with --participants to go further.\n",
      );
      return;
    }

    await runLlmStages(segments, prepared.durationSec, prepared.chunked);

    rule(`DONE in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await cleanupWorkDir(prepared.workDir);
  }
}

/** Everything after transcription: the two gpt-5.6-luna calls. */
async function runLlmStages(
  segments: RawSegment[],
  durationSec: number,
  chunked: boolean,
) {
  if (participants.length === 0) {
    console.log("\nNo --participants given; nothing to map or analyse.\n");
    return;
  }

  {
    // ---- 3. map speakers -------------------------------------------------
    rule("3. SPEAKER MAPPING  (gpt-5.6-luna, call A)");
    const proposals = await mapSpeakers({
      title: flag("title") ?? path.basename(file!),
      shortNote: flag("note") ?? null,
      meetingDate: new Date().toISOString().slice(0, 10),
      participants,
      segments,
      chunked,
    });

    for (const p of proposals) {
      console.log(
        `  ${p.rawSpeakerLabel.padEnd(8)} -> ${(p.displayName ?? "(unassigned)").padEnd(22)} ` +
          `conf ${p.confidence.toFixed(2)}  ${p.segmentCount} turns`,
      );
      console.log(`           reason: ${p.reason}`);
    }

    // apply the mapping the way /analyze does
    const nameByLabel = new Map(
      proposals.map((p) => [
        p.rawSpeakerLabel,
        p.displayName ?? `Speaker ${p.rawSpeakerLabel}`,
      ]),
    );
    const labelled = segments.map((s, idx) => ({
      idx,
      speaker_label: nameByLabel.get(s.rawSpeakerLabel)!,
      start_sec: s.startSec,
      end_sec: s.endSec,
      text: s.text,
      excluded: false,
    }));

    const talkRatio = computeTalkRatio(
      labelled,
      participants.map((p) => ({
        display_name: p.display_name,
        speaker_label: p.display_name,
        is_me: p.is_me,
      })),
    );

    rule("TALK RATIO  (measured in code, not by the model)");
    for (const t of talkRatio) {
      console.log(
        `  ${t.name.padEnd(24)} ${formatDuration(t.seconds).padStart(7)}  ${(t.share * 100).toFixed(0)}%${t.is_me ? "  (you)" : ""}`,
      );
    }

    // ---- 4. analyse ------------------------------------------------------
    rule("4. ANALYSIS  (gpt-5.6-luna, call B)");
    const t1 = Date.now();
    const { analysis, model } = await analyzeMeeting({
      title: flag("title") ?? path.basename(file!),
      shortNote: flag("note") ?? null,
      meetingDate: new Date().toISOString().slice(0, 10),
      durationSec,
      companyName: flag("company") ?? null,
      currentCompanyStatus: null,
      allowedStatuses: ALLOWED_STATUSES,
      interestKeys: [
        { key: "food_like", label: "Favourite food" },
        { key: "food_dislike", label: "Favourite food" },
        { key: "movie", label: "Favourite film" },
        { key: "hobby", label: "Hobby" },
        { key: "drink", label: "Favourite drink" },
      ],
      participants,
      knownFacts: [],
      talkRatio,
      transcript: labelled.map((l) => ({
        idx: l.idx,
        speaker: l.speaker_label,
        text: l.text,
        startSec: l.start_sec,
      })),
    });
    console.log(`${model} responded in ${((Date.now() - t1) / 1000).toFixed(1)}s\n`);

    console.log("SUMMARY\n" + analysis.summary);

    console.log("\nKEY TAKEAWAYS");
    analysis.key_takeaways.forEach((t) => console.log(`  - ${t}`));

    console.log("\nDECISIONS");
    analysis.decisions.forEach((d) => console.log(`  - ${d.text}  [idx ${d.evidence_idx}]`));
    if (!analysis.decisions.length) console.log("  (none)");

    console.log("\nRISKS");
    analysis.risks.forEach((r) => console.log(`  - ${r}`));
    if (!analysis.risks.length) console.log("  (none)");

    console.log("\nACTION ITEMS");
    analysis.action_items.forEach((a) =>
      console.log(
        `  - ${a.title}  [${a.assignee_name ?? "unassigned"}${a.due_date ? ", due " + a.due_date : ", no date"}]`,
      ),
    );
    if (!analysis.action_items.length) console.log("  (none)");

    console.log("\nFOLLOW-UP EMAIL\n" + analysis.follow_up_email);

    console.log(
      `\nSUGGESTED COMPANY STATUS: ${analysis.company.suggested_status ?? "none"}` +
        `\n  ${analysis.company.reason}`,
    );

    console.log("\nPEOPLE");
    for (const p of analysis.people) {
      console.log(
        `  ${p.display_name} — ${p.sentiment}, engagement ${p.engagement}/5, ${p.confidence} confidence`,
      );
      console.log(`    emotions: ${p.emotions.join(", ") || "(none)"}`);
      console.log(`    ${p.read_summary}`);
      console.log(`    quote: "${p.evidence_quote}"`);
      for (const f of p.facts) console.log(`    fact [${f.category}]: ${f.fact}`);
    }
    if (!analysis.people.length) console.log("  (none)");

    console.log("\nCOACH");
    console.log("  went well:");
    analysis.coach.went_well.forEach((w) => console.log(`    - ${w}`));
    console.log("  try next time:");
    analysis.coach.improve.forEach((i) =>
      console.log(`    - ${i.observation}\n      -> ${i.suggestion}`),
    );
    console.log(`  talk ratio: ${analysis.coach.talk_ratio_comment}`);
    console.log("  openers:");
    analysis.coach.next_meeting_openers.forEach((o) => console.log(`    - ${o}`));
    console.log("  questions:");
    analysis.coach.questions_to_ask_next.forEach((q) => console.log(`    - ${q}`));
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message ?? err);
  if (err?.status) console.error("HTTP status:", err.status);
  if (err?.error) console.error("detail:", JSON.stringify(err.error).slice(0, 500));
  process.exit(1);
});
