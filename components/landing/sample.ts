/**
 * The one sample conversation the landing page follows from top to bottom.
 *
 * Jamie Tan and Harbour Studio are made up, and every place that shows them
 * says so. Nothing on the landing page records, uploads or writes anything:
 * the demo is local state, and the real flow starts behind "Open Lepaq".
 */
export const SAMPLE = {
  meeting: "Pilot discussion",
  place: "Coffee chat",
  length: "38 min",
  at: "14:31",
  person: "Jamie Tan",
  initials: "JT",
  company: "Harbour Studio",
  companyStatus: "Pilot",
  /** the spoken line, split where the demo lifts words out of it */
  quote: {
    title: "Send the proposal",
    joiner: " by ",
    due: "Friday",
    tail: ", can?",
  },
  summary: "Jamie asked for a proposal to explore a pilot with Harbour Studio.",
  followUp: "Send the proposal",
  due: "Friday",
  earlier: { meeting: "Intro over kopi", when: "14 Oct" },
  facts: [
    { label: "Drink", value: "Kopi-o kosong" },
    { label: "How they like to communicate", value: "One-page proposals, WhatsApp first" },
  ],
} as const;

/** Where the real product starts. The proxy sends signed-out visitors to /login?next=/dashboard. */
export const APP_HREF = "/dashboard";
export const WALKTHROUGH_HREF = "/demo";
export const BENCHMARK_HREF = "https://github.com/Khawpuneiei/WhisperLah";
