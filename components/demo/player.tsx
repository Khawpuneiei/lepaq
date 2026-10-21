"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";

import { LepaqLogo } from "@/components/layout/logo";
import type { FrameApi } from "@/components/demo/frame";
import { SCRIPT, type TitleCard } from "@/components/demo/script";

/**
 * The director half of the /demo walkthrough.
 *
 * It owns a 1920x1080 stage: paper background, title cards, a browser
 * window holding the real app (an iframe on /demo/frame), a cursor, a
 * camera and captions. Everything on it is a pure function of one number,
 * the time, so the same film plays live in a browser and renders frame by
 * frame to an MP4 (scripts/record-demo.ts) without drifting.
 *
 * Nothing here animates with CSS transitions. Each frame computes its own
 * styles from `t`, which is what makes frame-by-frame capture exact.
 */

const STAGE_W = 1920;
const STAGE_H = 1080;
/** The app renders at a laptop size, then the window scales it up. */
const APP_W = 1280;
const APP_H = 800;
const APP_SCALE = 1.125;
const WIN_W = APP_W * APP_SCALE;
const CHROME_H = 40;
const WIN_H = APP_H * APP_SCALE + CHROME_H;
const WIN_X = (STAGE_W - WIN_W) / 2;
const WIN_Y = 40;

type Cam = { z: number; tx: number; ty: number };
type Point = { x: number; y: number };

const IDENTITY: Cam = { z: 1, tx: 0, ty: 0 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);

function lastIndex<T extends { at: number }>(keys: T[], t: number) {
  let found = -1;
  for (let i = 0; i < keys.length; i++) if (keys[i].at <= t) found = i;
  return found;
}

/** App pixel -> stage pixel, before the camera. */
function toStage(p: Point): Point {
  return { x: WIN_X + p.x * APP_SCALE, y: WIN_Y + CHROME_H + p.y * APP_SCALE };
}

/**
 * Camera that puts `focus` at `anchor`, clamped on each axis: a window wider
 * than the frame always covers it, and one narrower always stays inside it.
 * Either way no edge of the window drifts into shot mid-zoom.
 */
function camFor(focus: Point, zoom: number, anchor: [number, number]): Cam {
  const fit = (want: number, start: number, size: number, stage: number) => {
    const a = -zoom * start;
    const b = stage - zoom * (start + size);
    return Math.min(Math.max(a, b), Math.max(Math.min(a, b), want));
  };
  return {
    z: zoom,
    tx: fit(anchor[0] * STAGE_W - zoom * focus.x, WIN_X, WIN_W, STAGE_W),
    ty: fit(anchor[1] * STAGE_H - zoom * focus.y, WIN_Y, WIN_H, STAGE_H),
  };
}

// ---- title cards -------------------------------------------------------------

/** "Lepaq *remembers the rest.*" -> words, each flagged if inside asterisks. */
function words(line: string) {
  const out: { text: string; em: boolean }[] = [];
  line.split(/(\*[^*]+\*)/).forEach((part) => {
    const em = part.startsWith("*") && part.endsWith("*");
    part
      .replace(/^\*|\*$/g, "")
      .split(" ")
      .filter(Boolean)
      .forEach((w) => out.push({ text: w, em }));
  });
  return out;
}

/** A word rising out of a blur, staggered after `delay`. */
function riseStyle(local: number, delay: number, exit: number): CSSProperties {
  const p = easeOut(clamp01((local - delay) / 0.75));
  const out = clamp01((local - exit) / 0.5);
  return {
    display: "inline-block",
    opacity: p * (1 - out),
    transform: `translateY(${(1 - p) * 0.45 - out * 0.15}em)`,
    filter: `blur(${(1 - p) * 10 + out * 4}px)`,
  };
}

function Line({
  line,
  local,
  delay,
  exit,
  style,
}: {
  line: string;
  local: number;
  delay: number;
  exit: number;
  style: CSSProperties;
}) {
  return (
    <div style={style}>
      {words(line).map((w, i) => (
        <span key={i} style={riseStyle(local, delay + i * 0.07, exit)}>
          <span
            style={
              w.em
                ? { fontStyle: "italic", color: "var(--brand)" }
                : undefined
            }
          >
            {w.text}
          </span>
          {" "}
        </span>
      ))}
    </div>
  );
}

const SERIF: CSSProperties = {
  fontFamily: "var(--font-demo-serif), var(--font-display), serif",
  fontWeight: 400,
  letterSpacing: "-0.02em",
  lineHeight: 1.02,
  color: "var(--foreground)",
};

function Title({ card, t }: { card: TitleCard; t: number }) {
  const local = t - card.from;
  const exit = card.to - card.from - 0.55;

  if (card.kind === "list") {
    return (
      <div className="absolute inset-0 flex flex-col items-start justify-center" style={{ paddingLeft: 300 }}>
        <Line line={card.heading} local={local} delay={0.1} exit={exit} style={{ ...SERIF, fontSize: 124 }} />
        <div style={{ marginTop: 56 }}>
          {card.items.map((item, i) => {
            const s = riseStyle(local, 0.9 + i * 0.45, exit);
            return (
              <div
                key={item}
                style={{
                  ...s,
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  fontSize: 44,
                  marginTop: i ? 22 : 0,
                  color: "var(--foreground)",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 99,
                    background: "var(--brand)",
                    flex: "none",
                  }}
                />
                {item}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const logo = card.kind === "brand";
  const logoP = easeOut(clamp01(local / 0.8));
  const logoOut = clamp01((local - exit) / 0.5);

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
      {logo && (
        <div
          style={{
            opacity: logoP * (1 - logoOut),
            transform: `scale(${0.92 + 0.08 * logoP})`,
            marginBottom: 54,
            color: "var(--foreground)",
          }}
        >
          <LepaqLogo className="text-[72px]" />
        </div>
      )}
      {card.lines.map((line, i) => (
        <Line
          key={line}
          line={line}
          local={local}
          delay={(logo ? 0.5 : 0.1) + i * 0.45}
          exit={exit}
          style={{ ...SERIF, fontSize: logo ? 150 : 128 }}
        />
      ))}
    </div>
  );
}

// ---- the cursor --------------------------------------------------------------

function Cursor({ at, opacity, press }: { at: Point; opacity: number; press: number }) {
  // press runs 0 -> 1 over the click; the pointer dips and a ring spreads
  const dip = press > 0 ? 1 - 0.14 * Math.sin(Math.PI * clamp01(press / 0.5)) : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        opacity,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      {press > 0 && press < 1 && (
        <span
          style={{
            position: "absolute",
            left: -26 * easeOut(press),
            top: -26 * easeOut(press),
            width: 52 * easeOut(press),
            height: 52 * easeOut(press),
            borderRadius: 999,
            border: "3px solid var(--brand)",
            opacity: 0.85 * (1 - press),
          }}
        />
      )}
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        style={{
          transform: `scale(${dip})`,
          transformOrigin: "3px 2px",
          filter: "drop-shadow(0 3px 6px rgb(31 30 28 / 0.35))",
        }}
      >
        <path
          d="M3 2.2 L3 19.4 L7.6 15.2 L10.6 21.8 L13.6 20.4 L10.7 13.9 L16.9 13.9 Z"
          fill="#1F1E1C"
          stroke="#FFFFFF"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// ---- the player ------------------------------------------------------------------

interface View {
  t: number;
  path: string;
  cam: Cam;
  cursor: { at: Point; opacity: number; press: number } | null;
}

declare global {
  interface Window {
    __demo?: {
      ready: boolean;
      duration: number;
      seek(t: number): Promise<void>;
    };
  }
}

const nextPaint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

export function DemoPlayer({ capture }: { capture: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>({ t: 0, path: "/meetings/new", cam: IDENTITY, cursor: null });
  const [playing, setPlaying] = useState(!capture);
  const [fit, setFit] = useState(1);

  // Resolved positions, per keyframe. A target can vanish once the screen
  // moves on (the button you clicked is gone), so where it was is kept.
  const memo = useRef({
    scroll: new Map<number, number>(),
    cam: new Map<number, Cam>(),
    cursor: new Map<number, Point>(),
    lastT: 0,
  });

  const frame = useCallback((): FrameApi | null => {
    return iframeRef.current?.contentWindow?.__frame ?? null;
  }, []);

  const seek = useCallback(
    async (t: number) => {
      const api = frame();
      if (!api) return;
      const m = memo.current;

      // seeking backwards: forget what was resolved after this point
      if (t < m.lastT) {
        for (const map of [m.scroll, m.cam, m.cursor] as Map<number, unknown>[]) {
          for (const k of [...map.keys()]) {
            const keys = map === m.scroll ? SCRIPT.scroll : map === m.cam ? SCRIPT.camera : SCRIPT.cursor;
            if (keys[k].at > t) map.delete(k);
          }
        }
      }
      m.lastT = t;

      // 1. what the app shows
      const fk = SCRIPT.frames[Math.max(0, lastIndex(SCRIPT.frames, t))];
      const tk = SCRIPT.toasts[lastIndex(SCRIPT.toasts, t)];
      await api.apply({ state: fk.state, toast: tk?.toast ?? null, clock: t });

      // 2. where it is scrolled
      const si = lastIndex(SCRIPT.scroll, t);
      if (si >= 0) {
        const key = SCRIPT.scroll[si];
        if (!m.scroll.has(si)) {
          let y = api.scrollY();
          if (typeof key.to === "number") y = key.to;
          else {
            const r = api.rect(key.to.query);
            if (r) y = api.scrollY() + r.y - key.to.offset;
          }
          m.scroll.set(si, Math.max(0, y));
        }
        const target = m.scroll.get(si)!;
        const from = m.scroll.get(si - 1) ?? target;
        const p = key.dur > 0 ? ease(clamp01((t - key.at) / key.dur)) : 1;
        api.setScroll(lerp(from, target, p));
      }

      // 3. the camera
      const camAt = (i: number): Cam => {
        const key = SCRIPT.camera[i];
        if (!key || key.zoom === 1 || !key.focus) return IDENTITY;
        const r = api.rect(key.focus);
        if (r) {
          const c = camFor(
            toStage({ x: r.x + r.width / 2, y: r.y + r.height / 2 }),
            key.zoom,
            key.anchor ?? [0.5, 0.5],
          );
          m.cam.set(i, c);
          return c;
        }
        return m.cam.get(i) ?? IDENTITY;
      };
      const ci = lastIndex(SCRIPT.camera, t);
      let cam = IDENTITY;
      if (ci >= 0) {
        const key = SCRIPT.camera[ci];
        const target = camAt(ci);
        const from = ci > 0 ? (m.cam.get(ci - 1) ?? (SCRIPT.camera[ci - 1].zoom === 1 ? IDENTITY : target)) : IDENTITY;
        const p = key.dur > 0 ? ease(clamp01((t - key.at) / key.dur)) : 1;
        cam = { z: lerp(from.z, target.z, p), tx: lerp(from.tx, target.tx, p), ty: lerp(from.ty, target.ty, p) };
      }

      // 4. the cursor
      const posAt = (i: number): Point | null => {
        const key = SCRIPT.cursor[i];
        if (!key?.query) return m.cursor.get(i) ?? null;
        const r = api.rect(key.query);
        if (r) {
          const [ox, oy] = key.offset ?? [0, 0];
          const p = { x: r.x + r.width / 2 + ox, y: r.y + r.height / 2 + oy };
          m.cursor.set(i, p);
          return p;
        }
        return m.cursor.get(i) ?? null;
      };
      let cursor: View["cursor"] = null;
      const ki = lastIndex(SCRIPT.cursor, t);
      if (ki >= 0) {
        const cur = SCRIPT.cursor[ki];
        const next = SCRIPT.cursor[ki + 1];
        const move = next?.move ?? 0.9;
        const here = posAt(ki);
        let at = here;
        let opacity = cur.hidden ? 0 : 1;

        if (next && t >= next.at - move) {
          const there = posAt(ki + 1) ?? here;
          const p = ease(clamp01((t - (next.at - move)) / move));
          if (here && there) {
            // a slight arc reads as a hand, a straight line as a robot
            const lift = Math.sin(Math.PI * p) * Math.min(60, Math.hypot(there.x - here.x, there.y - here.y) * 0.12);
            at = { x: lerp(here.x, there.x, p), y: lerp(here.y, there.y, p) - lift };
          }
          const a = cur.hidden ? 0 : 1;
          const b = next.hidden ? 0 : 1;
          opacity = lerp(a, b, b > a ? clamp01(p / 0.4) : clamp01((p - 0.5) / 0.5));
        } else if (next && !cur.hidden && next.hidden) {
          opacity = 1;
        }

        const press = cur.click ? clamp01((t - cur.at) / 0.45) : 0;
        if (at && opacity > 0.001) cursor = { at: toStage(at), opacity, press: press >= 1 ? 0 : press };
      }

      setView({ t, path: fk.path, cam, cursor });
    },
    [frame],
  );

  // ---- boot: wait for the frame, its fonts and ours ------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      while (!cancelled && !frame()) await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;
      await document.fonts.ready;
      await iframeRef.current?.contentDocument?.fonts.ready;
      await seek(0);
      await nextPaint();
      if (cancelled) return;
      setReady(true);
      window.__demo = {
        ready: true,
        duration: SCRIPT.duration,
        async seek(t: number) {
          await seek(t);
          await nextPaint();
        },
      };
    })();
    return () => {
      cancelled = true;
    };
  }, [frame, seek]);

  // ---- live playback ---------------------------------------------------------
  const clock = useRef({ origin: 0, offset: 0 });
  useEffect(() => {
    if (capture || !ready || !playing) return;
    let stop = false;
    clock.current.origin = performance.now() - clock.current.offset * 1000;
    const tick = async () => {
      if (stop) return;
      let t = (performance.now() - clock.current.origin) / 1000;
      if (t >= SCRIPT.duration) {
        t = SCRIPT.duration;
        setPlaying(false);
      }
      clock.current.offset = t;
      await seek(t);
      if (!stop && t < SCRIPT.duration) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      stop = true;
    };
  }, [capture, ready, playing, seek]);

  const jump = useCallback(
    (t: number) => {
      clock.current.offset = Math.min(SCRIPT.duration, Math.max(0, t));
      clock.current.origin = performance.now() - clock.current.offset * 1000;
      void seek(clock.current.offset);
    },
    [seek],
  );

  useEffect(() => {
    if (capture) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        if (!playing && clock.current.offset >= SCRIPT.duration) jump(0);
        setPlaying((p) => !p);
      }
      if (e.code === "ArrowRight") jump(clock.current.offset + 3);
      if (e.code === "ArrowLeft") jump(clock.current.offset - 3);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capture, playing, jump]);

  // ---- fit the stage to the window when watching live ------------------------
  useEffect(() => {
    if (capture) return;
    const onResize = () =>
      setFit(Math.min(window.innerWidth / STAGE_W, (window.innerHeight - 64) / STAGE_H));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [capture]);

  // ---- what is on stage at view.t ------------------------------------------
  const t = view.t;
  const titles = SCRIPT.titles.filter((c) => t >= c.from && t < c.to);
  const caption = SCRIPT.captions.find((c) => t >= c.from && t < c.to);

  const w = SCRIPT.window;
  const enter = easeOut(clamp01((t - w.from) / 0.9));
  const leave = ease(clamp01((t - (w.to - 0.8)) / 0.8));
  const windowOn = t >= w.from - 0.01 && t < w.to;
  const winStyle: CSSProperties = {
    position: "absolute",
    left: WIN_X,
    top: WIN_Y,
    width: WIN_W,
    height: WIN_H,
    opacity: windowOn ? enter * (1 - leave) : 0,
    transform: `translateY(${(1 - enter) * 70 - leave * 24}px) scale(${(0.955 + 0.045 * enter) * (1 - 0.05 * leave)})`,
    transformOrigin: "50% 40%",
    borderRadius: 18,
    overflow: "hidden",
    background: "var(--card)",
    boxShadow: "0 1px 2px rgb(31 30 28 / 0.06), 0 30px 80px -20px rgb(31 30 28 / 0.35), 0 0 0 1px rgb(31 30 28 / 0.08)",
  };

  const cap = caption
    ? {
        p: easeOut(clamp01((t - caption.from) / 0.35)) * (1 - clamp01((t - (caption.to - 0.3)) / 0.3)),
      }
    : null;

  const stage = (
    <div
      style={{
        position: "relative",
        width: STAGE_W,
        height: STAGE_H,
        overflow: "hidden",
        background:
          "radial-gradient(1200px 700px at 12% -10%, rgb(246 230 214 / 0.9), transparent 60%), radial-gradient(900px 600px at 105% 110%, rgb(246 230 214 / 0.7), transparent 60%), var(--background)",
      }}
    >
      {/* titles sit behind the camera layer */}
      {titles.map((card, i) => (
        <Title key={`${card.from}-${i}`} card={card} t={t} />
      ))}

      {/* the camera moves the window and the cursor together */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transformOrigin: "0 0",
          transform: `translate(${view.cam.tx}px, ${view.cam.ty}px) scale(${view.cam.z})`,
        }}
      >
        <div style={winStyle}>
          <div
            className="flex items-center gap-3 border-b px-4"
            style={{ height: CHROME_H, background: "#EFEBE4" }}
          >
            <span className="flex gap-1.5">
              {["#E2803B", "#DCD5C8", "#DCD5C8"].map((c, i) => (
                <span key={i} className="size-3 rounded-full" style={{ background: c }} />
              ))}
            </span>
            <span
              className="mx-auto flex h-6 min-w-[380px] items-center justify-center gap-2 rounded-md px-4 text-xs text-muted-foreground"
              style={{ background: "rgb(255 255 255 / 0.75)" }}
            >
              <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
                <rect x="1" y="5" width="8" height="6.5" rx="1.5" fill="currentColor" />
                <path d="M3 5V3.5a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1.3" fill="none" />
              </svg>
              lepaq{view.path}
            </span>
            <span style={{ width: 52 }} />
          </div>
          <div style={{ width: WIN_W, height: WIN_H - CHROME_H, overflow: "hidden", position: "relative" }}>
            <iframe
              ref={iframeRef}
              src={capture ? "/demo/frame?capture=1" : "/demo/frame"}
              title="Lepaq"
              width={APP_W}
              height={APP_H}
              tabIndex={-1}
              style={{
                border: 0,
                width: APP_W,
                height: APP_H,
                transform: `scale(${APP_SCALE})`,
                transformOrigin: "0 0",
                pointerEvents: "none",
                background: "var(--background)",
              }}
            />
          </div>
        </div>

        {windowOn && view.cursor && (
          <Cursor at={view.cursor.at} opacity={view.cursor.opacity} press={view.cursor.press} />
        )}
      </div>

      {/* captions stay put while the camera moves */}
      {caption && cap && windowOn && (
        <div
          className="absolute inset-x-0 flex justify-center"
          style={{ bottom: 26, opacity: cap.p, transform: `translateY(${(1 - cap.p) * 14}px)` }}
        >
          <div
            className="flex items-center gap-4 rounded-full px-7"
            style={{
              height: 62,
              background: "rgb(31 30 28 / 0.92)",
              color: "#fff",
              fontSize: 27,
              boxShadow: "0 10px 30px -10px rgb(31 30 28 / 0.5)",
            }}
          >
            {caption.step && (
              <span className="font-mono" style={{ color: "var(--brand)", fontSize: 22 }}>
                {caption.step}
              </span>
            )}
            {caption.step && <span style={{ width: 1, height: 24, background: "rgb(255 255 255 / 0.25)" }} />}
            <span>{caption.text}</span>
          </div>
        </div>
      )}
    </div>
  );

  if (capture) {
    return (
      <div style={{ width: STAGE_W, height: STAGE_H, overflow: "hidden" }}>
        {/* the dev-server badge, if recording against `next dev` */}
        <style>{"nextjs-portal { display: none !important; }"}</style>
        {stage}
      </div>
    );
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#1f1e1c]">
      <div style={{ width: STAGE_W * fit, height: STAGE_H * fit, overflow: "hidden" }}>
        <div style={{ transform: `scale(${fit})`, transformOrigin: "0 0" }}>{stage}</div>
      </div>
      <div
        className="flex w-full items-center gap-3 px-4 text-sm text-white/80"
        style={{ maxWidth: STAGE_W * fit, height: 64 }}
      >
        <button
          type="button"
          onClick={() => {
            if (!playing && clock.current.offset >= SCRIPT.duration) jump(0);
            setPlaying((p) => !p);
          }}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label={playing ? "Pause" : "Play"}
          disabled={!ready}
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </button>
        <button
          type="button"
          onClick={() => {
            jump(0);
            setPlaying(true);
          }}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Restart"
          disabled={!ready}
        >
          <RotateCcw className="size-4" />
        </button>
        <input
          type="range"
          min={0}
          max={SCRIPT.duration}
          step={0.05}
          value={t}
          onChange={(e) => jump(Number(e.target.value))}
          className="flex-1 accent-[#E2803B]"
          aria-label="Position"
        />
        <span className="w-24 text-right tabular-nums">
          {fmt(t)} / {fmt(SCRIPT.duration)}
        </span>
      </div>
    </div>
  );
}
