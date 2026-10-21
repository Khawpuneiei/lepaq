/**
 * Renders the /demo walkthrough to an MP4, one frame at a time.
 *
 *   npm run build && npm run start          # in one terminal
 *   npm run demo:record                     # in another
 *
 * Options:
 *   --base=http://localhost:3000   where the app is running
 *   --fps=30                       frames per second
 *   --out=demo-out/lepaq-demo.mp4  output file
 *   --stills=3,13.8,44             write PNGs at these seconds instead of a video
 *
 * Why frames rather than a screen recording: the player computes every
 * frame from a single clock (components/demo/player.tsx), so stepping that
 * clock and screenshotting gives a perfectly smooth 1080p file no matter how
 * slow this machine is. A live screen capture drops frames whenever the
 * machine stutters.
 *
 * Uses an installed Edge or Chrome through playwright-core, so there is no
 * browser download. Set DEMO_BROWSER to a browser executable to override.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";
import { chromium } from "playwright-core";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.join("=") || "true"];
  }),
);

const BASE = args.base ?? "http://localhost:3000";
const FPS = Number(args.fps ?? 30);
const OUT = path.resolve(args.out ?? "demo-out/lepaq-demo.mp4");
const STILLS = args.stills ? args.stills.split(",").map(Number) : null;

const BROWSERS = [
  process.env.DEMO_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((p): p is string => Boolean(p));

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main() {
  const executablePath = BROWSERS.find((p) => existsSync(p));
  if (!executablePath) fail("No Edge or Chrome found. Set DEMO_BROWSER to a Chromium browser executable.");

  try {
    await fetch(`${BASE}/demo`, { method: "HEAD" });
  } catch {
    fail(`Nothing is answering at ${BASE}. Start the app first: npm run build && npm run start`);
  }

  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--hide-scrollbars", "--force-color-profile=srgb", "--disable-lcd-text"],
  });

  try {
    const page = await (
      await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1,
        colorScheme: "light",
      })
    ).newPage();

    page.on("pageerror", (err) => console.error("page error:", err.message));

    await page.goto(`${BASE}/demo?capture=1`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__demo?.ready === true, null, { timeout: 120_000 });
    const duration = await page.evaluate(() => window.__demo!.duration);

    // ---- stills, for checking a moment without rendering the whole film ----
    if (STILLS) {
      const dir = path.dirname(OUT);
      mkdirSync(dir, { recursive: true });
      // Walk the clock forward so every tween has resolved its start point,
      // exactly as it would have in a full render.
      let t = 0;
      for (const at of [...STILLS].sort((a, b) => a - b)) {
        for (; t < at; t += 1 / FPS) await page.evaluate((s) => window.__demo!.seek(s), t);
        await page.evaluate((s) => window.__demo!.seek(s), at);
        const file = path.join(dir, `still-${at.toFixed(1).padStart(4, "0")}.png`);
        await page.screenshot({ path: file, type: "png" });
        console.log(`wrote ${path.relative(process.cwd(), file)}`);
      }
      return;
    }

    // ---- the film -----------------------------------------------------------
    const ffmpeg = ffmpegPath as unknown as string | null;
    if (!ffmpeg) fail("ffmpeg-static has no binary for this platform.");
    mkdirSync(path.dirname(OUT), { recursive: true });

    const encoder = spawn(
      ffmpeg,
      [
        "-y",
        "-loglevel", "error",
        "-f", "image2pipe",
        "-framerate", String(FPS),
        "-c:v", "mjpeg",
        "-i", "-",
        "-c:v", "libx264",
        "-preset", "slow",
        "-crf", "17",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        OUT,
      ],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const finished = new Promise<number>((resolve) => encoder.on("close", resolve));

    const total = Math.round(duration * FPS);
    const started = Date.now();

    for (let i = 0; i <= total; i++) {
      await page.evaluate((s) => window.__demo!.seek(s), i / FPS);
      const jpeg = await page.screenshot({ type: "jpeg", quality: 95 });
      if (!encoder.stdin.write(jpeg)) {
        await new Promise((r) => encoder.stdin.once("drain", r));
      }
      if (i % FPS === 0) {
        const done = i / total;
        const eta = done > 0 ? ((Date.now() - started) / done) * (1 - done) : 0;
        process.stdout.write(
          `\rframe ${i}/${total}  ${(done * 100).toFixed(0)}%  about ${Math.ceil(eta / 60_000)} min left   `,
        );
      }
    }

    encoder.stdin.end();
    const code = await finished;
    if (code !== 0) fail(`ffmpeg exited with ${code}.`);
    console.log(`\nwrote ${path.relative(process.cwd(), OUT)} (${duration}s at ${FPS} fps)`);
  } finally {
    await browser.close();
  }
}

declare global {
  interface Window {
    __demo?: { ready: boolean; duration: number; seek(t: number): Promise<void> };
  }
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
