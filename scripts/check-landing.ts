/**
 * Checks the public landing page as visitors, crawlers and link previews meet
 * it, in a real browser, against a running build:
 *
 *   npm run build && npm run start          # in one terminal
 *   npm run check:landing                   # in another
 *
 * Options (through npm, after a "--": npm run check:landing -- --base=<url>):
 *   --base=http://localhost:3000   where the app is running
 *   --only=tight,back              just these parts: http, links, tight, back,
 *                                  keys, translate, motion, reveal, fallback
 *
 * Uses an installed Chrome or Edge through playwright-core, as demo:record
 * does, so there is no browser download. Set LANDING_BROWSER to a Chromium
 * executable to choose one.
 *
 * The ids in brackets are findings in docs/landing-page-plan.md: each check
 * is here because that thing shipped broken once, or nearly did. Run it after
 * any change to the story, its CSS, proxy.ts or next.config.ts.
 */

import "./load-env";
import { existsSync } from "node:fs";

import { chromium, type Browser, type BrowserContextOptions, type Page } from "playwright-core";

import { safeNext } from "../lib/safe-next";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  }),
);
// npm keeps a --base given without the "--" for itself, as npm_config_base
const BASE = (args.base ?? process.env.npm_config_base ?? "http://localhost:3000").replace(/\/+$/, "");

/** What --only can name, in the order they run. */
const PARTS = ["http", "links", "tight", "back", "keys", "translate", "motion", "reveal", "fallback"];

// A misspelt option or part would check nothing and still end "All passed":
// --only=keyboard, a bare --only, or "--only=tight, back" split by the shell
// [REV-20]
{
  const unknown = Object.keys(args).filter((k) => k !== "base" && k !== "only");
  if (unknown.length) {
    fail(`Unknown option ${unknown.map((k) => `"${k}"`).join(", ")}. The options are --base=<url> and --only=<parts>.`);
  }
  const wrong = args.only === "true" ? [""] : (args.only?.split(",").filter((p) => !PARTS.includes(p.trim())) ?? []);
  if (wrong.length) {
    fail(`--only takes a comma-separated list of: ${PARTS.join(", ")}. ${wrong.map((p) => JSON.stringify(p)).join(", ")} is not one.`);
  }
}

function playwrightBrowser(): string | undefined {
  try {
    return chromium.executablePath();
  } catch {
    return undefined;
  }
}

const BROWSERS = [
  process.env.LANDING_BROWSER,
  process.env.DEMO_BROWSER,
  playwrightBrowser(),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p): p is string => Boolean(p));

/** The story's chapters in order: the stage shows step i + 1 for CHAPTERS[i], and 0 for the opening. */
const CHAPTERS = ["written", "drafted", "approved", "remembered"];

type Size = { name: string; width: number; height: number; mobile?: boolean };

const LAPTOP: Size = { name: "laptop 1440x900", width: 1440, height: 900 };
const PHONE: Size = { name: "phone 390x844", width: 390, height: 844, mobile: true };
const SIZES: Size[] = [
  LAPTOP,
  // a 13-inch laptop once the browser's own bars are counted [ROB-2]
  { name: "short laptop 1280x593", width: 1280, height: 593 },
  { name: "tablet 768x1024", width: 768, height: 1024, mobile: true },
  PHONE,
  { name: "small phone 320x568", width: 320, height: 568, mobile: true },
  // these two unpin the stage: a phone held sideways, and that laptop at 200% zoom [A11Y-1]
  { name: "phone sideways 844x390", width: 844, height: 390, mobile: true },
  { name: "laptop at 200% zoom 640x296", width: 640, height: 296 },
];

let failures = 0;
let warnings = 0;
const section = (s: string) => console.log(`\n── ${s}`);
const ok = (s: string, d = "") => console.log(`   ok    ${s}${d ? "  — " + d : ""}`);
const bad = (s: string, d = "") => {
  console.log(`   FAIL  ${s}${d ? "  — " + d : ""}`);
  failures++;
};
const warn = (s: string, d = "") => {
  console.log(`   warn  ${s}${d ? "  — " + d : ""}`);
  warnings++;
};
const check = (pass: boolean, s: string, d = "") => (pass ? ok(s, d) : bad(s, d));

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/* ───────────────────────────── over HTTP ───────────────────────────── */

async function get(path: string, init: RequestInit = {}) {
  const started = performance.now();
  const res = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  const body = await res.text();
  return { res, body, ms: Math.round(performance.now() - started) };
}

/** The cookie name @supabase/ssr uses for this project. */
function sessionCookieName(): string {
  try {
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0];
    return `sb-${ref || "check"}-auth-token`;
  } catch {
    return "sb-check-auth-token";
  }
}

/**
 * A session that expired long ago. Anything that checks the session has to
 * try a refresh with it, which waits on Supabase; the landing page must not.
 */
function expiredSessionCookie(): string {
  const session = {
    access_token: "check.landing.expired",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 1,
    refresh_token: "check-landing",
    user: { id: "00000000-0000-0000-0000-000000000000" },
  };
  return `${sessionCookieName()}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

/**
 * The check above proves something only if the proxy would act on that cookie.
 * Its name comes from this machine's NEXT_PUBLIC_SUPABASE_URL; for another
 * Supabase project the proxy sees no session and answers at once, slow or not.
 * So the same cookie goes to /login, which the proxy does run on: it must wait
 * on Supabase there, or clear the cookie.
 */
async function proxyControl() {
  const label = "control: the same cookie does reach the session check on /login";
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    warn(label, "NEXT_PUBLIC_SUPABASE_URL is unset here, so the cookie has no project's name and PROXY-1 was not tested");
    return;
  }
  const started = performance.now();
  try {
    const res = await fetch(`${BASE}/login`, {
      redirect: "manual",
      headers: { cookie: expiredSessionCookie() },
      signal: AbortSignal.timeout(3000),
    });
    await res.text();
    const ms = Math.round(performance.now() - started);
    if (res.headers.has("set-cookie")) ok(label, `the proxy cleared it in ${ms} ms`);
    else
      warn(
        label,
        `answered in ${ms} ms without touching it: this machine's Supabase project is not the one at ${BASE}, so PROXY-1 was not tested`,
      );
  } catch {
    ok(label, "it waited on Supabase for over 3 s");
  }
}

async function overHttp() {
  section("What crawlers and link previews get");

  const home = await get("/");
  check(home.res.status === 200, "/ answers 200 to a signed-out visitor", `${home.res.status}`);

  const meta = (attr: string, key: string) =>
    home.body.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, "&");

  const image = meta("property", "og:image");
  if (!image) {
    bad("a preview image [SEO-1]", "no og:image on /");
  } else {
    const url = new URL(image);
    const png = await get(url.pathname + url.search);
    const type = png.res.headers.get("content-type") ?? "";
    check(png.res.status === 200 && type.startsWith("image/"), "a preview image, and it loads [SEO-1]", `${png.res.status} ${type}`);
    if (url.origin !== new URL(BASE).origin) {
      warn(
        "the preview image points at another address",
        `${url.origin}. Expected on a Vercel preview (it points at production); anywhere else, set NEXT_PUBLIC_APP_URL and rebuild`,
      );
    }
  }
  const card = meta("name", "twitter:card");
  check(card === "summary_large_image", "large preview card [SEO-1]", card ?? "none");
  check(Boolean(meta("property", "og:image:alt")), "the preview image has alt text [SEO-1]");
  const theme = meta("name", "theme-color");
  check(theme === "#f7f5f1", "theme colour [SEO-6]", theme ?? "none");

  const canonical = home.body.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  check(Boolean(canonical), "canonical link [SEO-2]", canonical ?? "none");
  const sitemap = await get("/sitemap.xml");
  if (canonical && /^https?:\/\//.test(canonical)) {
    check(home.body.includes('<script type="application/ld+json">'), "structured data for search [SEO-5]");
    check(/<loc>[^<]+<\/loc>/.test(sitemap.body), "the sitemap lists the public pages [SEO-3]");
  } else {
    warn(
      "built without a site address",
      "canonical is relative, the sitemap is empty and there is no structured data. Set NEXT_PUBLIC_APP_URL, or deploy on Vercel, then rebuild",
    );
  }
  check(sitemap.res.status === 200 && sitemap.body.includes("<urlset"), "sitemap.xml answers, without a sign-in redirect [SEO-3]", `${sitemap.res.status}`);

  const robots = await get("/robots.txt");
  check(
    robots.res.status === 200 && /Disallow: \/dashboard/.test(robots.body),
    "robots.txt answers, and keeps crawlers out of the app [SEO-3]",
    `${robots.res.status}`,
  );
  // a crawler that may not fetch /s/ never sees its noindex, and can still list the bare link
  check(!/Disallow: \/s\b/.test(robots.body), "robots.txt leaves /s/ crawlable, so its noindex is seen [PRIV-1]");

  const slow = await get("/", { headers: { cookie: expiredSessionCookie() } });
  check(
    slow.res.status === 200 && slow.ms < 2000 && !slow.res.headers.has("set-cookie"),
    "/ does not wait on the session check, even with an expired session cookie [PROXY-1]",
    `${slow.res.status} in ${slow.ms} ms${slow.res.headers.has("set-cookie") ? ", and the proxy rewrote the cookie" : ""}`,
  );
  await proxyControl();

  // the walkthrough the page links to reads no session either [REV-2]
  for (const path of ["/demo", "/demo/frame"]) {
    const demo = await get(path, { headers: { cookie: expiredSessionCookie() } });
    check(
      demo.res.status === 200 && demo.ms < 2000 && !demo.res.headers.has("set-cookie"),
      `${path} does not wait on the session check either [REV-2]`,
      `${demo.res.status} in ${demo.ms} ms`,
    );
  }

  const h = home.res.headers;
  const wanted: [string, boolean][] = [
    ["X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff"],
    ["X-Frame-Options: SAMEORIGIN", h.get("x-frame-options") === "SAMEORIGIN"],
    ["Referrer-Policy", h.has("referrer-policy")],
    ["Permissions-Policy with microphone=(self)", /microphone=\(self\)/.test(h.get("permissions-policy") ?? "")],
    ["no X-Powered-By", !h.has("x-powered-by")],
  ];
  const missing = wanted.filter(([, has]) => !has).map(([name]) => name);
  check(missing.length === 0, "security headers [SEC-1]", missing.length ? `missing: ${missing.join(", ")}` : "");

  const share = await get("/s/check-landing");
  const robotsTag = share.res.headers.get("x-robots-tag") ?? "";
  check(
    /noindex/.test(robotsTag) && share.res.headers.get("referrer-policy") === "no-referrer",
    "shared summaries are noindex and send no referrer [PRIV-1]",
    `X-Robots-Tag: ${robotsTag || "none"}`,
  );
  // a shared meeting's link must not unfurl as the landing page's made-up follow-up
  const shareImage = /<meta property="og:image"/.test(share.body);
  const shareCard = share.body.match(/<meta name="twitter:card" content="([^"]*)"/)?.[1];
  check(
    share.body.includes("Meeting summary") && !shareImage && shareCard === "summary",
    "a shared summary's link preview is a plain card, without the landing image [REV-3]",
    `${shareImage ? "og:image set" : "no og:image"}, twitter:card ${shareCard ?? "none"}`,
  );

  const app = await get("/dashboard");
  const to = app.res.headers.get("location") ?? "";
  check(
    app.res.status >= 300 && app.res.status < 400 && to.includes("/login"),
    "the app still sends signed-out visitors to sign in",
    `${app.res.status} ${to}`,
  );
}

/* ───────────────────────────── in the browser ───────────────────────────── */

type Open = BrowserContextOptions & { init?: string; fontSize?: number; path?: string };

async function open(browser: Browser, size: Size, { init, fontSize, path = "/", ...options }: Open = {}) {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.mobile,
    hasTouch: size.mobile,
    ...options,
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  if (fontSize) {
    // the browser's own text-size setting, which media queries see too (a CSS
    // font-size on <html> would not reach them)
    const cdp = await context.newCDPSession(page);
    await cdp.send("Page.setFontSizes", { fontSizes: { standard: fontSize, fixed: Math.round(fontSize * 0.8125) } });
  }
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  return { context, page, errors };
}

/** Waits for the story's script to start (the stage goes live); if it never does, that is an error. */
async function live(page: Page, errors: string[]) {
  try {
    await page.waitForFunction(() => document.querySelector("[data-live] [data-step]") !== null, null, {
      timeout: 15_000,
    });
    await page.waitForTimeout(150);
  } catch {
    errors.push("the story's script never started");
  }
}

const stepNow = (page: Page) =>
  page.evaluate(() => document.querySelector<HTMLElement>("[data-step]")?.dataset.step ?? "gone");

/** Follows a chapter link as a visitor would: the rail when it is on screen, otherwise the address bar. */
async function jump(page: Page, id: string) {
  const link = page.locator(`nav[aria-label="Story chapters"] a[href="#${id}"]`);
  const box = (await link.count()) ? await link.boundingBox() : null;
  const height = page.viewportSize()?.height ?? 0;
  if (box && box.y >= 0 && box.y + box.height <= height && (await link.isVisible())) {
    await link.click();
  } else {
    await page.evaluate((hash) => {
      location.hash = hash;
    }, `#${id}`);
  }
}

/** Waits for the stage to show a step with nothing still flying. */
async function settled(page: Page, step: number) {
  try {
    await page.waitForFunction(
      (want) =>
        document.querySelector<HTMLElement>("[data-step]")?.dataset.step === String(want) &&
        !document.querySelector("[data-hold]"),
      step,
      { timeout: 4000 },
    );
    return true;
  } catch {
    return false;
  }
}

/** "" when a chapter's first words are on screen with nothing over them, else what is wrong. */
function wordsInView(page: Page, id: string) {
  return page.evaluate((id) => {
    const card = document.querySelector<HTMLElement>(`#${id} [data-story-text]`);
    if (!card) return "missing";
    const r = card.getBoundingClientRect();
    const x = r.left + Math.min(24, r.width / 2);
    const y = r.top + Math.min(16, r.height / 2);
    if (y < 0 || y > innerHeight) return `off screen (top at ${Math.round(r.top)} of ${innerHeight})`;
    const hit = document.elementFromPoint(x, y);
    if (hit && card.contains(hit)) return "";
    if (hit?.closest("header")) return "under the header";
    if (hit?.closest("[data-live]")) return "under the stage";
    return `under ${hit?.tagName.toLowerCase() ?? "nothing"}`;
  }, id);
}

/** Every chapter in turn, then back to the opening; returns what went wrong. */
async function walkChapters(page: Page, order = [...CHAPTERS.keys(), -1]) {
  const misses: string[] = [];
  for (const i of order) {
    const id = i < 0 ? "chapter-start" : `chapter-${CHAPTERS[i]}`;
    await jump(page, id);
    if (!(await settled(page, i + 1))) misses.push(`${id}: the stage shows step ${await stepNow(page)}, not ${i + 1}`);
    const words = i < 0 ? "" : await wordsInView(page, id);
    if (words) misses.push(`${id}: words ${words}`);
  }
  return misses;
}

/**
 * What the stage must keep on screen while it is pinned: the Approve button in
 * chapters 2 and 3, the open follow-up on the person's page in chapter 4. ""
 * when it fits (or the stage is not pinned at this size), else what is cut.
 */
function stageFits(page: Page, step: number) {
  return page.evaluate((step) => {
    const stage = document.querySelector<HTMLElement>("[data-live] [data-step]");
    if (!stage || getComputedStyle(stage.parentElement!).position !== "sticky") return "";
    const want = step === 4 ? '[data-on] [class*="__openTitle"]' : '[class*="__approveBtn"]';
    const el = [...stage.querySelectorAll<HTMLElement>(want)].find((e) => e.getClientRects().length > 0);
    if (!el) return `no ${step === 4 ? "open follow-up" : "Approve button"} on the stage`;
    const r = el.getBoundingClientRect();
    const box = stage.getBoundingClientRect();
    const cut = Math.max(0, Math.ceil(r.bottom - box.bottom));
    return cut ? `${step === 4 ? "the open follow-up" : "the Approve button"} is cut off by ${cut}px` : "";
  }, step);
}

/**
 * Where the rail's visible text and bars overprint the scene under it, one
 * label runs into the next, a "Sample" tag covers the follow-up or the
 * person's name, or the opening's words (which share the screen with the
 * spoken line on a desktop) cross it, while the stage is on screen. Text is
 * measured by its ink,
 * not its element's box or even its line box: a 6rem serif line's box reaches
 * well above its letters.
 * A string, like TRANSLATE: tsx would wrap its inner functions in a helper the
 * page does not have.
 */
const STAGE_CLASHES = `(() => {
  const rail = document.querySelector('nav[aria-label="Story chapters"]');
  const stage = document.querySelector("[data-live] [data-step]");
  if (!rail || !stage) return [];
  // only on screen: a stage that scrolls with the page has gone by the later chapters
  const seen = stage.getBoundingClientRect();
  if (seen.bottom <= 0 || seen.top >= innerHeight) return [];
  const ctx = document.createElement("canvas").getContext("2d");
  // a text box's top is its baseline less the font's ascent; the ink starts lower
  const ink = (host, text, r) => {
    const s = getComputedStyle(host);
    ctx.font = s.fontStyle + " " + s.fontWeight + " " + s.fontSize + " " + s.fontFamily;
    const m = ctx.measureText(s.textTransform === "uppercase" ? text.toUpperCase() : text);
    const baseline = r.top + (r.height - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
    return new DOMRect(r.left, baseline - m.actualBoundingBoxAscent, r.width, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  };
  const textBoxes = (root) => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      const host = n.parentElement;
      if (!n.nodeValue.trim() || getComputedStyle(host).visibility === "hidden") continue;
      if (host.getClientRects().length === 0 || host.getBoundingClientRect().width <= 1) continue;
      let faded = false;
      for (let e = host; e && e !== root.parentElement; e = e.parentElement) {
        if (getComputedStyle(e).opacity === "0") faded = true;
      }
      if (faded) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width > 1 && r.height > 1) out.push({ text: n.nodeValue.trim(), host, r: ink(host, n.nodeValue.trim(), r) });
      }
    }
    return out;
  };
  const overlap = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
  const clashes = [];

  const labels = [...rail.querySelectorAll('[class*="__railText"]')].map((l) => textBoxes(l));
  for (let i = 0; i + 1 < labels.length; i++) {
    for (const a of labels[i]) for (const b of labels[i + 1]) {
      if (overlap(a.r, b.r)) clashes.push('"' + a.text + '" runs into "' + b.text + '"');
    }
  }

  const railBoxes = textBoxes(rail).concat(
    [...rail.querySelectorAll('[class*="__railBar"]')].map((b) => ({ text: "", r: b.getBoundingClientRect() })),
  );
  const scene = [...stage.querySelectorAll("[data-on]")].filter((s) => getComputedStyle(s).opacity !== "0");
  for (const part of scene) {
    for (const t of textBoxes(part)) {
      const hit = railBoxes.find((b) => overlap(b.r, t.r));
      if (hit) clashes.push((hit.text ? 'rail "' + hit.text + '"' : "a rail bar") + ' over "' + t.text.slice(0, 30) + '"');
    }
  }

  // a "Sample" tag over any words of its own scene: the report's, which small
  // stages move onto the slip's edge, once over the follow-up [REV-6], and the
  // person page's, over Jamie's name [LT-3]. Not its own word, nor the stamp's
  // ring of text
  for (const tag of stage.querySelectorAll('[data-on] [class*="__sampleTag"]')) {
    if (!tag.getClientRects().length) continue;
    const box = tag.getBoundingClientRect();
    for (const t of textBoxes(tag.closest("[data-on]"))) {
      if (tag.contains(t.host) || t.host.closest("svg")) continue;
      if (overlap(box, t.r)) clashes.push('the "Sample" tag over "' + t.text.slice(0, 30) + '"');
    }
  }

  // the opening's headline, lede and the rule above them, against the spoken
  // line and its recording strip: on a short desktop they share one screen
  // [REV-15], and the opening rises with the page while the line stays pinned
  // (tightAt walks through that) [REV-23]. The opening's card is an opaque
  // sheet over the stage, its top edge the rule: where it is the thing on
  // top, the line's ink under it is hidden, not overprinted, and ink just
  // above it is sliding under the rule, not crossed by it. Where a visit
  // starts the sheet must hide nothing; the walk sets moving
  const moving = false;
  const opening = stage.dataset.step === "0" && document.querySelector('#chapter-start [class*="__opening"]');
  if (opening) {
    const words = textBoxes(opening);
    const ob = opening.getBoundingClientRect();
    const rule = parseFloat(getComputedStyle(opening).borderTopWidth) > 0 ? ob.top : null;
    const card = opening.closest('[class*="__stepCard"]');
    // a sheet only if the stage cannot show through it: a solid background,
    // no opacity or opacity filter on the card or anything above it (opacity
    // is not inherited), and no blend mode from the chapters' list up (one
    // inside the list blends only within the list's own stacking context)
    const opaque = (el) => {
      const list = el.closest('[class*="__steps"]');
      for (let e = el, above = !list; e; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (e === list) above = true;
        if (s.opacity !== "1" || s.filter.includes("opacity(") || (above && s.mixBlendMode !== "normal")) return false;
      }
      const px = document.createElement("canvas").getContext("2d");
      px.fillStyle = getComputedStyle(el).backgroundColor;
      px.fillRect(0, 0, 1, 1);
      return px.getImageData(0, 0, 1, 1).data[3] === 255;
    };
    const sheet = card && opaque(card) ? card.getBoundingClientRect() : null;
    // the card, not the stage, is what shows just inside its top edge at x
    const onTop = (x) => {
      const hit = document.elementFromPoint(x, sheet.top + 1);
      return Boolean(hit) && card.contains(hit);
    };
    for (const part of scene) {
      const strip = [...part.querySelectorAll('[class*="__wave"] span')]
        .filter((b) => b.getClientRects().length)
        .map((b) => ({ text: "the recording strip", r: b.getBoundingClientRect() }));
      for (const line of textBoxes(part).concat(strip)) {
        let r = line.r;
        const shielded = sheet !== null && r.left >= sheet.left - 1 && r.right <= sheet.right + 1 && onTop((r.left + r.right) / 2);
        if (shielded && r.bottom > sheet.top) {
          if (!moving) clashes.push('the opening card hides "' + line.text.slice(0, 30) + '"');
          if (r.top >= sheet.top) continue;
          r = new DOMRect(r.left, r.top, r.width, sheet.top - r.top);
        }
        const t = { text: line.text, r };
        const w = words.find((b) => overlap(b.r, t.r));
        if (w) clashes.push('"' + w.text.slice(0, 20) + '" over "' + t.text.slice(0, 30) + '"');
        const edge = shielded && rule !== null && Math.abs(rule - sheet.top) <= 1;
        const across = Math.min(t.r.right, ob.right) - Math.max(t.r.left, ob.left) > 1;
        if (rule !== null && !edge && across && t.r.top < rule + 1 && t.r.bottom > rule - 2) clashes.push('the rule above the headline through "' + t.text.slice(0, 30) + '"');
      }
    }
  }
  return [...new Set(clashes)].slice(0, 4);
})()`;

/**
 * Stage text that leaves its box sideways: cut off by the stage, or running
 * past the edge of the card it sits in [LT-1, LT-3], and the words a flight
 * lands in broken over two lines [REV-18]. A line the design
 * truncates on purpose (an ellipsis) is left alone, except the follow-up's
 * title, which must show whole, and so is the stamp's ring of text. Only
 * while the stage is on screen: where it scrolls with the page, the later
 * chapters are read with it out of sight. A string, like STAGE_CLASHES.
 */
const STAGE_CUTS = `(() => {
  const stage = document.querySelector("[data-live] [data-step]");
  if (!stage) return [];
  const box = stage.getBoundingClientRect();
  if (box.bottom <= 0 || box.top >= innerHeight) return [];
  const shown = (el) => {
    for (let e = el; e && e !== stage.parentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    }
    return el.getClientRects().length > 0;
  };
  const cuts = [];
  const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const host = n.parentElement;
    const text = n.nodeValue.trim();
    if (!text || !host.closest("[data-on]") || host.closest("svg") || !shown(host)) continue;
    let ellipsis = null;
    for (let e = host; e && e !== stage; e = e.parentElement) {
      if (getComputedStyle(e).textOverflow === "ellipsis") { ellipsis = e; break; }
    }
    if (ellipsis) {
      if (/__openTitle|__itemTitle/.test(ellipsis.className) && ellipsis.scrollWidth > ellipsis.clientWidth + 1) {
        cuts.push('the follow-up title is cut to ' + Math.round((100 * ellipsis.clientWidth) / ellipsis.scrollWidth) + '% ("' + text + '")');
      }
      continue;
    }
    // the edges that matter: the nearest card (a border or a fill) and anything that clips
    let left = -Infinity, right = Infinity, card = false;
    for (let e = host.parentElement; e && e !== stage.parentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      const inner = [b.left + parseFloat(s.borderLeftWidth), b.right - parseFloat(s.borderRightWidth)];
      const filled = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
      const bordered = (parseFloat(s.borderLeftWidth) > 0 && s.borderLeftStyle !== "none") || (parseFloat(s.borderRightWidth) > 0 && s.borderRightStyle !== "none");
      if (!card && (filled || bordered)) { card = true; left = Math.max(left, inner[0]); right = Math.min(right, inner[1]); }
      if (s.overflowX !== "visible") { left = Math.max(left, inner[0]); right = Math.min(right, inner[1]); }
    }
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      const out = Math.max(r.right - right, left - r.left);
      if (out > 1.5) { cuts.push('"' + text.slice(0, 30) + '" runs out of its box by ' + Math.round(out) + 'px'); break; }
    }
  }
  // the words a flight lands in keep to one line: the copy flies at the size
  // of the box it lands in, so a phrase broken over two lines lands twice its
  // size. Lines are counted from the text's own boxes: a flex or grid item
  // reports one box however many lines its text takes [REV-27]
  for (const e of stage.querySelectorAll("[data-on] [data-k]")) {
    if (!shown(e)) continue;
    const rows = [];
    const inside = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    while (inside.nextNode()) {
      if (!inside.currentNode.nodeValue.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(inside.currentNode);
      for (const r of range.getClientRects()) {
        if (r.width <= 0.5) continue;
        // boxes that share most of their height are on one line
        const row = rows.find((b) => Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 0.5 * Math.min(b.height, r.height));
        if (!row) rows.push(r);
      }
    }
    if (rows.length > 1) cuts.push('the flying words "' + e.textContent.trim().slice(0, 30) + '" break over ' + rows.length + ' lines');
  }
  return [...new Set(cuts)].slice(0, 4);
})()`;

const stageCuts = (page: Page) => page.evaluate(STAGE_CUTS) as Promise<string[]>;

/**
 * The finale's picture of the app's Follow-ups page: no words over other
 * words (by their ink), and none running out of the card they sit in or out
 * of the window, which clips them [REV-25]. A string, like STAGE_CLASHES.
 */
const APP_FITS = `(() => {
  const win = document.querySelector('[class*="__appWindow"]');
  if (!win) return ["it is missing"];
  const ctx = document.createElement("canvas").getContext("2d");
  const ink = (host, text, r) => {
    const s = getComputedStyle(host);
    ctx.font = s.fontStyle + " " + s.fontWeight + " " + s.fontSize + " " + s.fontFamily;
    const m = ctx.measureText(s.textTransform === "uppercase" ? text.toUpperCase() : text);
    const baseline = r.top + (r.height - m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
    return new DOMRect(r.left, baseline - m.actualBoundingBoxAscent, r.width, m.actualBoundingBoxAscent + m.actualBoundingBoxDescent);
  };
  const boxes = [];
  const out = [];
  const walker = document.createTreeWalker(win, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const host = n.parentElement;
    const text = n.nodeValue.trim();
    if (!text || !host.getClientRects().length || getComputedStyle(host).visibility === "hidden") continue;
    // the edges it keeps inside: the nearest card (a fill or a border), at the latest the window's
    let edge = null;
    for (let e = host.parentElement; e && e !== win.parentElement; e = e.parentElement) {
      const s = getComputedStyle(e);
      const filled = s.backgroundColor !== "rgba(0, 0, 0, 0)" && s.backgroundColor !== "transparent";
      const bordered = parseFloat(s.borderLeftWidth) > 0 && s.borderLeftStyle !== "none";
      if (filled || bordered || e === win) {
        const b = e.getBoundingClientRect();
        edge = [b.left + parseFloat(s.borderLeftWidth), b.right - parseFloat(s.borderRightWidth)];
        break;
      }
    }
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width <= 1 || r.height <= 1) continue;
      boxes.push({ text, host, r: ink(host, text, r) });
      const off = edge ? Math.max(r.right - edge[1], edge[0] - r.left) : 0;
      if (off > 1.5) out.push('"' + text.slice(0, 30) + '" runs out of its box by ' + Math.round(off) + "px");
    }
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].r;
      const b = boxes[j].r;
      if (boxes[i].host === boxes[j].host) continue;
      if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) {
        out.push('"' + boxes[i].text.slice(0, 20) + '" over "' + boxes[j].text.slice(0, 20) + '"');
      }
    }
  }
  return [...new Set(out)].slice(0, 4);
})()`;

/**
 * Scrolls the finale's picture of the app into view, waits for it to arrive,
 * and runs APP_FITS. It waits for the picture's timed animations, at most
 * 5s, since one that loops never finishes and would hold the whole run; a
 * scroll-driven one holds still where the scroll leaves it, so it is not
 * waited for [REV-31].
 */
async function appFits(page: Page) {
  await page.evaluate(() => document.querySelector('[class*="__appWindow"]')?.scrollIntoView({ block: "center" }));
  await page
    .waitForFunction(() => document.querySelector('[class*="__appWindow"]')?.hasAttribute("data-in") ?? true, null, { timeout: 5000 })
    .catch(() => undefined);
  const running = await page.evaluate(async () => {
    const win = document.querySelector('[class*="__appWindow"]');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const timed = (win?.getAnimations({ subtree: true }) ?? []).filter((a) => a.timeline === document.timeline);
    await Promise.race([
      Promise.all(timed.map((a) => a.finished.catch(() => undefined))),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
    return timed
      .filter((a) => a.playState === "running")
      .map((a) => ("animationName" in a ? String(a.animationName) : "transitionProperty" in a ? String(a.transitionProperty) : "an animation"));
  });
  const misses = (await page.evaluate(APP_FITS)) as string[];
  return running.length ? [`${running.join(", ")} still running after 5s`, ...misses] : misses;
}

/** The header keeps one row: the logo clear of Open Lepaq, and both on screen [LT-2]. */
function headerFits(page: Page) {
  return page.evaluate(() => {
    const logo = document.querySelector<HTMLElement>('header a[aria-label="Lepaq, home"]');
    const open = [...document.querySelectorAll<HTMLElement>("header a")].find((a) => /Open Lepaq/.test(a.textContent ?? ""));
    if (!logo || !open) return "the header has no logo or no Open Lepaq";
    let right = -Infinity;
    for (const part of logo.querySelectorAll("svg, span")) {
      if (getComputedStyle(part).display === "none") continue;
      for (const r of part.getClientRects()) if (r.width > 0) right = Math.max(right, r.right);
    }
    const b = open.getBoundingClientRect();
    if (right > b.left + 0.5) return `the logo runs ${Math.round(right - b.left)}px under Open Lepaq`;
    if (b.right > document.documentElement.clientWidth + 0.5) return `Open Lepaq runs ${Math.round(b.right - document.documentElement.clientWidth)}px off the screen`;
    return "";
  });
}

const stageClashes = (page: Page) => page.evaluate(STAGE_CLASHES) as Promise<string[]>;

/** STAGE_CLASHES while the page is between rests: the opening's sheet may be covering the line [REV-23]. */
const MOVING_CLASHES = STAGE_CLASHES.replace("const moving = false;", "const moving = true;");
if (MOVING_CLASHES === STAGE_CLASHES) throw new Error("STAGE_CLASHES no longer has its moving switch");

async function chapterLinks(browser: Browser) {
  section("Chapter links land on their chapter, words in view [A11Y-1, A11Y-2, ROB-1, ROB-10, ROB-M2]");
  for (const size of SIZES) {
    const { context, page, errors } = await open(browser, size);
    await live(page, errors);
    const misses = await walkChapters(page);
    check(misses.length + errors.length === 0, size.name, [...misses, ...errors].join("; "));
    await context.close();
  }

  // a shared link or a reload on a chapter: the browser scrolls there before the story's script runs
  for (const size of SIZES) {
    const { context, page, errors } = await open(browser, size, { path: "/#chapter-approved" });
    await live(page, errors);
    const misses: string[] = [];
    if (!(await settled(page, 3))) misses.push(`the stage shows step ${await stepNow(page)}, not 3`);
    const words = await wordsInView(page, "chapter-approved");
    if (words) misses.push(`words ${words}`);
    check(misses.length + errors.length === 0, `${size.name}, opened on #chapter-approved`, [...misses, ...errors].join("; "));
    await context.close();
  }

  // large default text: the header row and the chapters [ROB-M3]; the stage and rail have their own section
  for (const size of [LAPTOP, PHONE]) {
    const { context, page, errors } = await open(browser, size, { fontSize: 32 });
    await live(page, errors);
    const misses = await walkChapters(page);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (sideways > 0) misses.push(`the page scrolls sideways by ${sideways}px`);
    check(misses.length + errors.length === 0, `${size.name}, text at 200%`, [...misses, ...errors].join("; "));
    await context.close();
  }
}

/**
 * Short screens and large default text, where the stage runs out of room.
 * `voices`: chapter 1 still names who is speaking; only the smallest stages
 * drop that line [REV-16].
 * `source`: Jamie's page in chapter 4 still says which meeting the follow-up
 * came from, at a size where only the report has to drop that line [REV-30].
 * `pinned: false`: the stage is meant to scroll with the page here (below
 * 64rem wide and 30rem tall or less), so only the header, the chapters and
 * sideways scroll are checked. Every other size fails if its stage does not
 * pin, so a size cannot pass without the stage being checked [REV-22].
 */
const TIGHT: [Size, number | undefined, { voices?: boolean; source?: boolean; pinned?: boolean }?][] = [
  [{ name: "short laptop 1280x593", width: 1280, height: 593 }, undefined],
  [{ name: "short laptop 1280x593, Large text", width: 1280, height: 593 }, 20],
  [{ name: "that laptop at 125% zoom 1024x474", width: 1024, height: 474 }, undefined],
  [{ name: "1536x730 at 150% zoom 1024x487", width: 1024, height: 487 }, undefined],
  // a stage just over 27rem, where the desktop's smaller key line used to start [REV-17]
  [{ name: "laptop 1024x500", width: 1024, height: 500 }, undefined],
  [{ name: "laptop 1280x625, Large text", width: 1280, height: 625 }, 20],
  // and just over that tier's top, on a wide screen, where the key line is longest
  [{ name: "laptop 1536x530", width: 1536, height: 530 }, undefined],
  [{ name: "laptop 1280x720, Very large text", width: 1280, height: 720 }, 24, { pinned: false }],
  [{ name: "laptop 1280x800, Very large text", width: 1280, height: 800 }, 24],
  [{ name: "laptop 1024x768, Very large text", width: 1024, height: 768 }, 24],
  [{ name: "laptop 1440x900, text at 200%", width: 1440, height: 900 }, 32, { pinned: false }],
  [{ name: "desktop 1920x969, text at 200%", width: 1920, height: 969 }, 32],
  [{ name: "desktop 2560x1300, text at 200%", width: 2560, height: 1300 }, 32],
  [{ name: "laptop at 200% zoom, still pinned 960x484", width: 960, height: 484 }, undefined],
  // a stage 30-36rem wide (the report's three ruled rows, the line still
  // above the speakers) just over the 27rem and 33rem tiers [REV-24]: a window
  // a third of a 1080p screen with Large text, that window at 125% zoom, and
  // a narrow window just over the phone layout's 33rem tier
  [{ name: "window a third of a 1080p screen, Large text 640x947", width: 640, height: 947 }, 20],
  [{ name: "that window at 125% zoom 512x758", width: 512, height: 758 }, undefined],
  [{ name: "narrow window 575x914", width: 575, height: 914 }, undefined, { source: true }],
  [{ name: "phone 360x640, Large text", width: 360, height: 640, mobile: true }, 20],
  [{ name: "phone 390x844, Very large text", width: 390, height: 844, mobile: true }, 24],
  [{ name: "phone 360x800, Very large text", width: 360, height: 800, mobile: true }, 24],
  [{ name: "phone 412x915, Very large text", width: 412, height: 915, mobile: true }, 24, { voices: true }],
  // a stage 16rem wide, just over 22rem tall: the smallest stages' branch has to start above it [REV-16]
  [{ name: "phone 320x761, Large text", width: 320, height: 761, mobile: true }, 20],
  // the narrowest stages in rem, pinned and not [LT-1 to LT-4]
  [{ name: "phone 390x844, text at 175%", width: 390, height: 844, mobile: true }, 28],
  [{ name: "phone 412x915, text at 175%", width: 412, height: 915, mobile: true }, 28],
  [{ name: "phone 360x640, text at 200%", width: 360, height: 640, mobile: true }, 32, { pinned: false }],
  [{ name: "small phone 320x568, text at 200%", width: 320, height: 568, mobile: true }, 32, { pinned: false }],
];

/**
 * `scrollbars`: a browser that draws classic scrollbars, as Windows does.
 * Headless Chrome hides them, which gives the page about 15px more width
 * than most desktop visitors have [REV-18].
 */
async function tightStage(browser: Browser, scrollbars?: Browser) {
  section(
    "The stage keeps its point in view when it is short or narrow, nothing prints over it or runs out of its box (nor in the closing picture of the app), and nothing pushes the page sideways [ROB-2, A11Y-6, REV-4 to REV-6, REV-15 to REV-18, REV-23 to REV-25, REV-27, LT-1 to LT-5]",
  );
  for (const [size, fontSize, also] of TIGHT) await tightAt(browser, size, fontSize, size.name, also);
  if (!scrollbars) return;
  for (const [size, fontSize, also] of TIGHT) {
    if (!size.mobile) await tightAt(scrollbars, size, fontSize, `${size.name}, classic scrollbars`, also);
  }
}

async function tightAt(
  browser: Browser,
  size: Size,
  fontSize: number | undefined,
  name: string,
  also: { voices?: boolean; source?: boolean; pinned?: boolean } = {},
) {
  const { context, page, errors } = await open(browser, size, { fontSize });
  await live(page, errors);
  const misses: string[] = [];
  const header = await headerFits(page);
  if (header) misses.push(header);
  for (const i of [-1, 0, 1, 2, 3]) {
    const id = i < 0 ? "chapter-start" : `chapter-${CHAPTERS[i]}`;
    await jump(page, id);
    if (!(await settled(page, i + 1))) {
      misses.push(`${id}: the stage shows step ${await stepNow(page)}, not ${i + 1}`);
      continue;
    }
    await page.waitForTimeout(450);
    if (i >= 1) {
      const cut = await stageFits(page, i + 1);
      if (cut) misses.push(`${id}: ${cut}`);
    }
    if (i === 0) {
      const pinned = await page.evaluate(
        () => getComputedStyle(document.querySelector("[data-live] [data-step]")!.parentElement!).position === "sticky",
      );
      if (pinned !== (also.pinned ?? true)) {
        misses.push(pinned ? "the stage pins here, over the chapters" : "the stage scrolls with the page here, so nothing on it is checked");
      }
    }
    if (i === 0 && also.voices) {
      const named = await page.evaluate(() =>
        [...document.querySelectorAll('[data-live] [data-on] [class*="__turnKey"] [class*="__turnMeta"]')].some((e) => e.getClientRects().length > 0),
      );
      if (!named) misses.push(`${id}: the stage no longer shows who is speaking`);
    }
    if (i === 3 && also.source) {
      const cited = await page.evaluate(() =>
        [...document.querySelectorAll('[data-live] [data-on] [class*="__prep"] [class*="__cite"]')].some((e) => e.getClientRects().length > 0),
      );
      if (!cited) misses.push(`${id}: Jamie's page no longer says which meeting the follow-up came from`);
    }
    for (const c of await stageClashes(page)) misses.push(`${id}: ${c}`);
    for (const c of await stageCuts(page)) misses.push(`${id}: ${c}`);
    if (i < 0) for (const c of await openingRises(page)) misses.push(`${id}, ${c}`);
  }
  for (const c of await appFits(page)) misses.push(`the closing picture: ${c}`);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (sideways > 0) misses.push(`the page scrolls sideways by ${sideways}px`);
  check(misses.length + errors.length === 0, name, [...new Set([...misses, ...errors])].join("; "));
  await context.close();
}

/**
 * On a desktop the opening's words share the screen with the pinned spoken
 * line, and rise with the page while it stays put until chapter one takes over
 * (0.15 of the window's height later). A key press or a slow scroll stops in
 * between, so this walks down through step 0 in 4px steps and runs
 * STAGE_CLASHES at each stop; the first stop that clashes is reported
 * [REV-23]. Below 64rem the stage covers the chapters instead.
 */
async function openingRises(page: Page) {
  const wide = await page.evaluate(() => matchMedia("(width >= 64rem)").matches);
  if (!wide) return [];
  const start = await page.evaluate(() => Math.round(scrollY));
  for (let y = start + 4; y < start + 600; y += 4) {
    const step = await page.evaluate(async (y) => {
      scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector<HTMLElement>("[data-live] [data-step]")?.dataset.step;
    }, y);
    if (step !== "0") return [];
    const clashes = (await page.evaluate(MOVING_CLASHES)) as string[];
    if (clashes.length) return clashes.map((c) => `${y}px down: ${c}`);
  }
  return ["chapter one never took over"];
}

/**
 * Back after the page's #links. Next ignores Back to a history entry it did
 * not make, and a plain #link makes one, so Back from sign-in used to change
 * the address and leave the sign-in page on screen [REV-7].
 */
async function historyBack(browser: Browser) {
  section("Back and Forward work after the page's #links, a reload at the top stays there, the logo goes to the top, and Back leaves the walkthrough [REV-7, REV-13, REV-14, REV-26, REV-28, REV-29]");
  const { context, page, errors } = await open(browser, LAPTOP);
  await live(page, errors);

  await jump(page, "chapter-approved");
  await settled(page, 3);
  await page.locator('footer a[href="/login"]').click();
  await page.waitForURL("**/login**", { timeout: 10_000 }).catch(() => undefined);
  const out = new URL(page.url()).pathname;
  await page.goBack();
  const home = await page
    .waitForFunction(() => document.querySelector("#story") !== null, null, { timeout: 5000 })
    .then(() => true, () => false);
  const there = home && (await settled(page, 3));
  check(
    out === "/login" && home && there,
    "a chapter link, then Sign in, then Back: the landing page, on that chapter",
    out !== "/login" ? `the link went to ${out}` : !home ? `still showing ${await page.title()} at ${page.url()}` : !there ? `step ${await stepNow(page)}` : "",
  );

  // the same with a reload on the sign-in page: Next then draws this page
  // again after the browser has restored the scroll, and it opened at the top
  // [REV-14]. In a page of its own, so a miss here cannot fail the next check.
  {
    const { context, page, errors } = await open(browser, LAPTOP);
    await live(page, errors);
    await jump(page, "chapter-approved");
    await settled(page, 3);
    await page.locator('footer a[href="/login"]').click();
    await page.waitForURL("**/login**", { timeout: 10_000 }).catch(() => undefined);
    await page.reload();
    // Back only once React runs the sign-in page again: before that nothing
    // handles it, in any Next app
    await page
      .waitForFunction(() => Object.keys(document.body).some((k) => k.startsWith("__reactFiber")), null, { timeout: 10_000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);
    await page.goBack();
    const again = await page
      .waitForFunction(() => document.querySelector("#story") !== null, null, { timeout: 10_000 })
      .then(() => true, () => false);
    const onIt = again && (await settled(page, 3));
    check(
      again && onIt && errors.length === 0,
      "a chapter link, then Sign in and a reload, then Back: the landing page, on that chapter",
      !again ? `still showing ${await page.title()} at ${page.url()}` : !onIt ? `step ${await stepNow(page)} at y=${await page.evaluate(() => Math.round(scrollY))}` : errors.join("; "),
    );
    await context.close();
  }

  // and this page's own reload: a reader who used a #link, went back to the
  // top and reloads (F5, or pulling down on a phone, which only works at the
  // top) stays at the top. The REV-14 scroll is for this page drawn again
  // after a reload elsewhere; it also ran here and jumped to the chapter
  // [REV-26]
  {
    const { context, page, errors } = await open(browser, LAPTOP);
    await live(page, errors);
    await jump(page, "chapter-approved");
    await settled(page, 3);
    await page.keyboard.press("Home");
    const top = await page
      .waitForFunction(() => scrollY === 0, null, { timeout: 5000 })
      .then(() => settled(page, 0), () => false);
    await page.reload({ waitUntil: "networkidle" });
    await live(page, errors);
    await page.waitForTimeout(500);
    const y = await page.evaluate(() => Math.round(scrollY));
    const step = await stepNow(page);
    check(
      top && y === 0 && step === "0" && errors.length === 0,
      "a chapter link, then back to the top and a reload: the page stays at the top",
      !top ? "Home did not reach the top" : y !== 0 || step !== "0" ? `it opened at y=${y}, on step ${step}` : errors.join("; "),
    );
    await context.close();
  }

  await jump(page, "chapter-written");
  await settled(page, 1);
  await jump(page, "chapter-remembered");
  await settled(page, 4);
  await page.goBack();
  const back = await settled(page, 1);
  await page.goForward();
  const forward = await settled(page, 4);
  check(back && forward && errors.length === 0, "Back and Forward between chapters land on them", [
    ...(back ? [] : ["Back did not return to chapter 1"]),
    ...(forward ? [] : ["Forward did not return to chapter 4"]),
    ...errors,
  ].join("; "));

  await context.close();

  // The header's logo is this page's "home": as a Link to "/" it changed the
  // address and left a reader far down the page where they were [REV-29].
  // Clicked with the mouse, as a reader does: Playwright's own click first
  // scrolls the sticky header's link "into view", which moves the page
  {
    const { context, page, errors } = await open(browser, LAPTOP);
    await live(page, errors);
    await jump(page, "chapter-remembered");
    const far = await settled(page, 4);
    const logo = await page.locator('header a[aria-label="Lepaq, home"]').boundingBox();
    if (logo) await page.mouse.click(logo.x + logo.width / 2, logo.y + logo.height / 2);
    const top = await page
      .waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 })
      .then(() => true, () => false);
    const y = await page.evaluate(() => Math.round(window.scrollY));
    const opening = top && (await settled(page, 0));
    await page.goBack({ timeout: 10_000 }).catch(() => null);
    const back = await settled(page, 4);
    check(
      far && logo !== null && opening && back && errors.length === 0,
      "the header's logo, far down the page: the top, and Back returns there",
      !far
        ? "chapter 4 never showed"
        : logo === null
          ? "no logo link in the header"
          : !opening
            ? `the page stayed at y=${y}, on step ${await stepNow(page)}`
            : !back
              ? `Back left it on step ${await stepNow(page)}`
              : errors.join("; "),
    );
    await context.close();
  }

  // The walkthrough the page links to marks its evidence line with a #hash,
  // in /demo's iframe. Set by assignment, each one added a Back step to the
  // tab, so Back stayed on the walkthrough twice per pass [REV-13]. As a
  // visitor: the footer's link, the film skipped ahead with its own arrow key
  // into the evidence scene and out of it, then one Back [REV-28]
  {
    const { context, page, errors } = await open(browser, LAPTOP);
    await live(page, errors);
    await page.locator('footer a[href="/demo"]').click();
    await page.waitForURL("**/demo", { timeout: 10_000 }).catch(() => undefined);
    const ready = await page
      .waitForFunction(() => document.querySelector('button[aria-label="Restart"]:not([disabled])') !== null, null, { timeout: 20_000 })
      .then(() => true, () => false);
    const film = () => page.frames().find((f) => f !== page.mainFrame() && new URL(f.url()).pathname === "/demo/frame");
    const marks: string[] = [];
    for (let k = 0; ready && k < 20; k++) {
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(300);
      const hash = (await film()?.evaluate(() => location.hash).catch(() => "?")) ?? "no frame";
      if (marks.at(-1) !== hash) marks.push(hash);
      if (marks.includes("#segment-9") && hash !== "#segment-9") break;
    }
    // a Back that only moves the frame's # never navigates the tab, and
    // Playwright would wait for it until the whole run timed out
    await page.goBack({ timeout: 10_000 }).catch(() => null);
    const home = await page
      .waitForFunction(() => location.pathname === "/" && document.querySelector("#story") !== null, null, { timeout: 10_000 })
      .then(() => true, () => false);
    const passed = marks.includes("#segment-9") && marks.at(-1) !== "#segment-9";
    check(
      ready && passed && home && errors.length === 0,
      "the walkthrough's evidence line, then one Back: the landing page",
      !ready
        ? "the film never got ready"
        : !passed
          ? `the frame's address went ${marks.join(", ") || "nowhere"}`
          : !home
            ? `Back stayed on ${new URL(page.url()).pathname}`
            : errors.join("; "),
    );
    await context.close();
  }
}

async function keyboard(browser: Browser) {
  section("Keyboard focus is visible, and never lands on hidden links [A11Y-3, A11Y-4]");
  const { context, page, errors } = await open(browser, LAPTOP);
  await live(page, errors);
  const problems: string[] = [];
  let stops = 0;
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40),
        ring: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1 && s.outlineColor !== "rgba(0, 0, 0, 0)",
      };
    });
    if (!f) continue;
    stops++;
    if (!f.ring) problems.push(`no visible outline on "${f.name}"`);
  }
  check(stops >= 8 && problems.length === 0, "focus outlines on the first stops", problems.join("; ") || `${stops} stops`);

  // once the opening fades out, its "Scroll to follow" link must leave the tab order
  await jump(page, "chapter-drafted");
  await settled(page, 2);
  await page.waitForTimeout(400);
  const cue = await page.evaluate(
    () => getComputedStyle(document.querySelector('#chapter-start a[href="#chapter-written"]')!).visibility,
  );
  check(cue === "hidden", "the faded opening's link cannot take focus", `visibility: ${cue}`);
  check(errors.length === 0, "no errors", errors.join("; "));
  await context.close();

  // below 1024px the stage is pinned over the page: a link Tab lands on must scroll clear of it [A11Y-2]
  const phone = await open(browser, PHONE);
  await live(phone.page, phone.errors);
  let where = "never reached";
  for (let i = 0; i < 40; i++) {
    await phone.page.keyboard.press("Tab");
    const inChapter = await phone.page.evaluate(() => Boolean(document.activeElement?.closest("#chapter-written")));
    if (!inChapter) continue;
    await phone.page.waitForTimeout(300);
    // each line of the link on its own: the middle of a link that wraps is
    // the paragraph between its two lines [REV-21]
    where = await phone.page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const lines = [...el.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!lines.length) return "not drawn";
      for (const r of lines) {
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && (hit === el || el.contains(hit))) continue;
        if (hit?.closest("header")) return "under the header";
        if (hit?.closest("[data-live]")) return "under the stage";
        return `under ${hit?.tagName.toLowerCase() ?? "nothing"} (top at ${Math.round(r.top)} of ${innerHeight})`;
      }
      return "";
    });
    break;
  }
  check(where === "" && phone.errors.length === 0, `${PHONE.name}: a focused link in a chapter is not under the stage`, [where, ...phone.errors].filter(Boolean).join("; "));
  await phone.context.close();
}

/** What a page translator does to text: each run of words becomes <font><font>…</font></font>, again as text changes. */
const TRANSLATE = `(() => {
  const skip = "script,style,noscript,font,[translate=no],.notranslate";
  const wrap = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !n.parentElement.closest(skip) ? 1 : 3),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const outer = document.createElement("font");
      const inner = document.createElement("font");
      inner.textContent = "[zh] " + n.nodeValue;
      outer.appendChild(inner);
      n.parentNode.replaceChild(outer, n);
    }
    return nodes.length;
  };
  let t = 0;
  new MutationObserver(() => {
    clearTimeout(t);
    t = setTimeout(wrap, 100);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  return wrap();
})()`;

async function translated(browser: Browser) {
  section("A page translator does not break the story [ROB-M1]");
  for (const size of [LAPTOP, PHONE]) {
    const { context, page, errors } = await open(browser, size);
    await live(page, errors);
    const words = (await page.evaluate(TRANSLATE)) as number;
    // down, back up (where it used to crash), and down again
    const misses = await walkChapters(page, [0, 1, 2, 3, 2, 1, 0, -1, 0, 1]);
    const stage = await page.evaluate(() => document.querySelector("[data-live] [data-step]") !== null);
    if (!stage) misses.push("the story fell back to its plain version");
    check(words > 50 && misses.length + errors.length === 0, size.name, [...misses, ...errors].join("; ") || `${words} runs translated`);
    await context.close();
  }
}

async function reducedMotion(browser: Browser) {
  section("Reduced motion: the stage changes at once, with nothing flying [ROB-8]");
  for (const size of [LAPTOP, PHONE]) {
    const { context, page, errors } = await open(browser, size, { reducedMotion: "reduce" });
    await live(page, errors);
    const misses: string[] = [];
    for (const [i, name] of CHAPTERS.entries()) {
      await jump(page, `chapter-${name}`);
      await page.waitForTimeout(120);
      const now = await page.evaluate(() => {
        const stage = document.querySelector<HTMLElement>("[data-step]");
        if (!stage?.firstElementChild) return { step: "gone", flying: 0, shown: false };
        const scenes = [...stage.firstElementChild.children].filter((s) => s.hasAttribute("data-on"));
        return {
          step: stage.dataset.step,
          flying: document.querySelectorAll("[data-hold]").length,
          shown: scenes.some((s) => getComputedStyle(s).opacity === "1"),
        };
      });
      if (now.step !== String(i + 1)) misses.push(`${name}: step ${now.step}`);
      if (now.flying) misses.push(`${name}: ${now.flying} words flying`);
      if (!now.shown) misses.push(`${name}: the stage is blank`);
    }
    check(misses.length + errors.length === 0, size.name, [...misses, ...errors].join("; "));
    await context.close();
  }
}

async function reveals(browser: Browser) {
  section("Scroll-in content arrives, never hides what is on screen, and prints [A11Y-12, ROB-3, PERF-M1]");

  const { context, page, errors } = await open(browser, LAPTOP);
  await live(page, errors);
  const held = await page.evaluate(() => document.querySelectorAll("[data-armed]:not([data-in])").length);
  await page.emulateMedia({ media: "print" });
  const blank = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-armed]:not([data-in])")]
        .flatMap((r) => [r, ...r.querySelectorAll('[class*="__rise"], [class*="__bar"]')])
        .filter((el) => getComputedStyle(el).opacity !== "1" || getComputedStyle(el).transform !== "none").length,
  );
  check(held > 0 && blank === 0, "printing shows what has not scrolled in yet", `${held} held back, ${blank} hidden on paper`);
  await page.emulateMedia({ media: "screen" });
  await context.close();

  // tall blocks at large text never reached the old 20% threshold
  for (const [size, fontSize] of [
    [LAPTOP, undefined],
    [{ name: "phone 320x568", width: 320, height: 568, mobile: true }, 32],
  ] as [Size, number | undefined][]) {
    const { context, page, errors: more } = await open(browser, size, { fontSize });
    await live(page, more);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.5) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    await page.waitForTimeout(300);
    const stuck = await page.evaluate(() => document.querySelectorAll("[data-armed]:not([data-in])").length);
    check(stuck === 0 && more.length === 0, `scrolling down brings every one in: ${size.name}${fontSize ? ", text at 200%" : ""}`, [
      ...(stuck ? [`${stuck} never arrived`] : []),
      ...more,
    ].join("; "));
    await context.close();
  }

  // arriving at a section by its link: what is on screen when the page wakes up stays put
  const linked = await open(browser, LAPTOP, { path: "/#privacy" });
  await live(linked.page, linked.errors);
  const state = await linked.page.evaluate(() => {
    const list = document.querySelector("#privacy [data-in], #privacy [data-armed]");
    return list ? { armed: list.hasAttribute("data-armed"), shown: list.hasAttribute("data-in") } : null;
  });
  check(
    Boolean(state?.shown && !state.armed),
    "content already on screen is never hidden to play its entrance",
    state ? `armed: ${state.armed}, in: ${state.shown}` : "no Reveal in #privacy",
  );
  check(errors.length + linked.errors.length === 0, "no errors", [...errors, ...linked.errors].join("; "));
  await linked.context.close();
}

/** Makes the story's own script throw as it starts, as a failed chunk or an old browser would. */
const BREAK_STORY = `(() => {
  const real = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    if (query === "(min-width: 64rem)") throw new Error("check:landing breaks the story on purpose");
    return real(query);
  };
})()`;

async function fallbacks(browser: Browser) {
  section("Without the story's script, the chapters still read as a page [A11Y-7, ROB-M1]");

  for (const size of [LAPTOP, PHONE]) {
    for (const [label, options] of [
      ["JavaScript off", { javaScriptEnabled: false }],
      ["the story's script fails", { init: BREAK_STORY }],
    ] as [string, Open][]) {
      const { context, page, errors } = await open(browser, size, options);
      if (options.init) await page.waitForTimeout(500);
      const misses: string[] = [];
      for (const name of ["start", ...CHAPTERS]) {
        // where a chapter link (the rail works without JavaScript) puts it
        await page.evaluate((id) => document.getElementById(id)?.scrollIntoView({ block: "start" }), `chapter-${name}`);
        await page.waitForTimeout(80);
        const words = await wordsInView(page, `chapter-${name}`);
        if (words) misses.push(`${name}: words ${words}`);
        if (name === "start") continue;
        // on desktop the chapters are drawn above the stage, so the probe above
        // cannot see them sharing a screen with it: the stage must have gone [A11Y-7]
        const stage = await page.evaluate((id) => {
          const el = document.querySelector<HTMLElement>("[data-step]");
          const card = document.querySelector(`#${id} [data-story-text]`);
          if (!el || !card) return "";
          if (["sticky", "fixed"].includes(getComputedStyle(el.parentElement!).position)) return "the stage is still pinned";
          const a = el.getBoundingClientRect();
          const b = card.getBoundingClientRect();
          const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          return shared > 0 && Math.min(a.right, b.right) > Math.max(a.left, b.left) ? `the stage shares ${Math.round(shared)}px with the words` : "";
        }, `chapter-${name}`);
        if (stage) misses.push(`${name}: ${stage}`);
      }
      // the broken story logs the error it caught; anything else is real
      const other = errors.filter((e) => !e.includes("breaks the story on purpose"));
      if (options.init) {
        const broke = errors.length > other.length && !(await page.evaluate(() => document.querySelector("[data-live]")));
        if (!broke) misses.push("the story did not break, so its fallback was not tested");
      }
      check(misses.length + other.length === 0, `${size.name}, ${label}`, [...new Set([...misses, ...other])].join("; "));
      await context.close();
    }
  }
}

/** The sign-in page's ?next= cases: each must stay on this site [SEC-3, REV-1]. */
function signInRedirects() {
  section("After sign-in, ?next= only ever leads back into Lepaq [SEC-3, REV-1]");
  const origin = "https://lepaq.example";
  const cases: [string | null, string][] = [
    [null, "/dashboard"],
    ["/meetings/123?tab=x#y", "/meetings/123?tab=x#y"],
    ["/dashboard", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["/\t/evil.example", "/dashboard"],
    ["/.//evil.example", "/dashboard"],
    ["/..//evil.example", "/dashboard"],
    ["/%2e//evil.example", "/dashboard"],
    ["/a/..//evil.example", "/dashboard"],
    ["/./\\evil.example", "/dashboard"],
    [`${origin}//evil.example`, "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
  ];
  const wrong = cases
    .map(([raw, want]) => [raw, want, safeNext(raw, origin)] as const)
    .filter(([, want, got]) => got !== want)
    .map(([raw, want, got]) => `${JSON.stringify(raw)} gave ${got}, not ${want}`);
  check(wrong.length === 0, `${cases.length} cases`, wrong.join("; "));
}

async function main() {
  try {
    await fetch(`${BASE}/`, { method: "HEAD" });
  } catch {
    fail(`Nothing is answering at ${BASE}. Start the app first: npm run build && npm run start`);
  }

  console.log(`Checking the landing page at ${BASE}`);
  const only = args.only === undefined ? null : new Set(args.only.split(",").map((p) => p.trim()));
  const run = (part: string) => !only || only.has(part);
  if (run("http")) {
    await overHttp();
    signInRedirects();
  }
  if (!PARTS.some((p) => p !== "http" && run(p))) return done();

  const executablePath = BROWSERS.find((p) => existsSync(p));
  if (!executablePath) fail("No Edge or Chrome found. Set LANDING_BROWSER to a Chromium browser executable.");
  const browser = await chromium.launch({ executablePath, headless: true });
  const scrollbars = run("tight")
    ? await chromium.launch({ executablePath, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] })
    : undefined;
  try {
    if (run("links")) await chapterLinks(browser);
    if (run("tight")) await tightStage(browser, scrollbars);
    if (run("back")) await historyBack(browser);
    if (run("keys")) await keyboard(browser);
    if (run("translate")) await translated(browser);
    if (run("motion")) await reducedMotion(browser);
    if (run("reveal")) await reveals(browser);
    if (run("fallback")) await fallbacks(browser);
  } finally {
    await browser.close();
    await scrollbars?.close();
  }
  done();
}

function done(): never {
  console.log(
    `\n${failures ? `${failures} failed` : "All passed"}${warnings ? `, ${warnings} warning${warnings > 1 ? "s" : ""}` : ""}.`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
