"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell } from "@/components/layout/app-shell";
import { MeetingDetail } from "@/components/meeting/meeting-detail";
import {
  NewMeetingWizard,
  ProcessingScreen,
} from "@/components/meeting/new-meeting-wizard";
import { ShareDialog } from "@/components/meeting/share-dialog";
import { SpeakerReview } from "@/components/meeting/speaker-review";
import { PeopleView } from "@/components/people/people-view";
import { PageHeader } from "@/components/shared/page-header";
import {
  ACTION_ITEMS,
  COLUMNS,
  COLUMNS_WITH_TRAVEL,
  COMPANY,
  DEMO_ME,
  DEMO_OWNER,
  FACTS,
  PARTICIPANTS,
  PEOPLE,
  PICKED_FILE,
  READS,
  REPORT,
  SEGMENTS,
  SPEAKER_PARTICIPANTS,
  SPEAKER_ROWS,
  meeting,
} from "@/components/demo/fixtures";

/**
 * The app half of the /demo walkthrough.
 *
 * This page runs inside an iframe on /demo and renders the real screens —
 * the same components a signed-in user gets — fed with the fixtures above.
 * It owns no timing. The director on /demo decides what is on screen at
 * each moment and calls window.__frame; this page just shows that state.
 *
 * Running in its own document is what lets the real dialogs, toasts and
 * sticky footers behave exactly as they do in the app: their portals and
 * fixed positioning resolve against this iframe's viewport, which is then
 * scaled and panned as one picture by the director's camera.
 */

export type MeetingTab = "report" | "follow-ups" | "people" | "coach" | "transcript";

export type FrameState =
  | { view: "upload"; picked: boolean }
  | { view: "processing"; step: "upload" | "transcribe" | "speakers" }
  | { view: "speakers"; chosen: boolean }
  | {
      view: "meeting";
      tab: MeetingTab;
      approved: boolean;
      /** How many of Priya's facts have been ticked on the People tab. */
      ticked?: number;
      /** Transcript line to mark as the evidence target. */
      evidence?: number;
      share?: boolean;
    }
  | { view: "people"; travel: boolean };

export interface FrameToast {
  title: string;
  description?: string;
}

export interface FrameApi {
  /** Show this state. Resolves once React has committed it and painted. */
  apply(input: {
    state: FrameState;
    toast: FrameToast | null;
    /** Seconds since the film started; drives paused CSS animations in capture. */
    clock: number;
  }): Promise<void>;
  setScroll(y: number): void;
  scrollY(): number;
  /** Viewport rect of the element a query names, or null if it is not on screen. */
  rect(query: string): { x: number; y: number; width: number; height: number } | null;
}

declare global {
  interface Window {
    __frame?: FrameApi;
  }
}

const APP_URL = "https://lepaq.app";

const NAV_FOR: Record<FrameState["view"], string> = {
  upload: "/meetings",
  processing: "/meetings",
  speakers: "/meetings",
  meeting: "/meetings",
  people: "/people",
};

/**
 * `text=Decisions` matches an element whose own text is exactly that,
 * `label=Approve report` matches aria-label, `row=Priya Raman` the table row
 * containing that text, anything else is a CSS selector. Real components
 * carry no demo-only hooks, so the director finds things the way a person
 * would: by what they say.
 */
function find(query: string): Element | null {
  const [kind, ...rest] = query.split("=");
  const value = rest.join("=");

  if (kind === "label") {
    return (
      [...document.querySelectorAll("[aria-label]")].find(
        (el) => el.getAttribute("aria-label") === value,
      ) ?? null
    );
  }

  if (kind === "text" || kind === "row") {
    const candidates = [...document.querySelectorAll("body *")].filter(
      (el) =>
        el.children.length === 0 || [...el.childNodes].some((n) => n.nodeType === 3),
    );
    const hit =
      candidates.find((el) => el.textContent?.trim() === value) ??
      candidates.find((el) => el.textContent?.trim().startsWith(value)) ??
      null;
    return kind === "row" ? (hit?.closest("tr") ?? null) : hit;
  }

  return document.querySelector(query);
}

function Screen({ state }: { state: FrameState }) {
  switch (state.view) {
    case "upload":
      return (
        <NewMeetingWizard
          key={state.picked ? "picked" : "empty"}
          companies={[]}
          people={[]}
          myName={DEMO_ME.name}
          initialPicked={state.picked ? PICKED_FILE : null}
        />
      );

    case "processing":
      return (
        <ProcessingScreen
          status={state.step === "transcribe" ? "transcribing" : state.step === "speakers" ? "awaiting_speakers" : "uploaded"}
          uploading={state.step === "upload"}
          progressNote={null}
          error={null}
          chunks={{ done: 0, total: 1 }}
          meetingId={null}
        />
      );

    case "speakers":
      return (
        <SpeakerReview
          key={state.chosen ? "chosen" : "open"}
          meetingId="demo-meeting"
          rows={SPEAKER_ROWS}
          participants={SPEAKER_PARTICIPANTS}
          chunked={false}
          initialAssignments={state.chosen ? { B: "p-priya" } : undefined}
        />
      );

    case "meeting": {
      const approved = state.approved;
      return (
        <>
          <MeetingDetail
            key={`${state.tab}-${approved}-${state.ticked ?? 0}`}
            meeting={meeting(approved ? "ready" : "review")}
            report={approved ? { ...REPORT, approved_at: "2026-10-15T10:02:00.000Z" } : REPORT}
            participants={PARTICIPANTS}
            actionItems={ACTION_ITEMS.map((a) => ({ ...a, approved }))}
            facts={FACTS.map((f, i) => ({ ...f, approved: approved || i < (state.ticked ?? 0) }))}
            reads={READS}
            segments={SEGMENTS}
            company={COMPANY}
            appUrl={APP_URL}
            initialTab={state.tab}
          />
          {state.share && (
            <ShareDialog
              open
              onOpenChange={() => {}}
              meetingId="demo-meeting"
              token={null}
              onTokenChange={() => {}}
              appUrl={APP_URL}
              approved={approved}
            />
          )}
        </>
      );
    }

    case "people":
      return (
        <div className="mx-auto max-w-5xl">
          <PageHeader
            title="People"
            description="One row per person. Meet someone again and it updates their row rather than adding another."
          />
          <PeopleView
            key={state.travel ? "travel" : "default"}
            people={PEOPLE}
            columns={state.travel ? COLUMNS_WITH_TRAVEL : COLUMNS}
            ownerId={DEMO_OWNER}
            initialView="table"
          />
        </div>
      );
  }
}

export function DemoFrame({ capture }: { capture: boolean }) {
  const [state, setState] = useState<FrameState>({ view: "upload", picked: false });
  const waiting = useRef<(() => void)[]>([]);
  const shownToast = useRef<string>("");

  useLayoutEffect(() => {
    const hash =
      state.view === "meeting" && state.tab === "transcript" && state.evidence != null
        ? `#segment-${state.evidence}`
        : "";
    // A real hash change, so the transcript's own :target highlight fires.
    // The jump it causes is overwritten by the director's next setScroll.
    // replace(), not an assignment: this page runs in /demo's iframe, and each
    // assignment would add an entry to the tab's history, so Back stayed on
    // the walkthrough twice for every pass through the evidence scene.
    if (window.location.hash !== hash) window.location.replace(hash || "#");

    // Resolve apply() only after the new state has been committed and
    // painted, so a screenshot taken straight after never catches the
    // previous screen.
    const done = waiting.current.splice(0);
    if (done.length === 0) return;
    requestAnimationFrame(() => requestAnimationFrame(() => done.forEach((d) => d())));
  });

  useEffect(() => {
    window.__frame = {
      apply({ state: next, toast: nextToast, clock }) {
        document.documentElement.style.setProperty("--demo-clock", `${-clock}s`);

        const toastKey = nextToast ? JSON.stringify(nextToast) : "";
        if (toastKey !== shownToast.current) {
          shownToast.current = toastKey;
          toast.dismiss();
          if (nextToast) {
            toast.success(nextToast.title, {
              id: "demo",
              description: nextToast.description,
              // the director removes it; a timer would run on wall-clock time
              duration: Infinity,
            });
          }
        }

        return new Promise<void>((resolve) => {
          setState((prev) => {
            if (JSON.stringify(prev) === JSON.stringify(next)) {
              requestAnimationFrame(() => resolve());
              return prev;
            }
            waiting.current.push(resolve);
            return next;
          });
        });
      },
      setScroll(y) {
        window.scrollTo({ top: y, behavior: "instant" });
      },
      scrollY() {
        return window.scrollY;
      },
      rect(query) {
        const el = find(query);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null;
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
    };
    return () => {
      delete window.__frame;
    };
  }, []);

  return (
    <>
      <style>{`
        html { scrollbar-width: none; }
        html::-webkit-scrollbar { display: none; }
        body { pointer-events: none; }
        ${
          capture
            ? `*, *::before, *::after {
                 transition-duration: 0s !important;
                 transition-delay: 0s !important;
                 animation-play-state: paused !important;
                 animation-delay: var(--demo-clock, 0s) !important;
                 caret-color: transparent !important;
               }
               nextjs-portal { display: none !important; }`
            : ""
        }
      `}</style>
      <AppShell name={DEMO_ME.name} email={DEMO_ME.email} activeHref={NAV_FOR[state.view]}>
        <Screen state={state} />
      </AppShell>
    </>
  );
}
