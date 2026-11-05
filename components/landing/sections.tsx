import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { LepaqLogo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";

import styles from "./landing.module.css";
import { APP_HREF, BENCHMARK_HREF, SAMPLE, WALKTHROUGH_HREF } from "./sample";

/**
 * Everything below the opening. Server components only: the one interactive
 * piece on the page is the hero's sample.
 *
 * Every product claim here is something the app does today (see the README
 * and lib/), and every model number is copied from the public WhisperLah
 * results table. Change a number only when that table changes.
 */

const WRAP = "mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#people", label: "People" },
  { href: "#singlish", label: "Singlish" },
  { href: "#privacy", label: "Privacy" },
];

export function LandingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-card"
      >
        Skip to content
      </a>
      <div className={cn(WRAP, "flex h-16 items-center justify-between gap-6")}>
        <Link href="/" aria-label="Lepaq, home" className="rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/60">
          <LepaqLogo className="text-[1.4rem]" />
        </Link>
        <nav aria-label="Page sections" className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <Link
            href={WALKTHROUGH_HREF}
            className="hidden rounded text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 lg:inline"
          >
            Walkthrough
          </Link>
          <Link
            href={APP_HREF}
            prefetch={false}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary-hover focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            Open Lepaq
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}

function SectionHead({
  n,
  label,
  title,
  children,
  invert = false,
  id,
}: {
  n: string;
  label: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  invert?: boolean;
  id: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-12 gap-y-5 border-t pt-6 lg:grid-cols-12", invert && "border-white/15")}>
      <p className={cn(styles.mono, "lg:col-span-3", invert ? "text-white/60" : "text-muted-foreground")}>
        {n} <span aria-hidden>—</span> {label}
      </p>
      <div className="lg:col-span-9">
        <h2 id={id} className={cn(styles.display, "max-w-[18ch] text-[2.5rem] leading-[1.02] sm:text-[3.25rem] lg:text-[4rem]")}>
          {title}
        </h2>
        {children && (
          <div
            className={cn(
              "mt-5 max-w-[40rem] text-[1.02rem] leading-relaxed",
              invert ? "text-white/75" : "text-muted-foreground",
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────── 01 How it works ─────────────────────────────── */

const STEPS = [
  {
    n: "01",
    name: "Capture",
    title: "Ask, then record.",
    body: "The new-meeting flow asks for consent first. Record in the browser, with pause always in reach, or upload the audio afterwards.",
    state: "uploaded → transcribing",
    yours: false,
  },
  {
    n: "02",
    name: "Check",
    title: "Confirm who spoke.",
    body: "WhisperLah writes the transcript and splits the voices. You match each voice to a name before anything is analysed.",
    state: "awaiting_speakers",
    yours: true,
  },
  {
    n: "03",
    name: "Review",
    title: "Tick what is real.",
    body: "A report with a summary, decisions, follow-ups, a draft email and coaching notes. Each follow-up links to the line it came from.",
    state: "analyzing → review",
    yours: true,
  },
  {
    n: "04",
    name: "Follow through",
    title: "Pick up with context.",
    body: "Ticked follow-ups land in one list, and on the person and company they belong to, with the meeting a click away.",
    state: "ready",
    yours: false,
  },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" id="how" className={cn(WRAP, "scroll-mt-20 py-20 lg:py-28")}>
      <SectionHead n="01" label="How it works" title="From kopi to follow‑through." id="how-title">
        <p>
          The AI drafts, you decide. Nothing Lepaq writes becomes a task, a
          fact or an email until you have checked it.
        </p>
      </SectionHead>

      <ol className="mt-12 grid border-y lg:mt-16 lg:grid-cols-4">
        {STEPS.map((s) => (
          <li key={s.n} className={cn(styles.ledgerRow, "py-7 lg:px-7 lg:py-9 lg:first:pl-0")}>
            <p className={cn(styles.mono, "flex items-center gap-2 text-muted-foreground")}>
              {s.n} · {s.name}
              {s.yours && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-on-butter">
                  <span className="size-1.5 rounded-full bg-brand" aria-hidden />
                  Your call
                </span>
              )}
            </p>
            <h3 className={cn(styles.display, "mt-4 text-[1.85rem] leading-tight")}>{s.title}</h3>
            <p className="mt-3 max-w-[30rem] text-[0.95rem] leading-relaxed text-muted-foreground">{s.body}</p>
            <p className="mt-5 font-mono text-xs text-muted-foreground/90">
              <span className="sr-only">Pipeline state: </span>
              {s.state}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        The last line of each step is the meeting&apos;s real state in the app.
      </p>
    </section>
  );
}

/* ─────────────────────────────── 02 People ─────────────────────────────── */

export function PeopleSection() {
  return (
    <section aria-labelledby="people-title" id="people" className="scroll-mt-20 border-y bg-card">
      <div className={cn(WRAP, "py-20 lg:py-28")}>
        <SectionHead
          n="02"
          label="People and companies"
          title="One page per person. It grows with every chat."
          id="people-title"
        >
          <p>
            Lepaq turns the people in a meeting into contacts and folds repeat
            meetings into one profile: what was said, what was promised, and
            the small things worth remembering next time. Companies gather
            their people, meetings and status.
          </p>
        </SectionHead>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-12">
          <ul className="grid content-start gap-0 lg:col-span-4">
            {[
              ["People", "Created from meeting participants. Meet someone twice and it is still one page."],
              ["Companies", "Status, people and every meeting, with a handover page when an account changes hands."],
              ["Follow-ups", "Everything you ticked, across every meeting, in one list with due dates."],
              ["Table of Interest", "Columns you choose, like favourite drink, filled from what people mention."],
            ].map(([name, body]) => (
              <li key={name} className="border-t py-5 first:border-t-0 first:pt-0 lg:first:border-t lg:first:pt-5">
                <p className="font-medium">{name}</p>
                <p className="mt-1 text-[0.95rem] leading-relaxed text-muted-foreground">{body}</p>
              </li>
            ))}
          </ul>

          <ProfileSample />
        </div>
      </div>
    </section>
  );
}

function ProfileSample() {
  return (
    <figure className="relative lg:col-span-8" aria-label="Illustrative person page for the sample contact">
      <div className={cn(styles.chit, "border px-5 pb-6 pt-7 sm:px-7")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex size-12 items-center justify-center rounded-full bg-sidebar text-base font-semibold text-white">
              {SAMPLE.initials}
            </span>
            <div>
              <p className={cn(styles.display, "text-[2rem] leading-none")}>{SAMPLE.person}</p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {SAMPLE.company} · <span className="text-foreground">{SAMPLE.companyStatus}</span>
              </p>
            </div>
          </div>
          <span className={cn(styles.mono, "rounded-full border px-2 py-0.5 text-muted-foreground")}>Sample</span>
        </div>

        <div className="mt-7 grid gap-8 sm:grid-cols-2">
          <div>
            <p className={cn(styles.mono, "text-muted-foreground")}>Meetings</p>
            <ol className="mt-2">
              <li className="flex items-baseline justify-between gap-4 border-b py-3">
                <span className="font-medium">{SAMPLE.meeting}</span>
                <span className="font-mono text-xs text-muted-foreground">5 Nov</span>
              </li>
              <li className="flex items-baseline justify-between gap-4 py-3">
                <span>{SAMPLE.earlier.meeting}</span>
                <span className="font-mono text-xs text-muted-foreground">{SAMPLE.earlier.when}</span>
              </li>
            </ol>

            <p className={cn(styles.mono, "mt-6 text-muted-foreground")}>Open follow-up</p>
            <div className="mt-2 flex items-center gap-3 rounded-lg border bg-background/60 px-3 py-2.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-success-solid text-white" aria-hidden>
                <svg viewBox="0 0 16 16" className="size-3.5">
                  <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{SAMPLE.followUp}</span>
              <span className={cn(styles.chip, "text-sm")}>{SAMPLE.due}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              From {SAMPLE.meeting}, {SAMPLE.at}: &ldquo;{SAMPLE.quote.title} by {SAMPLE.quote.due}, can?&rdquo;
            </p>
          </div>

          <div>
            <p className={cn(styles.mono, "text-muted-foreground")}>Remember</p>
            <dl className="mt-2">
              {SAMPLE.facts.map((f) => (
                <div key={f.label} className="border-b py-3 last:border-b-0">
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="mt-0.5 font-medium">{f.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 rounded-lg bg-butter-soft px-3 py-2.5 text-[0.9rem] leading-snug text-on-butter">
              Facts are suggestions until you approve them, and each one keeps
              the quote it came from.
            </p>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        Illustrative page with made-up data, laid out like the app&apos;s People view.
      </figcaption>
    </figure>
  );
}

/* ─────────────────────────────── 03 Singlish ─────────────────────────────── */

/** NSC Part 3, two-person conversation, 997 clips: WhisperLah results table, README. */
const CONVERSATION_WER = [
  { model: "WhisperLah v3", who: "Lepaq", wer: 18.0, lead: true },
  { model: "Distil-Whisper large-v3.5", who: "open model", wer: 25.2 },
  { model: "GPT Transcribe", who: "OpenAI API", wer: 26.9 },
  { model: "MERaLiON-2-3B", who: "A*STAR", wer: 26.9 },
  { model: "Whisper large-v3-turbo", who: "OpenAI, our base model", wer: 27.7 },
];
const AXIS_MAX = 30;

export function SinglishSection() {
  return (
    <section aria-labelledby="singlish-title" id="singlish" className={cn(styles.inkBand, "scroll-mt-16")}>
      <div className={cn(WRAP, "py-20 lg:py-28")}>
        <SectionHead n="03" label="WhisperLah · Singlish" title="Trained for the way Singapore talks." id="singlish-title" invert>
          <p>
            Most speech models were built for American English on video
            calls. Lepaq transcribes with WhisperLah, our own model: we taught
            OpenAI&apos;s open Whisper model Singlish and code-switching. On
            two-person Singlish conversation it now makes fewer errors than
            every other model we tested, OpenAI&apos;s paid API included.
          </p>
        </SectionHead>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-12">
          <figure className="lg:col-span-7">
            <figcaption>
              <p className="font-medium text-white">Word error rate on two-person Singlish conversation</p>
              <p className="mt-1 text-sm text-white/60">NSC Part 3, 997 clips, same clips and text normaliser for every model. Lower is better.</p>
            </figcaption>
            <div className="relative mt-7">
              {/* hairline grid at 0, 10, 20, 30 */}
              <div className="pointer-events-none absolute inset-y-0 left-[var(--label-w)] right-[3.75rem] [--label-w:0px] sm:[--label-w:15rem]" aria-hidden>
                {[0, 10, 20, 30].map((v) => (
                  <span key={v} className="absolute inset-y-0 border-l border-white/10" style={{ left: `${(v / AXIS_MAX) * 100}%` }} />
                ))}
              </div>
              <table className="relative w-full border-separate border-spacing-0 text-left">
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Word error rate, %</th>
                  </tr>
                </thead>
                <tbody>
                  {CONVERSATION_WER.map((row) => (
                    <tr key={row.model} className="group block py-2.5 sm:table-row sm:py-0">
                      <th
                        scope="row"
                        className="block pb-1.5 pr-4 align-middle text-sm font-normal sm:table-cell sm:w-[15rem] sm:py-2.5"
                      >
                        <span className={cn(row.lead ? "font-semibold text-white" : "text-white/85")}>{row.model}</span>
                        <span className="block text-xs text-white/60">{row.who}</span>
                      </th>
                      <td className="block align-middle sm:table-cell sm:py-2.5">
                        <span className="flex items-center gap-3 pr-0">
                          <span className="relative block flex-1">
                            <span
                              className={cn(styles.bar, row.lead && styles.barLead, "block transition-opacity group-hover:opacity-90")}
                              style={{ width: `${(row.wer / AXIS_MAX) * 100}%` }}
                            />
                          </span>
                          <span className={cn("w-12 shrink-0 text-right font-mono text-sm tabular-nums", row.lead ? "text-white" : "text-white/75")}>
                            {row.wer.toFixed(1)}%
                          </span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 hidden pl-[15rem] pr-[3.75rem] font-mono text-[0.7rem] text-white/60 sm:block" aria-hidden>
                <div className="relative h-4">
                  {[0, 10, 20, 30].map((v) => (
                    <span key={v} className="absolute -translate-x-1/2" style={{ left: `${(v / AXIS_MAX) * 100}%` }}>
                      {v}%
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-6 text-xs leading-relaxed text-white/60">
              A*STAR&apos;s larger MERaLiON-2-10B-ASR was run on a 299-clip
              sample of this set: 22.4%, against 18.8% for WhisperLah on the
              same clips.
            </p>
          </figure>

          <div className="grid content-start gap-0 lg:col-span-5">
            {[
              {
                figure: "14.8%",
                body: "word error rate on SASRBench-v1, the public Singlish benchmark. Next best: 15.8%, OpenAI's GPT Transcribe.",
              },
              {
                figure: "76%",
                body: "of discourse particles (lah, leh, lor …) written down in conversation. Next best: 50%.",
              },
              {
                figure: "5 of 7",
                body: "Singlish test sets where WhisperLah has the lowest error, against 17 other models and API settings.",
              },
            ].map((s) => (
              <div key={s.figure} className="border-t border-white/15 py-5 first:border-t-0 first:pt-0 lg:first:border-t lg:first:pt-5">
                <p className={cn(styles.display, "text-[3rem] leading-none text-white")}>{s.figure}</p>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-white/70">{s.body}</p>
              </div>
            ))}
            <p className="border-t border-white/15 pt-5 text-xs leading-relaxed text-white/60">
              Behind A*STAR&apos;s MERaLiON-2-3B on two read-speech sets (NSC
              Parts 1 and 2). Not every vendor has been tested yet. The
              evaluation harness and per-clip results are public; the model
              weights are not.
            </p>
            <a
              href={BENCHMARK_HREF}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 self-start rounded text-sm font-medium text-white underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-brand/70"
            >
              See the benchmark on GitHub
              <ArrowUpRight className="size-4" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 04 Privacy ─────────────────────────────── */

const PRIVACY = [
  ["Drafts until you tick", "Everything the AI writes stays a private draft until you approve it."],
  ["No manager view", "Lepaq is built for the person in the meeting, not for oversight of them."],
  ["Consent first", "Starting a meeting means confirming the other side is happy for you to take notes."],
  ["Audio deleted", "Recordings are deleted after transcription, by default."],
  ["Sensitive topics stay out", "Health, religion, politics, ethnicity, sexuality and money are blocked in the prompt, the code and the database."],
  ["Yours alone", "Row-level security on every table. A share link shows only the summary you approved."],
];

export function PrivacySection() {
  return (
    <section aria-labelledby="privacy-title" id="privacy" className={cn(WRAP, "scroll-mt-20 py-20 lg:py-28")}>
      <SectionHead n="04" label="Private by default" title="Your notes. Not your manager's." id="privacy-title">
        <p>
          Where business runs on trust, nobody records a client unless the
          notes clearly belong to them. So in Lepaq they do.
        </p>
      </SectionHead>
      <dl className="mt-12 grid border-t sm:grid-cols-2 lg:mt-16 lg:grid-cols-3">
        {PRIVACY.map(([name, body], i) => (
          <div
            key={name}
            className={cn(
              "border-b py-6 sm:px-6 sm:first:pl-0",
              i % 2 === 1 && "sm:border-l",
              "lg:border-l-0 lg:px-6",
              i % 3 !== 0 && "lg:border-l",
              i % 3 === 0 && "lg:pl-0",
              i % 2 === 0 && "sm:pl-0",
            )}
          >
            <dt className="flex items-center gap-2 font-medium">
              <span className="size-1.5 rounded-full bg-foreground" aria-hidden />
              {name}
            </dt>
            <dd className="mt-2 text-[0.95rem] leading-relaxed text-muted-foreground">{body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ─────────────────────────────── Close ─────────────────────────────── */

export function Closing() {
  return (
    <section aria-labelledby="close-title" className="border-t bg-card">
      <div className={cn(WRAP, "grid grid-cols-1 gap-10 py-20 lg:grid-cols-12 lg:py-28")}>
        <div className="lg:col-span-8">
          <p className={cn(styles.mono, "text-muted-foreground")}>Next coffee chat</p>
          <h2 id="close-title" className={cn(styles.display, "mt-4 text-[2.75rem] leading-[1] sm:text-[4rem] lg:text-[5.25rem]")}>
            Bring Lepaq. Leave with the follow‑up.
          </h2>
        </div>
        <div className="flex flex-col justify-end gap-4 lg:col-span-4 lg:items-start">
          <Link
            href={APP_HREF}
            prefetch={false}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-on-brand outline-none transition-colors hover:bg-brand-hover focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            Open Lepaq
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href={WALKTHROUGH_HREF}
            className="inline-flex items-center gap-1.5 self-start rounded text-[0.95rem] font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            Watch the 71-second walkthrough
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <a
            href="#top"
            className="inline-flex items-center gap-1.5 self-start rounded text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            Back to the sample
          </a>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t">
      <div className={cn(WRAP, "flex flex-col gap-6 py-10 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between")}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <LepaqLogo className="text-lg text-foreground" />
          <span>Every coffee chat, remembered.</span>
        </div>
        <p className="max-w-md text-xs leading-relaxed">
          {SAMPLE.person} and {SAMPLE.company} are a made-up sample. The demo on
          this page runs in your browser and saves nothing.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href={WALKTHROUGH_HREF} className="hover:text-foreground">Walkthrough</Link>
          <Link href="/login" className="hover:text-foreground">Sign in</Link>
          <a href={BENCHMARK_HREF} target="_blank" rel="noreferrer" className="hover:text-foreground">
            WhisperLah benchmark
          </a>
        </nav>
      </div>
    </footer>
  );
}
