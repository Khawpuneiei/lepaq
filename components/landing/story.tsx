"use client";

import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, Check, Quote } from "lucide-react";

import { cn } from "@/lib/utils";

import styles from "./landing.module.css";
import { fly, hasBox, lift, prefersReducedMotion, type Ghost } from "./motion";
import { SAMPLE } from "./sample";

/**
 * The landing page's story: one line from a coffee chat, followed through
 * Lepaq as the page scrolls.
 *
 * The stage stays on screen while the chapters scroll past it, and each
 * chapter moves the same sample one step on. The spoken line settles into
 * the transcript, its words lift out into a draft follow-up, you approve it,
 * and it files onto the page of the person who asked. Going back up plays
 * it in reverse.
 *
 * It is all local state driven by scroll position: nothing is recorded,
 * sent or saved. The stage is hidden from assistive tech, because every
 * chapter carries a text version of what the stage shows.
 */

type Pair = [from: string, to: string];
interface Plan {
  pairs: Pair[];
  stagger: number;
  duration: number;
  arc?: number;
}

/** Which words fly where between two neighbouring scenes. */
const PLANS: Record<string, Plan> = {
  // the spoken line settles into its place in the transcript
  "0>1": {
    pairs: [
      ["big-title", "key-title"],
      ["big-by", "key-by"],
      ["big-due", "key-due"],
      ["big-tail", "key-tail"],
    ],
    stagger: 60,
    duration: 980,
    arc: 28,
  },
  // the task, the date and the person lift out of the line into the draft
  "1>2": {
    pairs: [
      ["key-title", "card-title"],
      ["key-due", "card-due"],
      ["key-who", "card-who"],
    ],
    stagger: 150,
    duration: 860,
  },
  // the approved follow-up files onto the person's page
  "3>4": {
    pairs: [
      ["card-who", "person-name"],
      ["card-title", "person-title"],
      ["card-due", "person-due"],
    ],
    stagger: 110,
    duration: 840,
  },
};

/** Scrolling back plays these in reverse; un-drafting (2 → 1) is a plain fade. */
const REVERSIBLE = new Set(["1>0", "4>3"]);

function planFor(from: number, to: number): Plan | undefined {
  const forward = PLANS[`${from}>${to}`];
  if (forward) return forward;
  if (!REVERSIBLE.has(`${from}>${to}`)) return undefined;
  const back = PLANS[`${to}>${from}`];
  return back && { ...back, pairs: back.pairs.map(([a, b]) => [b, a] as Pair) };
}

interface Chapter {
  id: string;
  n: string;
  label: string;
  /** The meeting's real status in the app at this point. */
  state: string;
  title: string;
  body: React.ReactNode;
  note?: React.ReactNode;
  /** What the stage shows, for anyone who cannot see it. */
  stage: string;
}

const CHAPTERS: Chapter[] = [
  {
    id: "written",
    n: "01",
    label: "Written down",
    state: "transcribing → awaiting_speakers",
    title: "Written down the way it was said.",
    body: (
      <>
        After the chat, WhisperLah, our speech model trained on Singlish and
        code-switching, writes the transcript and tells the voices apart. You
        confirm who is who before anything is analysed.
      </>
    ),
    note: (
      <>
        Recorded with consent, in the browser or uploaded afterwards.{" "}
        <a href="#singlish">How accurate is it?</a>
      </>
    ),
    stage:
      "On screen: the sample transcript, with the line between the turns around it. Voice B is confirmed as Jamie Tan.",
  },
  {
    id: "drafted",
    n: "02",
    label: "Drafted",
    state: "analyzing → review",
    title: "The line becomes a draft follow-up.",
    body: (
      <>
        Lepaq drafts the report: a summary, decisions, follow-ups, a draft
        email and coaching notes. The task, the date and the person come from
        what was said, and each follow-up links back to its line.
      </>
    ),
    stage:
      "On screen: the draft report for Pilot discussion. Follow-up: Send the proposal, due Friday, with Jamie Tan of Harbour Studio. A second suggestion, Get sign-off from Jamie's boss, starts ticked too, as every draft item does.",
  },
  {
    id: "approved",
    n: "03",
    label: "Your call",
    state: "review → ready",
    title: "Nothing counts until you approve it.",
    body: (
      <>
        Every follow-up and every fact starts as a draft. Untick what is
        wrong, like a task that is really Jamie&apos;s, then approve the
        report. Only then does anything reach your list or a person&apos;s
        page.
      </>
    ),
    stage:
      "On screen: the second suggestion is unticked, and the report is approved, stamped Approved by you.",
  },
  {
    id: "remembered",
    n: "04",
    label: "Remembered",
    state: "ready",
    title: "Filed with the person who asked.",
    body: (
      <>
        Approved follow-ups land in one list, and on the person and company
        they belong to. Meet Jamie again and the open follow-up, the kopi
        order and every past chat are on one page.
      </>
    ),
    note: <>Meet someone twice and it is still one page.</>,
    stage:
      "On screen: Jamie Tan's page, with the open follow-up Send the proposal due Friday, two things to remember, and both meetings.",
  },
];

const LAST = CHAPTERS.length;

export function Story() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState(0);
  // the transcript's voices before and after you name them
  const [named, setNamed] = useState(false);
  // the stamp and the button press only play on the way down, not when scrolling back
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    const list = listRef.current;
    if (!wrap || !stage || !list) return;

    const items = Array.from(list.children) as HTMLElement[];
    const texts = items.map((li) => li.querySelector<HTMLElement>("[data-story-text]")!);
    const wide = window.matchMedia("(min-width: 1024px)");
    let shown = 0;
    let target = 0;
    let running = false;
    let instant = false;
    let live: Animation[] = [];
    let nameTimer = 0;
    let raf = 0;
    let alive = true;

    const q = (k: string) => stage.querySelector<HTMLElement>(`[data-k="${k}"]`);

    async function transition(from: number, to: number, animate: boolean) {
      window.clearTimeout(nameTimer);
      const plan = animate ? planFor(from, to) : undefined;
      // copies of the sources, taken before the stage changes under them
      const sources: (Ghost | null)[] = (plan?.pairs ?? []).map(([s]) => {
        const el = q(s);
        return hasBox(el) ? lift(el, stage!) : null;
      });
      const nameNow = to >= 2 || (to === 1 && (from >= 2 || !animate));

      flushSync(() => {
        setStep(to);
        setNamed(nameNow);
        setFresh(animate && from === 2 && to === 3);
      });

      if (plan) {
        const ghosts: HTMLElement[] = [];
        const held: HTMLElement[] = [];
        const anims: Animation[] = [];
        plan.pairs.forEach(([, d], i) => {
          const a = sources[i];
          if (!a) return;
          const el = q(d);
          if (!hasBox(el)) {
            a.node.remove();
            return;
          }
          const b = lift(el, stage!);
          // the real word stays invisible until its copy lands on it
          el.dataset.hold = "";
          held.push(el);
          ghosts.push(a.node, b.node);
          anims.push(...fly(a, b, { delay: i * plan.stagger, duration: plan.duration, arc: plan.arc }));
        });
        live = anims;
        await Promise.all(anims.map((x) => x.finished.catch(() => undefined)));
        live = [];
        ghosts.forEach((g) => g.remove());
        held.forEach((el) => delete el.dataset.hold);
      }

      // a beat after the line lands, the voices get their names
      if (to === 1 && !nameNow && alive) {
        nameTimer = window.setTimeout(() => setNamed(true), 120);
      }
    }

    async function run() {
      running = true;
      try {
        while (alive && shown !== target) {
          const from = shown;
          const to = target;
          const animate = !instant && Math.abs(to - from) === 1 && !prefersReducedMotion();
          instant = false;
          await transition(from, to, animate);
          shown = to;
        }
      } finally {
        running = false;
      }
    }

    function request(idx: number, jump = false) {
      if (idx === target) return;
      target = idx;
      if (jump) instant = true;
      if (running) {
        // the scene in flight is already out of date: land it now and move on
        live.forEach((a) => a.finish());
        return;
      }
      void run();
    }

    /** The chapter whose text has crossed the reading line. */
    function current() {
      const vh = window.innerHeight;
      let idx = 0;
      if (wide.matches) {
        // the opening's words sit over the stage, so chapter one starts as soon as
        // they begin to leave, before they can scroll across the line
        if (items[1].getBoundingClientRect().top < vh * 0.85) idx = 1;
        for (let i = 2; i < texts.length; i++) {
          if (texts[i].getBoundingClientRect().top < vh * 0.6) idx = i;
        }
        return idx;
      }
      const bottom = wrap!.getBoundingClientRect().bottom;
      const line = bottom + (vh - bottom) * 0.5;
      for (let i = 1; i < texts.length; i++) {
        if (texts[i].getBoundingClientRect().top < line) idx = i;
      }
      return idx;
    }

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        request(current());
      });
    };

    // the first reading may land mid-story (a reload, a #link): jump there without flights
    raf = requestAnimationFrame(() => {
      raf = 0;
      request(current(), true);
    });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(nameTimer);
      live.forEach((a) => a.finish());
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section id="story" aria-labelledby="page-title" className={styles.story}>
      <a
        href="#singlish"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-card"
      >
        Skip the story
      </a>

      <div ref={wrapRef} className={styles.stageWrap}>
        <div
          ref={stageRef}
          className={styles.stage}
          data-step={step}
          data-named={named ? "" : undefined}
          data-fresh={fresh ? "" : undefined}
          aria-hidden="true"
        >
          <div className={styles.stageInner}>
            <LineScene on={step === 0} />
            <WorkScene step={step} />
            <PersonScene on={step === LAST} />
          </div>
        </div>
        <Rail step={step} />
      </div>

      <ol ref={listRef} className={styles.steps}>
        <li id="chapter-start" className={cn(styles.step, styles.stepOpen)}>
          <div className={styles.stepCard} data-story-text data-active={step === 0 ? "" : undefined}>
            <Opening />
          </div>
        </li>
        {CHAPTERS.map((c, i) => (
          <li
            key={c.id}
            id={`chapter-${c.id}`}
            className={cn(styles.step, i === 0 && styles.stepFirst, i === LAST - 1 && styles.stepLast)}
          >
            <div className={styles.stepCard} data-story-text data-active={step === i + 1 ? "" : undefined}>
              <ChapterText c={c} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ─────────────────────────────── the chapters ─────────────────────────────── */

function Opening() {
  return (
    <div className={styles.opening}>
      <h1 id="page-title" className={cn(styles.display, styles.h1)}>
        Every coffee chat, remembered.
      </h1>
      <div className={styles.openingSide}>
        <p className={styles.lede}>
          Lepaq turns a conversation into a report you check, then keeps each
          follow-up with the person who asked for it. Built for Singlish and
          code-switching.
        </p>
        <a href="#chapter-written" className={cn(styles.mono, styles.cue)}>
          <ArrowDown className={styles.cueArrow} aria-hidden />
          Scroll to follow one line
        </a>
      </div>
      <p className="sr-only">
        Sample line from a coffee chat, said by {SAMPLE.person} of {SAMPLE.company} at {SAMPLE.at}: &ldquo;
        {SAMPLE.quote.title}
        {SAMPLE.quote.joiner}
        {SAMPLE.quote.due}
        {SAMPLE.quote.tail}&rdquo; The sample is made up.
      </p>
    </div>
  );
}

function ChapterText({ c }: { c: Chapter }) {
  return (
    <>
      <p className={cn(styles.mono, styles.chapterKicker)}>
        <span className={styles.kickerDot} aria-hidden />
        {c.n}
        <span className="sr-only"> of 0{LAST}</span>
        <span aria-hidden> / 0{LAST}</span> · {c.label}
      </p>
      <h2 className={cn(styles.display, styles.h2)}>{c.title}</h2>
      <p className={styles.body}>{c.body}</p>
      {c.note && <p className={styles.note}>{c.note}</p>}
      <p className={cn(styles.stateLine)}>
        <span className="sr-only">The meeting&apos;s status in the app: </span>
        {c.state}
      </p>
      <p className="sr-only">{c.stage}</p>
    </>
  );
}

function Rail({ step }: { step: number }) {
  const now = CHAPTERS[step - 1];
  return (
    <nav aria-label="Story chapters" className={styles.rail}>
      <div className={styles.railGrid}>
        <ol className={styles.railList}>
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <a
                href={`#chapter-${c.id}`}
                aria-current={step === i + 1 ? "step" : undefined}
                data-done={step > i + 1 ? "" : undefined}
                className={styles.railLink}
              >
                <span className={styles.railBar} aria-hidden />
                <span className={cn(styles.mono, styles.railText)}>
                  {c.n} {c.label}
                </span>
              </a>
            </li>
          ))}
        </ol>
        <p className={cn(styles.mono, styles.railNow)} aria-hidden>
          {now ? `${now.n} / 0${LAST} · ${now.label}` : `0${LAST} chapters · scroll`}
        </p>
      </div>
    </nav>
  );
}

/* ─────────────────────────────── the stage ─────────────────────────────── */

/** The recording strip: fixed heights so server and client render the same bars. */
const WAVE = [
  6, 10, 7, 14, 9, 5, 12, 18, 11, 7, 15, 9, 6, 13, 20, 12, 8, 5, 10, 16, 22, 17, 24, 19, 21, 14, 9, 6,
  11, 15, 8, 12, 18, 10, 6, 9, 14, 7, 5, 11, 16, 9, 13, 7, 10, 6,
];
const WAVE_ON = new Set([19, 20, 21, 22, 23, 24, 25]);

function on(flag: boolean) {
  return flag ? "" : undefined;
}

function LineScene({ on: visible }: { on: boolean }) {
  return (
    <div className={cn(styles.scene, styles.sceneLine)} data-on={on(visible)}>
      <figure className={styles.quoteBox}>
        <p className={cn(styles.mono, styles.kicker)}>
          <span className={styles.liveDot} />
          Sample · {SAMPLE.place}
          <span className="opacity-50">/</span>
          {SAMPLE.length}
        </p>
        <blockquote className={styles.quote}>
          <p>
            <span className={styles.line}>
              <span className={styles.hang}>&ldquo;</span>
              <span data-k="big-title" className={styles.phrase}>
                {SAMPLE.quote.title}
              </span>
            </span>
            <span className={styles.line}>
              <span data-k="big-by">{SAMPLE.quote.joiner.trim()}</span>{" "}
              <span data-k="big-due" className={styles.mark}>
                {SAMPLE.quote.due}
              </span>
              <span data-k="big-tail" className={styles.can}>
                {SAMPLE.quote.tail}
              </span>
              &rdquo;
            </span>
          </p>
        </blockquote>
        <figcaption className={styles.attrib}>
          <span>
            — <span className="font-medium">{SAMPLE.person}</span>
            <span className="text-muted-foreground">, {SAMPLE.company}</span>
          </span>
          <span className={styles.waveRow}>
            <span className={styles.wave}>
              {WAVE.map((h, i) => (
                <span
                  key={i}
                  style={{ height: h, "--i": i } as React.CSSProperties}
                  data-on={WAVE_ON.has(i) ? "" : undefined}
                />
              ))}
            </span>
            <span className={cn(styles.mono, "text-muted-foreground")}>{SAMPLE.at}</span>
          </span>
        </figcaption>
      </figure>
    </div>
  );
}

const BEFORE = [
  { t: "14:30", raw: "Voice A", name: "You", text: "So if the pilot goes ahead, we start in December?", extra: true },
  { t: "14:31", raw: "Voice B", name: SAMPLE.person, text: "Should be can. My boss wants to see it first.", extra: false },
];
const AFTER = { t: "14:31", raw: "Voice A", name: "You", text: "Can. I keep it to one page." };

function Who({ raw, name, k }: { raw: string; name: string; k?: string }) {
  return (
    <span className={styles.who}>
      <span className={styles.whoRaw}>{raw}</span>
      <span className={styles.whoName} data-k={k}>
        {name}
      </span>
    </span>
  );
}

function WorkScene({ step }: { step: number }) {
  const filled = step >= 2;
  const approved = step >= 3;
  return (
    <div className={cn(styles.scene, styles.sceneWork)} data-on={on(step >= 1 && step < LAST)}>
      <div className={styles.workCol}>
        {/* the transcript, with the line in its place */}
        <section className={cn(styles.transcript, approved && styles.transcriptDim)}>
          <header className={cn(styles.mono, styles.panelHead)}>
            <span>
              Transcript<span className={styles.wideOnly}> · {SAMPLE.meeting}</span>
            </span>
            <span className={styles.voices}>
              <span className={styles.voicesRaw}>2 voices · who is who?</span>
              <span className={styles.voicesNamed}>
                <Check className="size-3" aria-hidden /> Voices named
              </span>
            </span>
          </header>
          <ol className={styles.turns}>
            {BEFORE.map((l) => (
              <li key={l.text} className={cn(styles.turn, l.extra ? styles.turnFar : styles.turnNear)}>
                <span className={styles.turnMeta}>
                  <span className={styles.turnTime}>{l.t}</span>
                  <Who raw={l.raw} name={l.name} />
                </span>
                <span className={styles.turnText}>{l.text}</span>
              </li>
            ))}
            <li className={cn(styles.turn, styles.turnKey)}>
              <span className={styles.turnMeta}>
                <span className={styles.turnTime}>{SAMPLE.at}</span>
                <Who raw="Voice B" name={SAMPLE.person} k="key-who" />
              </span>
              <span className={styles.keyText}>
                <span data-k="key-title" className={cn(styles.phrase, filled && styles.phraseUsed)}>
                  {SAMPLE.quote.title}
                </span>{" "}
                <span data-k="key-by">{SAMPLE.quote.joiner.trim()}</span>{" "}
                <span data-k="key-due" className={styles.mark}>
                  {SAMPLE.quote.due}
                </span>
                <span data-k="key-tail" className={styles.can}>
                  {SAMPLE.quote.tail}
                </span>
              </span>
            </li>
            <li className={cn(styles.turn, styles.turnFar)}>
              <span className={styles.turnMeta}>
                <span className={styles.turnTime}>{AFTER.t}</span>
                <Who raw={AFTER.raw} name={AFTER.name} />
              </span>
              <span className={styles.turnText}>{AFTER.text}</span>
            </li>
          </ol>
        </section>

        {/* the report: empty slots until the voices are named, then the draft */}
        <section className={cn(styles.chit, styles.report, !filled && styles.reportWaiting)}>
          <div className={styles.reportBody}>
            <header className={styles.reportHead}>
              <div className="min-w-0">
                <p className={cn(styles.mono, styles.reportKicker)}>
                  <span>
                    <span className={styles.wideOnly}>Meeting </span>report
                  </span>
                  {!filled && <span className={styles.pillWait}>Waiting</span>}
                  {filled && !approved && <span className={styles.pillDraft}>Draft</span>}
                  {approved && <span className={styles.pillDone}>Approved</span>}
                </p>
                <p className={cn(styles.display, styles.reportTitle)}>{SAMPLE.meeting}</p>
              </div>
              <span className={cn(styles.mono, styles.sampleTag)}>Sample</span>
            </header>

            {/* one follow-up: on a wide stage three ruled rows, on a narrow one a title and its details */}
            <div className={styles.item}>
              <Field label="Follow-up" filled={filled} blank="w-full" className={styles.fTitle}>
                <TickBox checked />
                <span data-k="card-title" className={styles.itemTitle}>
                  {SAMPLE.followUp}
                </span>
              </Field>
              <div className={styles.fMeta}>
                <Field label="Due" filled={filled} blank="w-2/5">
                  <span data-k="card-due" className={styles.chip}>
                    {SAMPLE.due}
                  </span>
                </Field>
                <Field label="With" filled={filled} blank="w-3/5">
                  <span data-k="card-who" className="font-medium">
                    {SAMPLE.person}
                  </span>
                  <span className={cn(styles.wideOnly, "truncate text-muted-foreground")}>&nbsp;· {SAMPLE.company}</span>
                </Field>
              </div>
              <Stamp visible={approved} />
            </div>

            <div className={cn(styles.item2, approved && styles.item2Off)}>
              <span className={styles.slot}>
                <span className={cn(styles.blank, "w-3/5", filled && styles.away)} />
                <span className={cn(styles.value, !filled && styles.away)}>
                  <TickBox checked={!approved} />
                  <span className={styles.item2Text}>Get sign-off from Jamie&apos;s boss</span>
                </span>
              </span>
            </div>

            <p className={cn(styles.cite, !filled && styles.away)}>
              <Quote className="size-3.5 shrink-0" aria-hidden />
              From Jamie at {SAMPLE.at}: show the line this came from
            </p>
          </div>

          <footer className={styles.approveBar}>
            <span className={styles.count}>
              {filled ? (
                <>
                  {approved ? "1 follow-up" : "2 follow-ups"}
                  <span className={styles.wideOnly}> · 2 facts to save</span>
                </>
              ) : (
                "Drafted once you name the voices"
              )}
            </span>
            <span className={cn(styles.approveBtn, approved && styles.approveDone, !filled && styles.gone)}>
              {approved ? (
                <>
                  <Check className="size-4" aria-hidden /> Approved
                </>
              ) : (
                "Approve report"
              )}
            </span>
          </footer>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  filled,
  blank,
  className,
  children,
}: {
  label: string;
  filled: boolean;
  blank: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(styles.field, className)}>
      <span className={cn(styles.mono, styles.fieldLabel)}>{label}</span>
      <span className={styles.slot}>
        <span className={cn(styles.blank, blank, filled && styles.away)} />
        <span className={cn(styles.value, !filled && styles.away)}>{children}</span>
      </span>
    </div>
  );
}

function PersonScene({ on: visible }: { on: boolean }) {
  return (
    <div className={cn(styles.scene, styles.scenePerson)} data-on={on(visible)}>
      <section className={cn(styles.chit, styles.person)}>
        <header className={styles.personHead}>
          <span className={styles.avatar}>{SAMPLE.initials}</span>
          <div className="min-w-0 flex-1">
            <p className={cn(styles.mono, styles.personKicker, "text-muted-foreground")}>People</p>
            <p className={cn(styles.display, styles.personName)}>
              <span data-k="person-name">{SAMPLE.person}</span>
            </p>
            <p className={styles.personMeta}>
              {SAMPLE.company} · <span className="text-foreground">{SAMPLE.companyStatus}</span>
            </p>
          </div>
          <span className={cn(styles.mono, styles.sampleTag)}>Sample</span>
        </header>

        <div className={styles.personGrid}>
          <div className={styles.prep}>
            <p className={styles.panelLabel}>Prep for next meeting</p>
            <p className={styles.subLabel}>Open follow-ups</p>
            <div className={styles.openItem}>
              <span className={styles.openBox} />
              <span data-k="person-title" className={styles.openTitle}>
                {SAMPLE.followUp}
              </span>
              <span data-k="person-due" className={styles.chip}>
                {SAMPLE.due}
              </span>
            </div>
            <p className={styles.cite}>
              <Quote className="size-3.5 shrink-0" aria-hidden />
              From {SAMPLE.meeting}, {SAMPLE.at}
            </p>
          </div>

          <div className={styles.remember}>
            <p className={cn(styles.panelLabel, "text-on-butter")}>Remember this</p>
            <dl>
              {SAMPLE.facts.map((f) => (
                <div key={f.label} className={styles.fact}>
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className={styles.meetings}>
            <p className={styles.panelLabel}>Meetings</p>
            <ol>
              <li>
                <span className="font-medium">{SAMPLE.meeting}</span>
                <span className={styles.meetingDate}>{SAMPLE.date}</span>
              </li>
              <li>
                <span>{SAMPLE.earlier.meeting}</span>
                <span className={styles.meetingDate}>{SAMPLE.earlier.when}</span>
              </li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}

function TickBox({ checked }: { checked: boolean }) {
  return (
    <span className={cn(styles.tickBox, checked && styles.tickOn)} aria-hidden>
      <svg viewBox="0 0 16 16" className={styles.tick}>
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/** A cup ring pressed onto the slip: the rep's mark, not the AI's. */
function Stamp({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 120 120" className={cn(styles.stamp, visible && styles.stampOn)} aria-hidden>
      <defs>
        <path id="lepaq-stamp-ring" d="M60 60m-41 0a41 41 0 1 1 82 0a41 41 0 1 1-82 0" />
      </defs>
      <circle
        cx="60"
        cy="60"
        r="52"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeDasharray="160 4 60 3 90"
        opacity="0.9"
      />
      <circle cx="60" cy="60" r="31" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
      <text
        fontFamily="var(--font-geist-mono), monospace"
        fontSize="12.5"
        fontWeight="600"
        fill="currentColor"
      >
        <textPath href="#lepaq-stamp-ring" textLength="250" lengthAdjust="spacing">
          APPROVED BY YOU ·
        </textPath>
      </text>
      <path
        d="M47 61l9 9 17-20"
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
