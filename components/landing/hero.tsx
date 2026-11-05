"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { ArrowRight, Quote, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";

import styles from "./landing.module.css";
import { APP_HREF, SAMPLE } from "./sample";

/**
 * The landing page's opening: one line from a coffee chat, and the ruled
 * chit Lepaq writes it into.
 *
 * Heard → Review → Kept. Going forward, the words that matter lift out of
 * the spoken line and land in the slots of the draft follow-up, so the
 * viewer sees where the task, the date and the contact came from. Keeping
 * it files the follow-up onto the person. It is all local state: nothing is
 * recorded, sent or saved.
 */

type Step = "heard" | "review" | "kept";
type Part = "title" | "due" | "person";

const STEPS: { id: Step; label: string }[] = [
  { id: "heard", label: "Heard" },
  { id: "review", label: "Review" },
  { id: "kept", label: "Kept" },
];

const ANNOUNCE: Record<Step, string> = {
  heard: "Sample line from a coffee chat. Nothing has been drafted yet.",
  review:
    "Draft report. Suggested follow-up: send the proposal, due Friday, with Jamie Tan. Tick to keep it.",
  kept: "Kept. The follow-up is now on Jamie Tan's page, linked to the pilot discussion.",
};

/** The recording strip: fixed heights so server and client render the same bars. */
const WAVE = [
  6, 10, 7, 14, 9, 5, 12, 18, 11, 7, 15, 9, 6, 13, 20, 12, 8, 5, 10, 16, 22, 17, 24, 19, 21, 14,
  9, 6, 11, 15, 8, 12, 18, 10, 6, 9, 14, 7, 5, 11, 16, 9, 13, 7, 10, 6, 12, 8, 5, 9, 7, 11, 6, 8,
];
const WAVE_ON = new Set([19, 20, 21, 22, 23, 24, 25]);

const GHOST_PROPS = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "color",
  "background-color",
  "background-image",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-underline-offset",
];

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A free-floating copy of `el`, pinned to the document where `el` is now. */
function ghostOf(el: HTMLElement, r: DOMRect) {
  const g = el.cloneNode(true) as HTMLElement;
  const cs = getComputedStyle(el);
  g.removeAttribute("class");
  g.removeAttribute("data-src");
  g.removeAttribute("data-dst");
  g.setAttribute("aria-hidden", "true");
  for (const p of GHOST_PROPS) g.style.setProperty(p, cs.getPropertyValue(p));
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  Object.assign(g.style, {
    position: "absolute",
    left: `${r.left + window.scrollX}px`,
    top: `${r.top + window.scrollY}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    lineHeight: `${Math.max(r.height - padY, 1)}px`,
    margin: "0",
    display: "block",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    transformOrigin: "0 0",
    zIndex: "60",
  });
  document.body.appendChild(g);
  return g;
}

/**
 * Lift a copy of `src` along an arc into `dst`, cross-fading from the
 * source's type to the destination's on the way. `dst` stays where it is;
 * the caller keeps it invisible until this resolves.
 */
function fly(src: HTMLElement, dst: HTMLElement, delay: number): Promise<void> {
  const s = src.getBoundingClientRect();
  const d = dst.getBoundingClientRect();
  if (!s.width || !d.width || !s.height || !d.height) return Promise.resolve();

  const a = ghostOf(src, s);
  const b = ghostOf(dst, d);
  const dx = d.left - s.left;
  const dy = d.top - s.top;
  const k = d.height / s.height;
  const lift = Math.min(110, 30 + Math.hypot(dx, dy) * 0.14);
  const cx = dx / 2;
  const cy = dy / 2 - lift;

  const steps = 14;
  const fa: Keyframe[] = [];
  const fb: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = 2 * (1 - t) * t * cx + t * t * dx;
    const y = 2 * (1 - t) * t * cy + t * t * dy;
    const sa = 1 + (k - 1) * t;
    const fade = t < 0.3 ? 1 : t > 0.62 ? 0 : 1 - (t - 0.3) / 0.32;
    fa.push({ offset: t, transform: `translate(${x}px, ${y}px) scale(${sa})`, opacity: fade });
    fb.push({
      offset: t,
      transform: `translate(${x - dx}px, ${y - dy}px) scale(${sa / k})`,
      opacity: 1 - fade,
    });
  }

  const timing: KeyframeAnimationOptions = {
    duration: 860,
    delay,
    easing: "cubic-bezier(0.32, 0.72, 0.24, 1)",
    fill: "both",
  };
  const done = [a.animate(fa, timing).finished, b.animate(fb, timing).finished];
  return Promise.all(done)
    .catch(() => undefined)
    .then(() => {
      a.remove();
      b.remove();
    });
}

export function Hero() {
  const root = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const [step, setStep] = useState<Step>("heard");
  const [arriving, setArriving] = useState(false);
  const [lit, setLit] = useState<Part | "all" | null>(null);
  const [announce, setAnnounce] = useState("");
  // the stamp and the tick only animate when the viewer has just kept it
  const [justKept, setJustKept] = useState(false);

  const used = step !== "heard";

  useEffect(() => {
    if (lit !== "all") return;
    const t = window.setTimeout(() => setLit(null), 1600);
    return () => window.clearTimeout(t);
  }, [lit]);

  function q<T extends HTMLElement>(selector: string) {
    return root.current?.querySelector<T>(selector) ?? null;
  }

  function focusAction(name: string) {
    const el = q<HTMLElement>(`[data-action="${name}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  async function toReview() {
    const reduce = prefersReducedMotion();
    flushSync(() => {
      setStep("review");
      setArriving(!reduce);
      setJustKept(false);
    });
    if (!reduce) {
      const parts: Part[] = ["title", "due", "person"];
      await Promise.all(
        parts.map((part, i) => {
          const src = q<HTMLElement>(`[data-src="${part}"]`);
          const dst = q<HTMLElement>(`[data-dst="${part}"]`);
          return src && dst ? fly(src, dst, i * 150) : Promise.resolve();
        }),
      );
    }
    setArriving(false);
  }

  function toKept() {
    const reduce = prefersReducedMotion();
    const first = q<HTMLElement>('[data-flip="item"]')?.getBoundingClientRect();
    flushSync(() => {
      setStep("kept");
      setJustKept(!reduce);
    });
    const row = q<HTMLElement>('[data-flip="item"]');
    if (!reduce && first && row) {
      const last = row.getBoundingClientRect();
      row.animate(
        [
          { transform: `translate(${first.left - last.left}px, ${first.top - last.top}px)` },
          { transform: "none" },
        ],
        { duration: 640, easing: "cubic-bezier(0.32, 0.72, 0.24, 1)" },
      );
    }
  }

  async function go(target: Step) {
    if (busy.current || target === step) return;
    busy.current = true;
    try {
      const at = STEPS.findIndex((s) => s.id === step);
      const to = STEPS.findIndex((s) => s.id === target);
      if (to < at) {
        // going back is a reset, not a rewind
        flushSync(() => {
          setStep(target);
          setArriving(false);
          setJustKept(false);
        });
        if (target === "heard") {
          const quote = q<HTMLElement>("[data-quote]");
          quote?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
          setLit("all");
        }
      } else {
        if (at < 1) await toReview();
        if (to === 2) toKept();
      }
      setAnnounce(ANNOUNCE[target]);
      focusAction(target === "heard" ? "start" : target === "review" ? "keep" : "replay");
    } finally {
      busy.current = false;
    }
  }

  const litPart = (part: Part) => lit === part || lit === "all";
  const hover = (part: Part) => ({
    onMouseEnter: () => setLit(part),
    onMouseLeave: () => setLit(null),
    onFocus: () => setLit(part),
    onBlur: () => setLit(null),
  });

  return (
    <div ref={root} className="grid grid-cols-1 gap-x-12 gap-y-6 sm:gap-y-10 lg:grid-cols-12 lg:gap-y-12">
      {/* ── intro: what Lepaq is, before anything is clicked ───────────── */}
      <div className="lg:col-span-7 lg:col-start-1 lg:row-start-2 lg:pr-4">
        <h1 className={cn(styles.display, "text-[2.125rem] leading-[1.02] sm:text-5xl lg:text-[3.4rem]")}>
          Every coffee chat, remembered.
        </h1>
        <p className="mt-3 max-w-[34rem] text-[0.95rem] leading-relaxed text-muted-foreground sm:mt-4 sm:text-[1.05rem]">
          Lepaq turns a conversation into a report you check, then keeps each
          follow-up with the person who asked for it. Built for Singlish and
          code-switching.
        </p>
      </div>

      {/* ── the spoken line ──────────────────────────────────────────── */}
      <figure
        data-quote
        className={cn(
          styles.quoteBox,
          "lg:col-span-7 lg:col-start-1 lg:row-start-1 lg:pr-4",
        )}
      >
        <p className={cn(styles.mono, "mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground sm:mb-5")}>
          <span className="inline-flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            Sample · {SAMPLE.place}
          </span>
          <span aria-hidden>/</span>
          <span>{SAMPLE.length}</span>
        </p>

        <blockquote className={styles.quote}>
          <p>
            <span className={styles.line}>
              <span className={styles.hang} aria-hidden>
                &ldquo;
              </span>
              <span
                data-src="title"
                className={cn(
                  styles.phrase,
                  used && styles.phraseUsed,
                  litPart("title") && styles.phraseLit,
                )}
              >
                {SAMPLE.quote.title}
              </span>
            </span>
            <span className={styles.line}>
              {SAMPLE.quote.joiner.trim()}{" "}
              <span data-src="due" className={cn(styles.mark, litPart("due") && styles.markLit)}>
                {SAMPLE.quote.due}
              </span>
              <span className={styles.can}>{SAMPLE.quote.tail}</span>
              <span aria-hidden>&rdquo;</span>
            </span>
          </p>
        </blockquote>

        <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 sm:mt-6">
          <span className="text-[0.95rem]">
            <span aria-hidden>— </span>
            <span
              data-src="person"
              className={cn(
                styles.phrase,
                "font-medium",
                used && styles.phraseUsed,
                litPart("person") && styles.phraseLit,
              )}
            >
              {SAMPLE.person}
            </span>
            <span className="text-muted-foreground">, {SAMPLE.company}</span>
          </span>
          <span className="flex items-center gap-3" aria-hidden>
            <span className={styles.wave}>
              {WAVE.map((h, i) => (
                <span key={i} style={{ height: h }} data-on={WAVE_ON.has(i) ? "" : undefined} />
              ))}
            </span>
            <span className={cn(styles.mono, "text-muted-foreground")}>{SAMPLE.at}</span>
          </span>
        </figcaption>
      </figure>

      {/* ── the chit ─────────────────────────────────────────────────── */}
      <section
        aria-label="Sample: what Lepaq keeps from this line"
        className="lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:self-start"
      >
        {/* top-aligned beside the line, so growing between states never moves the words it lifts from */}
        <div className={cn(styles.chit, "flex flex-col overflow-hidden")}>
          <div className={cn(styles.chitBody, "flex flex-1 flex-col px-5 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-6")}>
            <header className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className={cn(styles.mono, "flex items-center gap-2 text-muted-foreground")}>
                  {step === "heard" && "From this line, Lepaq drafts"}
                  {step === "review" && (
                    <>
                      Meeting report
                      <span className="rounded bg-butter px-1.5 py-0.5 text-on-butter">Draft</span>
                    </>
                  )}
                  {step === "kept" && "People"}
                </p>
                <p key={step} className={cn(styles.display, styles.enter, "mt-1.5 truncate text-[1.75rem] leading-tight")}>
                  {step === "kept" ? SAMPLE.person : SAMPLE.meeting}
                </p>
              </div>
              <span className={cn(styles.mono, "mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-muted-foreground")}>
                Sample
              </span>
            </header>

            <div className="mt-3 sm:mt-4">
              {step === "heard" && <HeardFields />}
              {step === "review" && <ReviewFields arriving={arriving} hover={hover} onCite={() => setLit("all")} />}
              {step === "kept" && <KeptFields justKept={justKept} />}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-3 pt-4 sm:pt-5">
              {step === "heard" && (
                <button
                  type="button"
                  data-action="start"
                  onClick={() => go("review")}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-4 text-[0.95rem] font-semibold text-on-brand outline-none transition-colors hover:bg-brand-hover focus-visible:ring-3 focus-visible:ring-ring/60"
                >
                  See what Lepaq keeps
                  <ArrowRight className="size-4" aria-hidden />
                </button>
              )}
              {step === "review" && (
                <button
                  type="button"
                  data-action="keep"
                  onClick={() => go("kept")}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand px-4 text-[0.95rem] font-semibold text-on-brand outline-none transition-colors hover:bg-brand-hover focus-visible:ring-3 focus-visible:ring-ring/60"
                >
                  <TickBox checked={false} />
                  Tick to keep it
                </button>
              )}
              {step === "kept" && (
                <>
                  <button
                    type="button"
                    data-action="replay"
                    onClick={() => go("heard")}
                    className="inline-flex h-11 items-center gap-2 rounded-lg border bg-card px-4 text-[0.95rem] font-medium outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/60"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                    Replay
                  </button>
                  <Link
                    href={APP_HREF}
                    prefetch={false}
                    className="inline-flex h-11 items-center gap-1.5 rounded-lg px-1 text-[0.95rem] font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/60"
                  >
                    Open Lepaq <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </>
              )}
              <p className="text-xs leading-snug text-muted-foreground">
                {step === "heard" && "Illustrative. Nothing is recorded or saved here."}
                {step === "review" && "Only what you tick reaches your follow-ups."}
                {step === "kept" && "Filed under Jamie, with the line it came from."}
              </p>
            </div>
          </div>

          {/* progress, and a way to jump: real buttons, so it works from the keyboard */}
          <ol className="grid grid-cols-3 border-t bg-background/60" aria-label="Sample progress">
            {STEPS.map((s, i) => {
              const current = s.id === step;
              const done = STEPS.findIndex((x) => x.id === step) > i;
              return (
                <li key={s.id} className={cn(i > 0 && "border-l")}>
                  <button
                    type="button"
                    onClick={() => go(s.id)}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      styles.mono,
                      "flex h-11 w-full items-center justify-center gap-2 outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
                      current ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        current ? "bg-brand" : done ? "bg-foreground/60" : "bg-border",
                      )}
                      aria-hidden
                    />
                    0{i + 1} {s.label}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
      </section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className={cn(styles.mono, "text-muted-foreground")}>{children}</span>;
}

const REPORT_PARTS = ["Summary", "Decisions", "Risks", "Draft email", "Coaching notes"];

function HeardFields() {
  return (
    <div className={cn(styles.enter)}>
      <div className={styles.field}>
        <Label>Follow-up</Label>
        <span className={styles.blank} />
      </div>
      <div className={styles.field}>
        <Label>Due</Label>
        <span className={cn(styles.blank, "w-2/5")} />
      </div>
      <div className={styles.field}>
        <Label>With</Label>
        <span className={cn(styles.blank, "w-3/5")} />
      </div>
      {/* desktop has the room: the rest of what a real report holds */}
      <div className="mt-6 hidden lg:block">
        <Label>The full report also has</Label>
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {REPORT_PARTS.map((p) => (
            <li key={p} className="rounded-full border px-2.5 py-0.5 text-[0.8rem] text-muted-foreground">
              {p}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ReviewFields({
  arriving,
  hover,
  onCite,
}: {
  arriving: boolean;
  hover: (part: Part) => Record<string, () => void>;
  onCite: () => void;
}) {
  return (
    <div>
      <p className={cn(styles.enter, "mb-3 text-[0.95rem] leading-relaxed [--base:520ms]")}>
        {SAMPLE.summary}
      </p>
      <div data-flip="item" className="rounded-lg border bg-card px-3.5 py-1">
        <div className={styles.field} {...hover("title")}>
          <Label>Follow-up</Label>
          <span>
            <span data-dst="title" className={cn("whitespace-nowrap text-[1.05rem] font-semibold", arriving && styles.arriving)}>
              {SAMPLE.followUp}
            </span>
          </span>
        </div>
        <div className={styles.field} {...hover("due")}>
          <Label>Due</Label>
          <span>
            <span data-dst="due" className={cn(styles.chip, "text-[0.95rem]", arriving && styles.arriving)}>
              {SAMPLE.due}
            </span>
          </span>
        </div>
        <div className={styles.field} {...hover("person")}>
          <Label>With</Label>
          <span>
            <span data-dst="person" className={cn("whitespace-nowrap text-[1rem] font-medium", arriving && styles.arriving)}>
              {SAMPLE.person}
            </span>
            <span className="text-muted-foreground"> · {SAMPLE.company}</span>
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onCite}
        className={cn(
          styles.enter,
          "mt-3 inline-flex items-start gap-1.5 rounded text-left text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 [--base:700ms]",
        )}
      >
        <Quote className="mt-px size-3.5 shrink-0" aria-hidden />
        From {SAMPLE.person.split(" ")[0]} at {SAMPLE.at}: show the line this came from
      </button>
    </div>
  );
}

function KeptFields({ justKept }: { justKept: boolean }) {
  return (
    <div className="relative">
      <div className={cn(styles.enter, "mb-3 flex items-center gap-3")}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sidebar text-sm font-semibold text-white">
          {SAMPLE.initials}
        </span>
        <p className="text-[0.95rem] leading-snug">
          {SAMPLE.company}
          <span className="text-muted-foreground"> · status </span>
          <span className="font-medium">{SAMPLE.companyStatus}</span>
        </p>
      </div>
      <div data-flip="item" className="rounded-lg border bg-card px-3.5 py-1">
        <div className={styles.field}>
          <Label>Follow-up</Label>
          <span className="flex min-w-0 items-center gap-2.5">
            <TickBox checked animate={justKept} />
            <span className="text-[1.05rem] font-semibold">{SAMPLE.followUp}</span>
          </span>
        </div>
        <div className={styles.field}>
          <Label>Due</Label>
          <span className="relative">
            <span className={cn(styles.chip, "text-[0.95rem]")}>{SAMPLE.due}</span>
            <Stamp animate={justKept} />
          </span>
        </div>
        <div className={styles.field}>
          <Label>From</Label>
          <span className="text-[0.95rem]">
            {SAMPLE.meeting} <span className="text-muted-foreground">· {SAMPLE.at}</span>
          </span>
        </div>
      </div>
      <p className={cn(styles.enter, "mt-3 text-[0.95rem] [--base:300ms]")}>
        <span className="text-muted-foreground">Met before: </span>
        {SAMPLE.earlier.meeting}, {SAMPLE.earlier.when}
      </p>
    </div>
  );
}

function TickBox({ checked, animate = false }: { checked: boolean; animate?: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-[5px] border-[1.5px]",
        checked ? "border-success-solid bg-success-solid text-white" : "border-current bg-transparent",
      )}
      aria-hidden
    >
      {checked && (
        <svg viewBox="0 0 16 16" className={cn("size-3.5", styles.tick, animate && styles.tickDraw)}>
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/** A cup ring pressed onto the slip: the rep's mark, not the AI's. */
function Stamp({ animate }: { animate: boolean }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={cn(styles.stamp, animate && styles.stampIn, "-right-1 top-1/2 size-[68px] -translate-y-1/2 sm:right-2 sm:size-[92px]")}
      aria-hidden
    >
      <defs>
        <path id="lepaq-stamp-ring" d="M60 60m-41 0a41 41 0 1 1 82 0a41 41 0 1 1-82 0" />
      </defs>
      <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="3.2" strokeDasharray="160 4 60 3 90" opacity="0.9" />
      <circle cx="60" cy="60" r="31" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
      <text fontFamily="var(--font-geist-mono), monospace" fontSize="12.5" fontWeight="600" letterSpacing="2.6" fill="currentColor">
        <textPath href="#lepaq-stamp-ring">KEPT BY YOU · KEPT BY YOU ·</textPath>
      </text>
      <path d="M47 61l9 9 17-20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
