import { FACTS } from "@/components/demo/fixtures";
import type { FrameState, FrameToast } from "@/components/demo/frame";

/**
 * The walkthrough, as data. Every moment of the film is decided here; the
 * director (player.tsx) only interpolates between these keyframes and the
 * frame (frame.tsx) only renders the app state it is handed.
 *
 * Times are seconds from the start. Targets are queries the frame resolves
 * against the real DOM (see `find` in frame.tsx), so a component that moves
 * a button moves the cursor with it — nothing here is a pixel coordinate.
 *
 * Captions only say what the code does. If a feature changes, change its
 * caption in the same commit.
 */

export interface FrameKey {
  at: number;
  state: FrameState;
  /** The path shown in the window's address pill. */
  path: string;
}

export interface ScrollKey {
  at: number;
  dur: number;
  /** A pixel offset, or an element to bring to `offset` px from the top. */
  to: number | { query: string; offset: number };
}

export interface CameraKey {
  at: number;
  dur: number;
  zoom: number;
  /** What to centre. Omitted when zoom is 1: the window's resting framing. */
  focus?: string;
  /** Where on the stage the focus lands, as a fraction of its size. */
  anchor?: [number, number];
}

export interface CursorKey {
  /** When the pointer arrives. It travels during the `move` seconds before. */
  at: number;
  query?: string;
  /** Nudge from the element's centre, in app pixels. */
  offset?: [number, number];
  click?: boolean;
  hidden?: boolean;
  move?: number;
}

export interface Caption {
  from: number;
  to: number;
  step?: string;
  text: string;
}

export type TitleCard =
  | { kind: "brand"; from: number; to: number; lines: string[] }
  | { kind: "statement"; from: number; to: number; lines: string[] }
  | { kind: "list"; from: number; to: number; heading: string; items: string[] };

export interface ToastKey {
  at: number;
  toast: FrameToast | null;
}

export interface Script {
  duration: number;
  frames: FrameKey[];
  scroll: ScrollKey[];
  camera: CameraKey[];
  cursor: CursorKey[];
  captions: Caption[];
  titles: TitleCard[];
  toasts: ToastKey[];
  /** When the app window is on stage. */
  window: { from: number; to: number };
}

const MEETING = "/meetings/7f3c9a2e";

/** The People tab's tick button for each of Priya's facts, in order. */
const TICK = FACTS.map((f) => `label=Approve: ${f.fact}`);
const TICK_AT = [37.5, 38, 38.5, 39, 39.5];

/** `*word*` in a title line renders in italic orange. */
export const SCRIPT: Script = {
  duration: 71,

  titles: [
    { kind: "brand", from: 0, to: 4.8, lines: ["Every coffee chat,", "*remembered.*"] },
    { kind: "statement", from: 4.8, to: 9.2, lines: ["You focus on the person.", "Lepaq *remembers the rest.*"] },
    {
      kind: "list",
      from: 60.4,
      to: 65.8,
      heading: "Private by *architecture.*",
      items: [
        "Row-level security on every table",
        "Audio deleted once it is transcribed",
        "Consent confirmed on every recording",
      ],
    },
    { kind: "brand", from: 65.8, to: 71, lines: ["Every coffee chat,", "*remembered.*"] },
  ],

  window: { from: 9.2, to: 60.4 },

  frames: [
    { at: 0, state: { view: "upload", picked: false }, path: "/meetings/new" },
    { at: 11.5, state: { view: "upload", picked: true }, path: "/meetings/new" },
    { at: 17.1, state: { view: "processing", step: "upload" }, path: "/meetings/new" },
    { at: 18.3, state: { view: "processing", step: "transcribe" }, path: "/meetings/new" },
    { at: 20.3, state: { view: "processing", step: "speakers" }, path: "/meetings/new" },
    { at: 21.5, state: { view: "speakers", chosen: false }, path: `${MEETING}/speakers` },
    { at: 24.2, state: { view: "speakers", chosen: true }, path: `${MEETING}/speakers` },
    { at: 27.1, state: { view: "meeting", tab: "report", approved: false }, path: MEETING },
    {
      at: 32.3,
      state: { view: "meeting", tab: "transcript", approved: false, evidence: 9 },
      path: `${MEETING}#segment-9`,
    },
    { at: 36, state: { view: "meeting", tab: "people", approved: false, ticked: 0 }, path: MEETING },
    ...TICK_AT.map((at, i): FrameKey => ({
      at: at + 0.1,
      state: { view: "meeting", tab: "people", approved: false, ticked: i + 1 },
      path: MEETING,
    })),
    { at: 40.4, state: { view: "meeting", tab: "follow-ups", approved: false, ticked: 5 }, path: MEETING },
    { at: 41.9, state: { view: "meeting", tab: "follow-ups", approved: true }, path: MEETING },
    { at: 45.6, state: { view: "people", travel: false }, path: "/people" },
    { at: 51.1, state: { view: "people", travel: true }, path: "/people" },
    { at: 55.4, state: { view: "meeting", tab: "report", approved: true, share: true }, path: MEETING },
  ],

  scroll: [
    { at: 0, dur: 0, to: 0 },
    { at: 17.1, dur: 0, to: 0 },
    { at: 21.5, dur: 0, to: 0 },
    { at: 27.1, dur: 0, to: 0 },
    // read down the report to the decisions
    { at: 28.6, dur: 1.4, to: { query: "text=Decisions", offset: 96 } },
    // jump to the quoted line
    { at: 32.3, dur: 0, to: { query: "#segment-9", offset: 330 } },
    { at: 36, dur: 0, to: 0 },
    // down to what it learned about Priya
    { at: 36.4, dur: 0.9, to: { query: "text=New things learned", offset: 150 } },
    { at: 40.4, dur: 0, to: 0 },
    { at: 45.6, dur: 0, to: 0 },
    // the table and, under it, the column it suggests
    { at: 46.2, dur: 1, to: { query: "text=Found in your meetings, with no column yet", offset: 590 } },
    { at: 55.4, dur: 0, to: 0 },
  ],

  camera: [
    { at: 0, dur: 0, zoom: 1 },
    // the compression line under the file name
    { at: 12.1, dur: 0.9, zoom: 1.75, focus: "text=Coffee with Priya.m4a", anchor: [0.5, 0.46] },
    { at: 15.1, dur: 0.8, zoom: 1 },
    // the voice it was unsure about
    { at: 22.1, dur: 0.9, zoom: 1.45, focus: "text=Voice B", anchor: [0.36, 0.34] },
    { at: 25, dur: 0.8, zoom: 1 },
    // decisions, each with a quote button
    { at: 30.2, dur: 0.9, zoom: 1.5, focus: "text=Decisions", anchor: [0.5, 0.26] },
    // the line the decision came from
    { at: 32.5, dur: 0.7, zoom: 1.5, focus: "#segment-9", anchor: [0.5, 0.5] },
    { at: 35, dur: 0.8, zoom: 1 },
    // the facts, ticked one by one
    { at: 36.9, dur: 0.9, zoom: 1.35, focus: "text=New things learned", anchor: [0.42, 0.2] },
    { at: 39.9, dur: 0.7, zoom: 1 },
    // the toast that confirms approval
    { at: 42.1, dur: 0.8, zoom: 1.4, focus: "text=Approved.", anchor: [0.62, 0.3] },
    { at: 44.4, dur: 0.8, zoom: 1 },
    // Priya's row, one row per person
    { at: 46.6, dur: 0.9, zoom: 1.3, focus: "row=Priya Raman", anchor: [0.5, 0.4] },
    // the column it suggests
    { at: 49, dur: 0.8, zoom: 1.45, focus: "text=Found in your meetings, with no column yet", anchor: [0.4, 0.42] },
    // the new column, filled in for everyone
    { at: 51.5, dur: 0.9, zoom: 1.3, focus: "row=Priya Raman", anchor: [0.36, 0.42] },
    { at: 54.3, dur: 0.8, zoom: 1 },
    // what a share link includes, and what it never does
    { at: 55.8, dur: 0.9, zoom: 1.4, focus: "[role=dialog]", anchor: [0.5, 0.48] },
    { at: 59, dur: 0.7, zoom: 1 },
  ],

  cursor: [
    { at: 0, hidden: true },
    { at: 10.4, hidden: true, query: "text=Drop the recording here", offset: [160, 240] },
    { at: 11.2, query: "text=Drop the recording here", click: true },
    { at: 12.2, hidden: true, query: "text=Drop the recording here" },
    { at: 15.8, hidden: true, query: "text=Continue", offset: [-80, 60] },
    { at: 16.6, query: "text=Continue", click: true },
    { at: 17.4, hidden: true, query: "text=Continue" },
    { at: 23, hidden: true, query: "label=Who is voice B?", offset: [-60, 90] },
    { at: 23.9, query: "label=Who is voice B?", click: true },
    { at: 25.6, query: "text=Confirm and write the report", move: 1.1 },
    { at: 26.7, query: "text=Confirm and write the report", click: true, move: 0.3 },
    { at: 27.4, hidden: true, query: "text=Confirm and write the report" },
    { at: 31.2, hidden: true, query: "label=Show the line this came from", offset: [-120, 80] },
    { at: 32.1, query: "label=Show the line this came from", click: true },
    { at: 32.6, hidden: true, query: "label=Show the line this came from" },
    { at: 36.9, hidden: true, query: TICK[0], offset: [-140, 90] },
    ...TICK_AT.map((at, i): CursorKey => ({ at, query: TICK[i], click: true, move: i === 0 ? 0.6 : 0.4 })),
    { at: 40.1, hidden: true, query: TICK[4] },
    { at: 40.8, hidden: true, query: "text=Approve report", offset: [-160, -120] },
    { at: 41.7, query: "text=Approve report", click: true },
    { at: 42.3, hidden: true, query: "text=Approve report" },
    { at: 49.9, hidden: true, query: "text=Add column", offset: [-140, 90] },
    { at: 50.9, query: "text=Add column", click: true },
    { at: 51.5, hidden: true, query: "text=Add column" },
  ],

  captions: [
    { from: 9.9, to: 12.3, step: "01", text: "Record in the browser, or upload any meeting" },
    { from: 12.3, to: 17, step: "01", text: "Compressed on your laptop before it uploads" },
    { from: 17.3, to: 21.4, step: "02", text: "Transcribed with a label for every voice" },
    { from: 21.7, to: 24.6, step: "03", text: "Unsure voices are flagged, never guessed" },
    { from: 24.6, to: 27, step: "03", text: "You confirm who said what" },
    { from: 27.3, to: 32.2, step: "04", text: "A report, drafted from the transcript" },
    { from: 32.2, to: 35.8, step: "04", text: "Every decision links to the line it came from" },
    { from: 36.2, to: 40.2, step: "05", text: "You tick what to remember about each person" },
    { from: 40.6, to: 45.3, step: "06", text: "Nothing goes live until you approve it" },
    { from: 45.8, to: 49.2, step: "07", text: "One profile per person, updated every meeting" },
    { from: 49.2, to: 55, step: "07", text: "New topics become new columns, with one click" },
    { from: 55.6, to: 60, step: "08", text: "Share the summary — never the transcript" },
  ],

  toasts: [
    { at: 0, toast: null },
    {
      at: 41.9,
      toast: {
        title: "Approved.",
        description: "Follow-ups are on your list and approved facts are on their profiles.",
      },
    },
    // the "Added Travel" toast is left out: at this zoom it sits half off the
    // top of the frame, and the column filling in says it better
    { at: 45, toast: null },
  ],
};
