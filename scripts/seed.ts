/**
 * Demo data. Run with:  npm run seed
 *
 * Creates (or reuses) a demo user, then fills the account so no screen in the
 * demo is empty: 8 companies across the pipeline, 14 people, 5 processed
 * meetings with reports, facts, emotion reads and coach notes, and 9
 * follow-ups of which 2 are overdue.
 *
 * Idempotent-ish: it clears this user's existing rows first, so re-running
 * gives the same starting state rather than doubling everything up.
 */

import "./load-env";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEMO_EMAIL = process.env.SEED_EMAIL ?? "sarah@rapport.demo";
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "rapport-demo-123";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill them in first.",
  );
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const daysAhead = (n: number) => daysAgo(-n);

async function getOrCreateUser() {
  const { data: list } = await db.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === DEMO_EMAIL);
  if (existing) return existing.id;

  const { data, error } = await db.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Sarah Johnson" },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  console.log("Seeding demo data…");
  const userId = await getOrCreateUser();

  // Wipe this user's data so re-running is predictable.
  await db.from("meetings").delete().eq("owner_id", userId);
  await db.from("person_facts").delete().eq("owner_id", userId);
  await db.from("people").delete().eq("owner_id", userId);
  await db.from("companies").delete().eq("owner_id", userId);

  await db
    .from("profiles")
    .upsert({ id: userId, full_name: "Sarah Johnson", job_title: "Account Executive" });

  // The rapport_handle_new_user trigger seeds statuses; make sure they exist anyway
  // for a user created before the migration ran.
  const { data: existingStatuses } = await db
    .from("status_options")
    .select("*")
    .eq("owner_id", userId);

  if (!existingStatuses?.length) {
    const company = ["New Lead", "Qualified", "Proposal", "Negotiation", "Won", "On Hold", "Lost"];
    const companyColors = ["#64748B", "#0EA5E9", "#1E3A8A", "#E8D48B", "#10B981", "#94A3B8", "#DC2626"];
    const person = ["Champion", "Supporter", "Neutral", "Sceptic", "Blocker", "Unknown"];
    const personColors = ["#10B981", "#0EA5E9", "#64748B", "#E8D48B", "#F97316", "#94A3B8"];

    await db.from("status_options").insert([
      ...company.map((label, i) => ({
        owner_id: userId,
        applies_to: "company",
        label,
        color: companyColors[i],
        sort_order: i + 1,
        is_won: label === "Won",
      })),
      ...person.map((label, i) => ({
        owner_id: userId,
        applies_to: "person",
        label,
        color: personColors[i],
        sort_order: i + 1,
      })),
    ]);
  }

  const { data: statuses } = await db
    .from("status_options")
    .select("*")
    .eq("owner_id", userId);

  const statusId = (scope: string, label: string) =>
    statuses?.find((s) => s.applies_to === scope && s.label === label)?.id ?? null;

  // ---- companies ----------------------------------------------------------
  const companySeed = [
    { name: "Northpeak Logistics", status: "Negotiation", deal_value: 84000, kind: "prospect" },
    { name: "Meridian Foods", status: "Proposal", deal_value: 42000, kind: "prospect" },
    { name: "Harbourline Marine", status: "Qualified", deal_value: 28000, kind: "prospect" },
    { name: "Kestrel Retail Group", status: "Won", deal_value: 115000, kind: "client" },
    { name: "Sunda Textiles", status: "New Lead", deal_value: null, kind: "prospect" },
    { name: "Aurora Health", status: "On Hold", deal_value: 31000, kind: "prospect" },
    { name: "Pinnacle Freight", status: "Lost", deal_value: 19000, kind: "prospect" },
    { name: "Tanjong Partners", status: "Qualified", deal_value: 56000, kind: "partner" },
  ];

  const { data: companies } = await db
    .from("companies")
    .insert(
      companySeed.map((c) => ({
        owner_id: userId,
        name: c.name,
        kind: c.kind,
        deal_value: c.deal_value,
        status_id: statusId("company", c.status),
      })),
    )
    .select("*");

  const companyId = (name: string) => companies?.find((c) => c.name === name)?.id ?? null;

  // ---- people --------------------------------------------------------------
  const peopleSeed = [
    ["Mr Tan Wei Ming", "COO", "Northpeak Logistics", "Champion"],
    ["Priya Raman", "Head of Procurement", "Northpeak Logistics", "Sceptic"],
    ["Daniel Koh", "Finance Director", "Northpeak Logistics", "Neutral"],
    ["Grace Lim", "Operations Lead", "Meridian Foods", "Supporter"],
    ["Arjun Menon", "CTO", "Meridian Foods", "Neutral"],
    ["Captain Rahim Yusof", "Fleet Manager", "Harbourline Marine", "Champion"],
    ["Siti Nurhaliza", "Commercial Manager", "Harbourline Marine", "Supporter"],
    ["Jonathan Ng", "Managing Director", "Kestrel Retail Group", "Champion"],
    ["Elaine Chua", "Store Operations", "Kestrel Retail Group", "Supporter"],
    ["Wong Kah Fai", "Owner", "Sunda Textiles", "Unknown"],
    ["Dr Michelle Oh", "Clinical Director", "Aurora Health", "Blocker"],
    ["Ben Sharma", "Logistics Manager", "Pinnacle Freight", "Neutral"],
    ["Alicia Fernandez", "Partnerships Lead", "Tanjong Partners", "Champion"],
    ["Hakim Abdullah", "Business Development", "Tanjong Partners", "Supporter"],
  ] as const;

  const { data: people } = await db
    .from("people")
    .insert(
      peopleSeed.map(([full_name, position, company, status]) => ({
        owner_id: userId,
        full_name,
        position,
        company_id: companyId(company),
        status_id: statusId("person", status),
      })),
    )
    .select("*");

  const personId = (name: string) => people?.find((p) => p.full_name === name)?.id ?? null;

  // ---- meetings ------------------------------------------------------------
  const meetingSeed = [
    {
      title: "Northpeak — contract terms",
      company: "Northpeak Logistics",
      date: daysAgo(2),
      status: "review" as const,
      summary:
        "Wei Ming walked through the revised terms and is comfortable with the two-year commitment, provided the volume discount starts at 400 pallets rather than 500. Priya pushed back hard on the implementation timeline, saying her team cannot absorb a go-live in the same quarter as their WMS migration. Daniel asked for a payment schedule spread across four quarters instead of two. We agreed to send a revised proposal by Friday and to hold a technical scoping call the following week. Nothing was signed.",
      takeaways: [
        "Wei Ming supports the deal and is the one pushing internally.",
        "The 500-pallet discount threshold is the live commercial objection.",
        "Priya will block a Q3 go-live because of the WMS migration.",
        "Daniel wants payment spread across four quarters.",
      ],
      decisions: [
        { text: "Revised proposal to be sent by Friday", evidence_idx: 24 },
        { text: "Technical scoping call to be held next week", evidence_idx: 41 },
      ],
      risks: [
        "The WMS migration could push go-live out by a full quarter.",
        "Priya has not been given a reason to support this yet.",
      ],
      sentiment: "mixed" as const,
      items: [
        { title: "Send revised proposal with 400-pallet threshold", who: "Sarah Johnson", due: daysAgo(1) },
        { title: "Book technical scoping call with Priya's team", who: "Sarah Johnson", due: daysAhead(3) },
        { title: "Share four-quarter payment option with finance", who: "Daniel Koh", due: daysAhead(6) },
      ],
    },
    {
      title: "Meridian Foods — first call",
      company: "Meridian Foods",
      date: daysAgo(9),
      status: "ready" as const,
      summary:
        "An introductory call with Grace and Arjun. Meridian is opening two new distribution points in Johor and wants cold-chain visibility they do not currently have. Grace described their present process as spreadsheets and phone calls, and was candid that a failed audit last year is what started the search. Arjun asked detailed questions about API access and was satisfied with the answers. They want a proposal in two weeks, after their board meeting.",
      takeaways: [
        "Two new Johor distribution points are the trigger for this project.",
        "A failed cold-chain audit last year created the urgency.",
        "Arjun needs API access and is technically satisfied so far.",
      ],
      decisions: [{ text: "Proposal to follow their board meeting in two weeks", evidence_idx: 52 }],
      risks: ["The board meeting could deprioritise this entirely."],
      sentiment: "positive" as const,
      items: [
        { title: "Draft proposal for Meridian cold-chain visibility", who: "Sarah Johnson", due: daysAhead(8) },
        { title: "Send API documentation to Arjun", who: "Sarah Johnson", due: daysAgo(5) },
      ],
    },
    {
      title: "Harbourline — quarterly review",
      company: "Harbourline Marine",
      date: daysAgo(16),
      status: "ready" as const,
      summary:
        "Captain Rahim is pleased with fleet uptime and said so several times. Siti raised that invoices have been arriving with the wrong cost centre for three months, which has caused friction with their finance team. We agreed to fix the billing reference and to look at extending coverage to their two newest vessels. Rahim mentioned he is retiring in eighteen months and wants the handover to be clean.",
      takeaways: [
        "Fleet uptime is genuinely well regarded.",
        "Three months of incorrect cost centres on invoices is a real irritant.",
        "Two new vessels are a natural expansion.",
        "Rahim retires in about eighteen months.",
      ],
      decisions: [
        { text: "Billing cost centre to be corrected this month", evidence_idx: 18 },
        { text: "Quote to be prepared for the two new vessels", evidence_idx: 37 },
      ],
      risks: ["Rahim is the relationship. His retirement is a succession risk."],
      sentiment: "positive" as const,
      items: [
        { title: "Fix cost centre on Harbourline invoices", who: "Sarah Johnson", due: daysAgo(3) },
        { title: "Quote coverage for the two new vessels", who: "Sarah Johnson", due: daysAhead(11) },
      ],
    },
    {
      title: "Kestrel — renewal signed",
      company: "Kestrel Retail Group",
      date: daysAgo(24),
      status: "ready" as const,
      summary:
        "Jonathan confirmed the renewal at the higher tier and signed during the call. Elaine walked through the rollout to the remaining eleven stores and asked for on-site training rather than remote. We agreed training would happen across two visits in the next six weeks. Jonathan was warm throughout and offered to act as a reference for other retail prospects.",
      takeaways: [
        "Renewal signed at the higher tier.",
        "Eleven stores still to roll out, with on-site training requested.",
        "Jonathan has offered to be a reference.",
      ],
      decisions: [
        { text: "Renewal signed at the higher tier", evidence_idx: 8 },
        { text: "Two on-site training visits within six weeks", evidence_idx: 29 },
      ],
      risks: [],
      sentiment: "positive" as const,
      items: [
        { title: "Schedule first on-site training visit", who: "Elaine Chua", due: daysAhead(14) },
        { title: "Add Jonathan to the reference list", who: "Sarah Johnson", due: daysAhead(20) },
      ],
    },
    {
      title: "Aurora Health — discovery",
      company: "Aurora Health",
      date: daysAgo(31),
      status: "ready" as const,
      summary:
        "Dr Oh was direct that she does not believe an external logistics partner can meet their chain-of-custody requirements, and spent most of the call testing that. The conversation stayed professional but sceptical. She asked for evidence from a comparable healthcare deployment before any further meetings. There was no commitment to a next step and the account should be treated as paused rather than active.",
      takeaways: [
        "Chain of custody is the entire objection.",
        "Dr Oh wants evidence from a comparable healthcare client before continuing.",
        "No next meeting was agreed.",
      ],
      decisions: [],
      risks: [
        "No agreed next step, and the sceptic is the decision maker.",
        "Without a healthcare reference this is unlikely to progress.",
      ],
      sentiment: "negative" as const,
      items: [
        { title: "Find a healthcare chain-of-custody case study", who: "Sarah Johnson", due: daysAhead(5) },
      ],
    },
  ];

  const coachFor = (title: string) => ({
    went_well: [
      "You let the objection finish before answering it.",
      "Naming the timeline concern out loud kept it from festering.",
    ],
    improve: [
      {
        observation: "You answered the pricing question with a feature list.",
        suggestion: "Try: \"Before I answer that, what would make the number feel right to you?\"",
      },
      {
        observation: "The next step was agreed verbally but never restated.",
        suggestion: "Close with \"so by Friday I send X, and you do Y\" — it takes ten seconds.",
      },
    ],
    talk_ratio_comment:
      "You spoke for about two thirds of this one. On a call where the other side has the objection, aim closer to half.",
    next_meeting_openers: [
      `Pick up where ${title.split(" — ")[0]} left off: ask how the internal conversation went.`,
      "Open with the thing they asked for, not with your update.",
    ],
    questions_to_ask_next: [
      "What would have to be true for this to start next quarter?",
      "Who else needs to be comfortable before this moves?",
      "What is the cost of doing nothing for another six months?",
    ],
  });

  let seededItems = 0;

  for (const m of meetingSeed) {
    const attendees = (people ?? []).filter((p) => p.company_id === companyId(m.company));

    const { data: meeting } = await db
      .from("meetings")
      .insert({
        owner_id: userId,
        company_id: companyId(m.company),
        title: m.title,
        meeting_date: m.date,
        status: m.status,
        consent_confirmed: true,
        duration_sec: 1500 + Math.floor(Math.random() * 900),
        audio_deleted_at: new Date().toISOString(),
        short_note: null,
      })
      .select("*")
      .single();

    if (!meeting) continue;

    const participants = [
      { meeting_id: meeting.id, display_name: "Sarah Johnson", position: "Account Executive", is_me: true, speaker_label: "Sarah Johnson" },
      ...attendees.map((p) => ({
        meeting_id: meeting.id,
        person_id: p.id,
        display_name: p.full_name,
        position: p.position,
        is_me: false,
        speaker_label: p.full_name,
      })),
    ];
    await db.from("meeting_participants").insert(participants);

    // A short, believable transcript so evidence links land somewhere real.
    const lines: { speaker: string; text: string }[] = [];
    for (let i = 0; i < 60; i++) {
      const speaker = i % 3 === 0 ? "Sarah Johnson" : (attendees[i % Math.max(1, attendees.length)]?.full_name ?? "Sarah Johnson");
      lines.push({
        speaker,
        text:
          i === 24
            ? "Right, so I will get the revised proposal over to you by Friday."
            : i === 41
              ? "Let us put a technical scoping call in for next week then."
              : "Understood — and that lines up with what we discussed last time.",
      });
    }

    await db.from("transcript_segments").insert(
      lines.map((l, idx) => ({
        meeting_id: meeting.id,
        idx,
        chunk_index: 0,
        raw_speaker_label: l.speaker === "Sarah Johnson" ? "A" : "B",
        speaker_label: l.speaker,
        start_sec: idx * 25,
        end_sec: idx * 25 + 22,
        text: l.text,
      })),
    );

    const talkRatio = [
      { name: "Sarah Johnson", seconds: 880, share: 0.62, is_me: true },
      ...attendees.map((p, i) => ({
        name: p.full_name,
        seconds: 320 - i * 90,
        share: (320 - i * 90) / 1420,
        is_me: false,
      })),
    ];

    await db.from("meeting_reports").insert({
      meeting_id: meeting.id,
      summary: m.summary,
      key_takeaways: m.takeaways,
      decisions: m.decisions,
      risks: m.risks,
      coach: coachFor(m.title),
      talk_ratio: talkRatio,
      follow_up_email: `Hi ${attendees[0]?.full_name.split(" ")[0] ?? "there"},\n\nThank you for your time today. To recap what we agreed:\n\n${m.decisions.map((d) => `- ${d.text}`).join("\n") || "- I will follow up with the detail we discussed."}\n\nI will come back to you with the revised numbers shortly. Do shout if I have missed anything.\n\nBest regards,\nSarah`,
      suggested_company_status: m.status === "review" ? "Negotiation" : null,
      suggested_status_reason:
        m.status === "review"
          ? "Terms were discussed line by line and a revised proposal was requested."
          : null,
      model: "seed",
      approved_at: m.status === "ready" ? new Date().toISOString() : null,
    });

    for (const p of attendees) {
      await db.from("participant_reads").insert({
        meeting_id: meeting.id,
        person_id: p.id,
        display_name: p.full_name,
        sentiment: m.sentiment,
        emotions:
          m.sentiment === "positive"
            ? ["warm", "engaged"]
            : m.sentiment === "negative"
              ? ["guarded", "sceptical"]
              : ["curious", "hesitant"],
        engagement: m.sentiment === "positive" ? 4 : m.sentiment === "negative" ? 2 : 3,
        summary: `${p.full_name.split(" ")[0]} was ${m.sentiment === "positive" ? "engaged and forthcoming" : m.sentiment === "negative" ? "polite but unconvinced" : "interested but cautious"} through most of the conversation.`,
        evidence_quote: "That lines up with what we discussed last time.",
        confidence: m.sentiment === "negative" ? "medium" : "high",
      });
    }

    for (const item of m.items) {
      await db.from("action_items").insert({
        meeting_id: meeting.id,
        owner_id: userId,
        person_id: personId(item.who),
        title: item.title,
        assignee_name: item.who,
        due_date: item.due,
        approved: m.status === "ready",
        done: false,
        evidence_idx: 24,
      });
      seededItems++;
    }
  }

  // ---- the personal facts that make the demo land -------------------------
  const factSeed: [string, string, string][] = [
    ["Mr Tan Wei Ming", "food_dislike", "Does not take spicy food"],
    ["Mr Tan Wei Ming", "food_like", "Loves kaya toast — suggested Killiney for the next catch-up"],
    ["Mr Tan Wei Ming", "communication_style", "Prefers WhatsApp to email for anything quick"],
    ["Mr Tan Wei Ming", "hobby", "Cycles on weekends, does the East Coast route"],
    ["Priya Raman", "communication_style", "Wants the detail up front, dislikes being walked through slides"],
    ["Priya Raman", "interest", "Studied supply chain at NUS"],
    ["Grace Lim", "hobby", "Runs half marathons, doing the Standard Chartered one this year"],
    ["Grace Lim", "food_like", "Big on kopi, drinks it kosong"],
    ["Captain Rahim Yusof", "personal", "Retiring in about eighteen months"],
    ["Captain Rahim Yusof", "hobby", "Keeps koi, talked about it for five minutes"],
    ["Jonathan Ng", "communication_style", "Decides fast, hates long email threads"],
    ["Jonathan Ng", "food_like", "Suggested chicken rice at Tiong Bahru for the next one"],
    ["Alicia Fernandez", "interest", "Used to work in the same industry as me, knows the players"],
    ["Dr Michelle Oh", "communication_style", "Wants evidence before conversation, not after"],
  ];

  await db.from("person_facts").insert(
    factSeed
      .filter(([name]) => personId(name))
      .map(([name, category, fact]) => ({
        owner_id: userId,
        person_id: personId(name)!,
        category,
        fact,
        evidence_quote: null,
        approved: true,
      })),
  );

  console.log(`
Done.

  Sign in with:  ${DEMO_EMAIL}
  Password:      ${DEMO_PASSWORD}

  ${companySeed.length} companies · ${peopleSeed.length} people · ${meetingSeed.length} meetings
  ${seededItems} follow-ups · ${factSeed.length} saved facts

One meeting is left in 'review' so the dashboard inbox has something in it.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
