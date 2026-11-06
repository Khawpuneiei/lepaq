import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleCheckBig,
  LayoutDashboard,
  Mic,
  Settings,
  Users,
} from "lucide-react";

import { LepaqLogo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";

import styles from "./landing.module.css";
import { Reveal } from "./reveal";
import { APP_HREF, BENCHMARK_HREF, SAMPLE, WALKTHROUGH_HREF } from "./sample";

/**
 * Everything around the story: the nav, the proof, the promises, and the
 * door into the app. Server components; the only client pieces are the story
 * itself and the small Reveal wrapper that plays entrances on scroll.
 *
 * Every product claim here is something the app does today (see the README
 * and lib/), and every model number is copied from the public WhisperLah
 * results table. Change a number only when that table changes, and check any
 * new claim against pitch-deck/overclaim-review.md first.
 */

const WRAP = "mx-auto w-full max-w-[82.5rem] px-5 sm:px-8 lg:px-12";

/**
 * A real outline, not a box-shadow ring: --ring clears 3:1 on the page, on
 * white and on the ink band, and outlines survive Windows high contrast. No
 * `outline-none` with it: in Tailwind 4 that would cancel the outline style.
 */
const FOCUS = "rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** For links that open GitHub in a new tab. */
function NewTab() {
  return <span className="sr-only"> (opens in a new tab)</span>;
}

const NAV = [
  { href: "#chapter-written", label: "How it works" },
  { href: "#singlish", label: "Singlish" },
  { href: "#privacy", label: "Privacy" },
];

export function LandingNav() {
  return (
    // 95% opaque even where blur works: the dark band scrolling under it would
    // otherwise drag the links below 4.5:1
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur-md">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-card"
      >
        Skip to content
      </a>
      {/* one row at any text size (--nav-h assumes 4rem): on a narrow screen,
          or with large text, the gaps close, the arrow goes first, then the
          wordmark (the link's name stays "Lepaq, home") */}
      <div className={cn(WRAP, styles.navRow, "flex h-16 items-center justify-between gap-3 sm:gap-6")}>
        {/* this page is home, so the logo goes to its top, as "Read the story
            again" does: a Link to "/" only took the # off the address and
            left a reader far down the page where they were [REV-29] */}
        <a href="#top" aria-label="Lepaq, home" className={cn(FOCUS, "min-w-0")}>
          <LepaqLogo className="text-[1.4rem]" wordmarkClassName="max-[15.5rem]:hidden" />
        </a>
        <nav aria-label="Page sections" className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className={cn(FOCUS, "transition-colors hover:text-foreground")}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-4">
          {/* no prefetch: /demo renders per request, and most visitors never open it */}
          <Link
            href={WALKTHROUGH_HREF}
            prefetch={false}
            className={cn(FOCUS, "hidden text-sm text-muted-foreground transition-colors hover:text-foreground lg:inline")}
          >
            Walkthrough
          </Link>
          <Link
            href={APP_HREF}
            prefetch={false}
            className={cn(
              FOCUS,
              "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover max-[25rem]:px-3",
            )}
          >
            Open Lepaq
            <ArrowRight className="size-3.5 max-[25rem]:hidden" aria-hidden />
          </Link>
        </div>
      </div>
      {/* how far down the story you are; drawn by the scroll itself where the browser can */}
      <span className={styles.progress} aria-hidden />
    </header>
  );
}

function SectionHead({
  label,
  title,
  children,
  invert = false,
  id,
}: {
  label: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  invert?: boolean;
  id: string;
}) {
  return (
    <div className={cn("grid grid-cols-1 gap-x-12 gap-y-5 border-t pt-6 lg:grid-cols-12", invert && "border-white/15")}>
      <p className={cn(styles.mono, "lg:col-span-5", invert ? "text-white/60" : "text-muted-foreground")}>{label}</p>
      <div className="lg:col-span-7">
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

/* ─────────────────────────────── The proof ─────────────────────────────── */

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
    <section aria-labelledby="singlish-title" id="singlish" className={cn(styles.inkBand, styles.anchor)}>
      <div className={cn(WRAP, "py-20 lg:py-28")}>
        <SectionHead label="How Lepaq hears Singlish · WhisperLah" title="Trained for the way Singapore talks." id="singlish-title" invert>
          <p>
            Off-the-shelf speech models drop Singlish: OpenAI&apos;s Whisper,
            our starting point, writes down only 10% of the lah, leh and lor
            in two-person conversation. Lepaq transcribes with WhisperLah, our
            own model: we taught OpenAI&apos;s open Whisper model Singlish and
            code-switching. On two-person Singlish conversation it now makes
            fewer errors than every other model we tested, OpenAI&apos;s paid
            API included.
          </p>
        </SectionHead>

        <div className="mt-12 grid grid-cols-1 gap-10 lg:mt-16 lg:grid-cols-12 lg:gap-12">
          <Reveal as="figure" className={cn(styles.reveal, "lg:col-span-7")}>
            <figcaption>
              <p className="font-medium text-white">Word error rate on two-person Singlish conversation</p>
              <p className="mt-1 text-sm text-white/60">
                NSC (IMDA&apos;s National Speech Corpus) Part 3, 997 clips, same
                clips and text normaliser for every model. Lower is better.
                Selected models; all 18 are in the full table on GitHub.
              </p>
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
                  {CONVERSATION_WER.map((row, i) => (
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
                              className={cn(styles.bar, row.lead && styles.barLead, "block")}
                              style={{ width: `${(row.wer / AXIS_MAX) * 100}%`, "--i": i } as React.CSSProperties}
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
              A*STAR&apos;s larger MERaLiON-2-10B-ASR, run in 4-bit on a
              299-clip sample of this set, scored 22.4%, against 18.8% for
              WhisperLah on the same clips.
            </p>
          </Reveal>

          <Reveal className={cn(styles.reveal, "grid content-start gap-0 lg:col-span-5")}>
            {/* Lepaq sends every meeting in room mode (lib/asr/jobs.ts), so the
                first two are room mode, and the near-mic score says what room
                mode scores on the same test */}
            {[
              {
                figure: "4 of 4",
                body: "NSC conversation test sets (Parts 3 to 6) where WhisperLah has the lowest error of every model we ran on them, in room mode, the one Lepaq records meetings with.",
              },
              {
                figure: "76%",
                body: "of discourse particles (lah, leh, lor …) written down in two-person conversation, in room mode. Next best: 50%, OpenAI's GPT Transcribe.",
              },
              {
                figure: "14.8%",
                body: "word error rate on SASRBench-v1, a public close-talk benchmark that scores only the person wearing the mic, in near-mic mode. Next best: 15.8%, OpenAI's GPT Transcribe. Room mode, which writes down everyone, scores 17.1% there.",
              },
            ].map((s, i) => (
              <div
                key={s.figure}
                className={cn(styles.rise, "border-t border-white/15 py-5 first:border-t-0 first:pt-0 lg:first:border-t lg:first:pt-5")}
                style={{ "--i": i + 1 } as React.CSSProperties}
              >
                <p className={cn(styles.display, "text-[3rem] leading-none text-white")}>{s.figure}</p>
                <p className="mt-2 text-[0.95rem] leading-relaxed text-white/70">{s.body}</p>
              </div>
            ))}
            <p className="border-t border-white/15 pt-5 text-xs leading-relaxed text-white/60">
              Behind on read speech (NSC Parts 1 and 2): A*STAR&apos;s
              MERaLiON-2-3B leads both, four other models, OpenAI&apos;s GPT
              Transcribe among them, also beat it on Part 1, and Alibaba&apos;s
              SenseVoice Small on Part 2. All seven test sets are quiet,
              close-mic recordings: café noise is not benchmarked yet, and
              neither is how well the voices are told apart. Not every vendor
              has been tested yet. The evaluation harness and per-clip results
              are public; the model weights are not.
            </p>
            <a
              href={BENCHMARK_HREF}
              target="_blank"
              rel="noreferrer"
              className={cn(FOCUS, "mt-4 inline-flex items-center gap-1.5 self-start text-sm font-medium text-white underline-offset-4 hover:underline")}
            >
              See the benchmark on GitHub
              <ArrowUpRight className="size-4" aria-hidden />
              <NewTab />
            </a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── The promises ─────────────────────────────── */

/**
 * Each line is checked against the app: the approve route, the new-meeting
 * wizard, the fact-category guard (lib/constants.ts) and the share page.
 * Where the audio goes is from the owner's 28 Oct claim review; confirm the
 * region before changing it.
 */
const PRIVACY = [
  [
    "Drafts until you approve",
    "Follow-ups and facts the AI drafts wait for your approval before they reach your list or a person’s page.",
  ],
  ["No manager view", "Lepaq is built for the person in the meeting, not for oversight of them."],
  [
    "Consent, every time",
    "Lepaq won’t upload or transcribe a recording until you confirm everyone in it knew they were being recorded. The recorder reminds you to ask first.",
  ],
  [
    "Where the audio goes",
    "Recordings are transcribed on our own GPU service, run on Modal in US East, and deleted after transcription by default. Anthropic’s Claude writes the report from the transcript.",
  ],
  [
    "Sensitive facts stay off profiles",
    "Lepaq’s AI is told never to file health, religion, politics, ethnicity, sexuality, finances or family problems as a fact about someone, and the code and the database refuse those categories. No fact reaches a profile until you tick it, and a line you strike from the transcript is left out when the report is regenerated.",
  ],
  [
    "Yours alone",
    "Row-level security on every table. A share link shows only what you approved: the summary, key takeaways, decisions and ticked follow-ups with names and dates. Never the transcript, the recording, emotion reads, personal facts or coaching.",
  ],
];

export function PrivacySection() {
  return (
    <section aria-labelledby="privacy-title" id="privacy" className={cn(WRAP, styles.anchor, "py-20 lg:py-28")}>
      <SectionHead label="Why you can bring it to coffee · Private by default" title="Your notes. Not your manager's." id="privacy-title">
        <p>
          Where business runs on trust, you only record a client if the notes
          are clearly yours. In Lepaq, they are.
        </p>
      </SectionHead>
      <Reveal as="dl" className={cn(styles.reveal, "mt-12 grid border-t sm:grid-cols-2 lg:mt-16 lg:grid-cols-3")}>
        {PRIVACY.map(([name, body], i) => (
          <div
            key={name}
            style={{ "--i": i } as React.CSSProperties}
            className={cn(
              styles.rise,
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
      </Reveal>
    </section>
  );
}

/* ─────────────────────────────── The door ─────────────────────────────── */

const APP_NAV = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Meetings", icon: Mic },
  { label: "People", icon: Users },
  { label: "Companies", icon: Building2 },
  { label: "Follow-ups", icon: CircleCheckBig },
  { label: "Settings", icon: Settings },
];

/** The story ends where the product starts: the follow-up, on the app's own list. */
export function Finale() {
  return (
    <section aria-labelledby="close-title" id="start" className={cn(styles.anchor, "border-t bg-card")}>
      <div className={cn(WRAP, "grid grid-cols-1 gap-x-12 gap-y-12 py-20 lg:grid-cols-12 lg:items-center lg:py-28")}>
        <div className="lg:col-span-5">
          <p className={cn(styles.mono, "text-muted-foreground")}>Your turn</p>
          <h2 id="close-title" className={cn(styles.display, "mt-4 text-[2.75rem] leading-[1] sm:text-[4rem] lg:text-[4.5rem]")}>
            {/* "follow-up." moves to the next line whole, and breaks at its
                hyphen only where it cannot fit on a line of its own (200% text
                on a small phone). Not U+2011: the display face has no glyph for it */}
            Bring Lepaq. Leave with the <span className="inline-block">follow-up.</span>
          </h2>
          <p className="mt-5 max-w-[30rem] text-[1.02rem] leading-relaxed text-muted-foreground">
            Start a meeting and the next line worth keeping lands where
            Jamie&apos;s did: on your list, and on the page of the person who
            said it.
          </p>
          <div className="mt-8 flex flex-col items-start gap-4">
            <Link
              href={APP_HREF}
              prefetch={false}
              className={cn(
                FOCUS,
                "inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-on-brand transition-colors hover:bg-brand-hover",
              )}
            >
              Open Lepaq
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href={WALKTHROUGH_HREF}
              prefetch={false}
              className={cn(FOCUS, "inline-flex items-center gap-1.5 text-[0.95rem] font-medium underline-offset-4 hover:underline")}
            >
              Watch the 71-second walkthrough
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a
              href="#top"
              className={cn(FOCUS, "inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline")}
            >
              Read the story again
            </a>
          </div>
        </div>

        <figure className="lg:col-span-7">
          <Reveal className={cn(styles.reveal, styles.appWindow)} aria-hidden="true">
            <div className={styles.appBar}>
              <span />
              <span />
              <span />
              <span className={cn(styles.mono, "ml-auto text-muted-foreground")}>Sample</span>
            </div>
            <div className={styles.appBody}>
              <div className={styles.appSide}>
                <LepaqLogo className="text-[1.2rem] text-white" />
                <p className="mt-2 text-[0.7rem] text-sidebar-foreground/70">Every coffee chat, remembered.</p>
                <ul className="mt-5 space-y-0.5">
                  {APP_NAV.map(({ label, icon: Icon }) => (
                    <li
                      key={label}
                      className={cn(
                        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.8rem] text-sidebar-foreground",
                        label === "Follow-ups" && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className={cn("size-3.5 shrink-0", label === "Follow-ups" && "text-sidebar-primary")} />
                      {label}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={styles.appMain}>
                <p className="font-display text-[1.75rem] leading-tight">Follow-ups</p>
                <p className="mt-1 text-[0.8rem] text-muted-foreground">
                  Everything you agreed to, from every meeting you have approved.
                </p>
                <p className="mt-6 font-display text-[1.25rem]">
                  This week <span className="ml-1 font-sans text-xs text-muted-foreground">1</span>
                </p>
                <div className={cn(styles.appRow, styles.rise)} style={{ "--i": 3 } as React.CSSProperties}>
                  <span className={styles.openBox} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.85rem] font-medium">{SAMPLE.followUp}</p>
                    {/* the real list: owner · company · meeting */}
                    <p className="mt-1 text-[0.75rem] text-muted-foreground">
                      You · {SAMPLE.company} · {SAMPLE.meeting}
                    </p>
                  </div>
                  <span className={cn(styles.appDue, "shrink-0 text-[0.75rem] text-on-butter")}>Due in 2 days</span>
                </div>
              </div>
            </div>
          </Reveal>
          <figcaption className="mt-3 text-xs text-muted-foreground">
            Illustrative: the app&apos;s Follow-ups page, holding the sample&apos;s follow-up.
          </figcaption>
        </figure>
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
          {SAMPLE.person} and {SAMPLE.company} are a made-up sample. The story on
          this page runs in your browser and saves nothing.
        </p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href={WALKTHROUGH_HREF} prefetch={false} className={cn(FOCUS, "hover:text-foreground")}>
            Walkthrough
          </Link>
          <Link href="/login" className={cn(FOCUS, "hover:text-foreground")}>
            Sign in
          </Link>
          <a href={BENCHMARK_HREF} target="_blank" rel="noreferrer" className={cn(FOCUS, "hover:text-foreground")}>
            WhisperLah benchmark
            <NewTab />
          </a>
        </nav>
      </div>
    </footer>
  );
}
