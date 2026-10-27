/**
 * End-to-end test against a running dev server. Run with:
 *
 *   npm run dev            (in one terminal)
 *   npm run e2e -- "path/to/audio.m4a"
 *
 * Unlike scripts/try-pipeline.ts, which exercises the AI libraries directly,
 * this drives the real HTTP routes with a real signed-in session and real
 * Supabase writes: create -> upload -> process -> analyze -> approve -> share
 * -> read the public page. It is the only way to test the route auth, the RLS
 * policies and the state machine together.
 *
 * On the GPU jobs backend it waits for the job to report back, up to 15
 * minutes; a cold GPU alone takes about 4.
 *
 * The session is minted with the admin API and encoded into the cookie format
 * @supabase/ssr expects, so no password is involved anywhere.
 */

import "./load-env";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const MAX_CHUNK = 3180;
/** a cold GPU, a queue for one, and a long recording all fit inside this */
const JOB_WAIT_MS = 15 * 60 * 1000;

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error('Usage: npm run e2e -- "path/to/audio.m4a"');
  process.exit(1);
}

let failures = 0;
const step = (s: string) => console.log(`\n── ${s}`);
const ok = (s: string, d = "") => console.log(`   ok    ${s}${d ? "  — " + d : ""}`);
const bad = (s: string, d = "") => {
  console.log(`   FAIL  ${s}${d ? "  — " + d : ""}`);
  failures++;
};

/** Reproduces the @supabase/ssr cookie encoding: base64- prefix, then chunks. */
function sessionCookies(projectRef: string, session: unknown): string {
  const name = `sb-${projectRef}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

  if (value.length <= MAX_CHUNK) return `${name}=${value}`;

  const parts: string[] = [];
  for (let i = 0, n = 0; i < value.length; i += MAX_CHUNK, n++) {
    parts.push(`${name}.${n}=${value.slice(i, i + MAX_CHUNK)}`);
  }
  return parts.join("; ");
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const email = process.env.OWNER_EMAIL!;
  const projectRef = new URL(url).hostname.split(".")[0];

  const admin = createClient(url, svc, { auth: { persistSession: false } });

  // ---- sign in -----------------------------------------------------------
  step("Session");
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr || !link.properties?.hashed_token) {
    bad("mint magic link", linkErr?.message);
    process.exit(1);
  }

  const asUser = createClient(url, anon, { auth: { persistSession: false } });
  const { data: verified, error: otpErr } = await asUser.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (otpErr || !verified.session) {
    bad("verify otp", otpErr?.message);
    process.exit(1);
  }
  const cookie = sessionCookies(projectRef, verified.session);
  ok("signed in as", email);

  const json = (r: Response) => r.json().catch(() => ({}));
  const authed = (init: RequestInit = {}) => ({
    ...init,
    headers: { ...(init.headers ?? {}), cookie, "Content-Type": "application/json" },
  });

  /**
   * Polls /status until a GPU job has reported back, or null after
   * JOB_WAIT_MS. Against a local dev server the service's callback cannot
   * reach localhost, so this poll is what moves the meeting on: /status asks
   * the service about a job it has not heard from for two minutes.
   */
  async function waitForTranscript(id: string): Promise<{ status: string; error: string | null } | null> {
    const deadline = Date.now() + JOB_WAIT_MS;
    let lastNote = "";
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const res = await fetch(`${BASE}/api/meetings/${id}/status`, authed());
      if (!res.ok) continue;
      const body = await json(res);
      if (body.progress_note && body.progress_note !== lastNote) {
        lastNote = body.progress_note;
        console.log(`   .. ${lastNote}`);
      }
      if (["awaiting_speakers", "review", "ready", "failed"].includes(body.status)) {
        return { status: body.status, error: body.error ?? null };
      }
    }
    return null;
  }

  // ---- the route auth guard actually guards ------------------------------
  //
  // redirect:"manual" matters here. proxy.ts bounces an unauthenticated
  // request to /login, and a normal fetch follows that redirect and reports
  // the login page's 200 — which looks exactly like the route having accepted
  // the request. The only assertion that really proves anything is that no row
  // appeared, so that is checked too.
  step("Auth guard");
  const { count: before } = await admin
    .from("meetings")
    .select("*", { head: true, count: "exact" });

  const anonRes = await fetch(`${BASE}/api/meetings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "SHOULD NEVER EXIST", filename: "x.mp3", size: 1 }),
    redirect: "manual",
  });

  const { count: after } = await admin
    .from("meetings")
    .select("*", { head: true, count: "exact" });

  if ([401, 302, 303, 307, 308].includes(anonRes.status)) {
    ok("unauthenticated POST /api/meetings blocked", `status ${anonRes.status}`);
  } else {
    bad("unauthenticated POST /api/meetings", `got ${anonRes.status}`);
  }
  if ((before ?? 0) === (after ?? 0)) ok("no row created by the anonymous request", `meetings still ${after}`);
  else bad("anonymous request created a row", `${before} -> ${after}`);

  // ---- 1. create ---------------------------------------------------------
  step("1. POST /api/meetings");
  const bytes = await readFile(file!);
  const filename = path.basename(file!);

  const createRes = await fetch(
    `${BASE}/api/meetings`,
    authed({
      method: "POST",
      body: JSON.stringify({
        title: `E2E — ${filename}`,
        short_note: "Automated end-to-end test.",
        meeting_date: new Date().toISOString().slice(0, 10),
        new_company_name: "E2E Test Co",
        consent_confirmed: true,
        filename,
        size: bytes.byteLength,
        mime: "audio/mp4",
        participants: [
          { display_name: "Chad", position: "NTU Master's student", is_me: false },
          { display_name: "KP", position: "NTU CCDS exchange", is_me: true },
        ],
      }),
    }),
  );
  const created = await json(createRes);
  if (!createRes.ok) {
    bad("create meeting", created.error ?? `status ${createRes.status}`);
    process.exit(1);
  }
  ok("meeting created", created.id);
  ok("signed upload URL returned", created.path);

  // ---- 2. upload straight to storage -------------------------------------
  step("2. Upload to Supabase Storage");
  const { error: upErr } = await asUser.storage
    .from("meeting-audio")
    .uploadToSignedUrl(created.path, created.token, bytes, { contentType: "audio/mp4" });
  if (upErr) {
    bad("upload", upErr.message);
    process.exit(1);
  }
  ok("uploaded", `${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`);

  // ---- 3. process ---------------------------------------------------------
  //
  // On the GPU jobs backend /process queues one job for the whole recording
  // and returns {queued:true}; the service reports back on its own, so this
  // waits on /status instead of posting again. On the per-part backend
  // /process returns {complete:false} when it runs out of function time, and
  // posting again resumes.
  step("3. POST /api/meetings/[id]/process");
  const t0 = Date.now();
  let rounds = 0;
  let transcribed = false;
  for (let i = 0; i < 12 && !transcribed; i++) {
    rounds++;
    const res = await fetch(`${BASE}/api/meetings/${created.id}/process`, authed({ method: "POST" }));
    const body = await json(res);
    if (!res.ok) {
      bad("process", body.error ?? `status ${res.status}`);
      process.exit(1);
    }
    if (body.complete) {
      ok(
        "transcribed",
        body.reused
          ? `${body.segments} segments, from the transcript the GPU job already made`
          : `${body.segments} segments, ${body.total} part(s), chunked=${body.chunked}`,
      );
      ok("speakers proposed", `${body.speakers} labels`);
      transcribed = true;
    } else if (body.queued) {
      ok("GPU job queued", body.job_id);
      const final = await waitForTranscript(created.id);
      if (!final) {
        bad(
          "transcription",
          `still transcribing after ${JOB_WAIT_MS / 60_000} minutes. The GPU job may yet finish; meeting ${created.id}`,
        );
        process.exit(1);
      }
      if (final.status === "failed") {
        bad("transcription", final.error ?? "failed");
        process.exit(1);
      }
      ok("transcribed on the GPU service", final.status);
      transcribed = true;
    } else {
      console.log(`   .. resuming (${body.done}/${body.total} parts done)`);
    }
  }
  ok("process rounds", `${rounds} invocation(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // analysing a meeting with no transcript would only fail it
  if (!transcribed) {
    bad("transcription", `not finished after ${rounds} rounds`);
    process.exit(1);
  }

  // ---- 4. status ---------------------------------------------------------
  step("4. GET /api/meetings/[id]/status");
  const statusRes = await fetch(`${BASE}/api/meetings/${created.id}/status`, authed());
  const status = await json(statusRes);
  if (status.status === "awaiting_speakers") ok("state machine", "awaiting_speakers");
  else bad("state machine", `expected awaiting_speakers, got ${status.status}`);

  // ---- 5. analyze --------------------------------------------------------
  step("5. POST /api/meetings/[id]/analyze");
  const { data: mappings } = await admin
    .from("speaker_mappings")
    .select("raw_speaker_label, participant_id, confidence")
    .eq("meeting_id", created.id);

  const assigned = (mappings ?? []).filter((m) => m.participant_id).length;
  ok("mappings stored", `${mappings?.length ?? 0} labels, ${assigned} auto-assigned`);

  const analyzeRes = await fetch(
    `${BASE}/api/meetings/${created.id}/analyze`,
    authed({
      method: "POST",
      body: JSON.stringify({
        mappings: (mappings ?? []).map((m) => ({
          raw_speaker_label: m.raw_speaker_label,
          participant_id: m.participant_id,
        })),
      }),
    }),
  );
  const analyzed = await json(analyzeRes);
  if (!analyzeRes.ok) {
    bad("analyze", analyzed.error ?? `status ${analyzeRes.status}`);
    process.exit(1);
  }
  ok("analysed", `${analyzed.actionItems} action items, ${analyzed.people} people, ${analyzed.facts} facts`);

  // ---- 6. what landed in the database ------------------------------------
  step("6. Database writes");
  const [{ data: meeting }, { data: report }, { data: items }, { data: reads }, { data: facts }, { data: segs }] =
    await Promise.all([
      admin.from("meetings").select("*").eq("id", created.id).single(),
      admin.from("meeting_reports").select("*").eq("meeting_id", created.id).maybeSingle(),
      admin.from("action_items").select("*").eq("meeting_id", created.id),
      admin.from("participant_reads").select("*").eq("meeting_id", created.id),
      admin.from("person_facts").select("*").eq("meeting_id", created.id),
      admin.from("transcript_segments").select("idx, speaker_label, excluded, text").eq("meeting_id", created.id).range(0, 9999),
    ]);

  if (meeting?.status === "review") ok("meetings.status", "review");
  else bad("meetings.status", meeting?.status);
  if (report?.summary) ok("summary", `${report.summary.length} chars`);
  else bad("summary", "empty");
  if (report?.follow_up_email) ok("follow-up email", "present");
  else bad("follow-up email", "empty");
  if (Array.isArray(report?.talk_ratio) && report.talk_ratio.length) ok("talk ratio", report.talk_ratio.map((t: { name: string; share: number }) => `${t.name} ${Math.round(t.share * 100)}%`).join(", "));
  else bad("talk ratio", "empty");
  // .range() above, because a plain select stops at 1000 and would under-report
  ok("transcript segments", String(segs?.length ?? 0));
  ok("action items", `${items?.length ?? 0} (all unapproved: ${items?.every((i) => !i.approved)})`);
  ok("participant reads", String(reads?.length ?? 0));
  ok("person facts", `${facts?.length ?? 0} (all unapproved: ${facts?.every((f) => !f.approved)})`);

  // audio retention default is on, so the recording should be gone
  if (meeting?.audio_deleted_at) ok("audio deleted after processing", "yes");
  else bad("audio deleted after processing", "still present");

  // ---- 7. sharing is refused before approval -----------------------------
  step("7. Share guard");
  const earlyShare = await fetch(`${BASE}/api/meetings/${created.id}/share`, authed({ method: "POST" }));
  if (earlyShare.status === 409) ok("share before approval refused", "409");
  else bad("share before approval", `expected 409, got ${earlyShare.status}`);

  // ---- 8. approve --------------------------------------------------------
  step("8. POST /api/meetings/[id]/approve");
  const approveRes = await fetch(
    `${BASE}/api/meetings/${created.id}/approve`,
    authed({
      method: "POST",
      body: JSON.stringify({
        summary: report?.summary,
        follow_up_email: report?.follow_up_email,
        action_item_ids: (items ?? []).map((i) => i.id),
        fact_ids: (facts ?? []).map((f) => f.id),
        apply_company_status: false,
      }),
    }),
  );
  if (!approveRes.ok) bad("approve", (await json(approveRes)).error);
  else ok("approved", "");

  const { data: afterApprove } = await admin
    .from("meetings")
    .select("status")
    .eq("id", created.id)
    .single();
  if (afterApprove?.status === "ready") ok("meetings.status", "ready");
  else bad("meetings.status", afterApprove?.status);

  const { count: approvedItems } = await admin
    .from("action_items")
    .select("*", { head: true, count: "exact" })
    .eq("meeting_id", created.id)
    .eq("approved", true);
  ok("action items now approved", String(approvedItems ?? 0));

  // ---- 9. share ----------------------------------------------------------
  step("9. POST /api/meetings/[id]/share");
  const shareRes = await fetch(`${BASE}/api/meetings/${created.id}/share`, authed({ method: "POST" }));
  const share = await json(shareRes);
  if (!shareRes.ok || !share.token) {
    bad("create share link", share.error);
  } else {
    ok("share token", share.token);

    // fetch the public page with NO cookie at all
    const pub = await fetch(`${BASE}/s/${share.token}`);
    const html = await pub.text();
    if (pub.ok) ok("public page renders", `status ${pub.status}`);
    else bad("public page", `status ${pub.status}`);

    // the leak test: none of this may appear on a shared page
    const leaks: string[] = [];
    const coach = (report?.coach ?? {}) as { went_well?: string[]; talk_ratio_comment?: string };
    for (const probe of coach.went_well ?? []) if (html.includes(probe)) leaks.push("coach.went_well");
    if (coach.talk_ratio_comment && html.includes(coach.talk_ratio_comment)) leaks.push("coach.talk_ratio_comment");
    for (const r of reads ?? []) {
      if (r.summary && html.includes(r.summary)) leaks.push("participant read summary");
      if (r.evidence_quote && html.includes(r.evidence_quote)) leaks.push("participant read quote");
    }
    for (const f of facts ?? []) if (html.includes(f.fact)) leaks.push("person fact");
    for (const s of (segs ?? []).slice(0, 80)) {
      const line = (s as unknown as { text?: string }).text;
      if (line && line.length > 25 && html.includes(line)) leaks.push("transcript line");
    }
    if (leaks.length === 0) ok("no transcript, facts, reads or coach on the public page", "");
    else bad("PUBLIC PAGE LEAK", [...new Set(leaks)].join(", "));

    // and revocation really revokes
    await fetch(`${BASE}/api/meetings/${created.id}/share`, authed({ method: "DELETE" }));
    const revoked = await fetch(`${BASE}/s/${share.token}`);
    if (revoked.status === 404) ok("revoked link returns 404", "");
    else bad("revoked link", `expected 404, got ${revoked.status}`);
  }

  // ---- 10. RLS isolation --------------------------------------------------
  step("10. RLS isolation");
  const stranger = createClient(url, anon, { auth: { persistSession: false } });
  const { data: strangerRows, error: strangerErr } = await stranger
    .from("meetings")
    .select("id")
    .eq("id", created.id);
  if ((strangerRows?.length ?? 0) === 0) ok("signed-out client sees 0 rows", strangerErr ? strangerErr.message : "blocked by RLS");
  else bad("RLS", `signed-out client read ${strangerRows?.length} row(s)`);

  console.log(
    failures === 0
      ? `\nAll end-to-end checks passed.  Meeting: ${BASE}/meetings/${created.id}\n`
      : `\n${failures} check(s) failed.\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nFAILED:", err?.message ?? err);
  process.exit(1);
});
