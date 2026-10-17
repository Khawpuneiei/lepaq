"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CONSENT_SCRIPT } from "@/lib/constants";
import { formatDuration } from "@/lib/talkRatio";
import { cn } from "@/lib/utils";

/**
 * One-tap capture: record the meeting in the browser, pause when the
 * conversation goes off the record, and hand the result to the same upload
 * path a picked file takes.
 *
 * Nothing leaves the device while recording. The audio is held in memory as
 * MediaRecorder chunks and only becomes an upload when the rep presses
 * Process meeting at the end of the wizard — so closing the tab mid-meeting
 * loses it. That is the honest trade-off of a web app; the screen wake lock
 * and the leave-page warning below are what keep it from happening by
 * accident.
 */

type Phase = "idle" | "starting" | "recording" | "paused";

/**
 * In order of preference. Opus in WebM is what Chrome, Edge and Firefox
 * produce; Safari produces AAC in MP4. Both are formats the server and
 * OpenAI accept, and both extensions are on the upload allow-list.
 */
const FORMATS = [
  { mime: "audio/webm;codecs=opus", ext: "webm" },
  { mime: "audio/mp4", ext: "m4a" },
  { mime: "audio/webm", ext: "webm" },
] as const;

/** Mono speech at 48kbps — the same budget the compressor aims for. */
const BITS_PER_SECOND = 48_000;

/** How many bars the level meter shows, newest on the right. */
const BARS = 40;

function pickFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  return FORMATS.find((f) => MediaRecorder.isTypeSupported(f.mime)) ?? null;
}

function fileName(ext: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Recording ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${ext}`;
}

function describeError(err: unknown) {
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Microphone access was blocked. Allow it in the browser's site settings, then tap record again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No microphone was found on this device.";
  }
  if (name === "NotReadableError") {
    return "The microphone is in use by another app. Close it and try again.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function AudioRecorder({
  onFinish,
  onActiveChange,
  autoStart = false,
}: {
  onFinish: (file: File, durationSec: number) => void;
  /** True while a recording exists that has not been finished or discarded. */
  onActiveChange?: (active: boolean) => void;
  autoStart?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [error, setError] = useState<string | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const discardOnStop = useRef(false);
  // read at stop time, so a re-rendered parent never sees a stale handler
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  // Elapsed time excludes paused stretches: banked time plus the open segment.
  const banked = useRef(0);
  const segmentStart = useRef<number | null>(null);
  const elapsed = () =>
    banked.current + (segmentStart.current === null ? 0 : performance.now() - segmentStart.current);

  const active = phase === "recording" || phase === "paused";

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  // ---- teardown -------------------------------------------------------------
  const release = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    analyser.current = null;
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, []);

  useEffect(() => {
    return () => {
      // leaving the page mid-recording: stop the mic, keep nothing
      discardOnStop.current = true;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      release();
    };
  }, [release]);

  // ---- screen wake lock -----------------------------------------------------
  // A phone that dims and locks mid-meeting suspends the page, and with it the
  // recording. Held for the whole session, re-taken when the tab comes back
  // (the browser drops it whenever the page is hidden).
  const holdWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLock.current) {
        wakeLock.current = await navigator.wakeLock.request("screen");
        wakeLock.current.addEventListener("release", () => (wakeLock.current = null));
      }
    } catch {
      // not supported, or refused on low battery — recording still works
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void holdWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [active, holdWakeLock]);

  // ---- leave-page guard -----------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  // ---- clock and level meter ------------------------------------------------
  useEffect(() => {
    if (!active) return;
    const buffer = new Uint8Array(512);
    const id = window.setInterval(() => {
      setElapsedMs(elapsed());

      let level = 0;
      if (phase === "recording" && analyser.current) {
        analyser.current.getByteTimeDomainData(buffer);
        let sum = 0;
        for (const v of buffer) sum += ((v - 128) / 128) ** 2;
        // RMS of speech sits around 0.02-0.2; stretch it so talking fills the bar
        level = Math.min(1, Math.sqrt(sum / buffer.length) * 6);
      }
      setLevels((prev) => [...prev.slice(1), level]);
    }, 100);
    return () => window.clearInterval(id);
  }, [active, phase]);

  // ---- controls -------------------------------------------------------------
  const start = useCallback(async () => {
    setError(null);

    const chosen = pickFormat();
    if (!chosen) {
      setError(
        "This browser cannot record audio. Use the latest Chrome, Edge, Firefox or Safari, or upload a file instead.",
      );
      return;
    }
    setPhase("starting");

    try {
      // Echo cancellation is for calls: nothing plays back here, and it eats
      // the far side of a table. Noise suppression earns its keep in a café.
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.current = media;

      const rec = new MediaRecorder(media, {
        mimeType: chosen.mime,
        audioBitsPerSecond: BITS_PER_SECOND,
      });
      chunks.current = [];
      discardOnStop.current = false;

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      rec.onstop = () => {
        const durationSec = elapsed() / 1000;
        banked.current = 0;
        segmentStart.current = null;
        release();
        setPhase("idle");
        setElapsedMs(0);
        setLevels(Array(BARS).fill(0));

        if (discardOnStop.current) {
          chunks.current = [];
          return;
        }

        // The recorder may report its own, more specific type; keep only the
        // base so the storage content type is a plain "audio/webm".
        const type = (rec.mimeType || chosen.mime).split(";")[0];
        const blob = new Blob(chunks.current, { type });
        chunks.current = [];

        if (durationSec < 2 || blob.size === 0) {
          setError("That recording was too short to use. Tap record and try again.");
          return;
        }
        onFinishRef.current(new File([blob], fileName(chosen.ext), { type }), durationSec);
      };

      // A mic that disappears — unplugged, or taken by a phone call — ends the
      // track. Keep what was captured rather than recording silence.
      media.getAudioTracks()[0]?.addEventListener("ended", () => {
        if (rec.state !== "inactive") rec.stop();
      });

      recorder.current = rec;
      // one-second slices, so a stop never waits on a large final flush
      rec.start(1000);
      banked.current = 0;
      segmentStart.current = performance.now();
      setElapsedMs(0);
      setPhase("recording");

      void holdWakeLock();

      // the meter is a nicety; a browser that will not start the context
      // without a fresh tap still records fine
      try {
        const ctx = new AudioContext();
        const node = ctx.createAnalyser();
        node.fftSize = 512;
        ctx.createMediaStreamSource(media).connect(node);
        audioCtx.current = ctx;
        analyser.current = node;
        void ctx.resume().catch(() => {});
      } catch {
        // no meter
      }
    } catch (err) {
      // warn, not error: a refused permission is the user's call, not a fault
      console.warn("[recorder] could not start", err);
      release();
      setPhase("idle");
      setError(describeError(err));
    }
  }, [holdWakeLock, release]);

  function pause() {
    const rec = recorder.current;
    if (!rec || rec.state !== "recording") return;
    rec.pause();
    if (segmentStart.current !== null) {
      banked.current += performance.now() - segmentStart.current;
      segmentStart.current = null;
    }
    setPhase("paused");
  }

  function resume() {
    const rec = recorder.current;
    if (!rec || rec.state !== "paused") return;
    rec.resume();
    segmentStart.current = performance.now();
    setPhase("recording");
  }

  function finish() {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    if (segmentStart.current !== null) {
      banked.current += performance.now() - segmentStart.current;
      segmentStart.current = null;
    }
    rec.stop();
  }

  function discard() {
    if (!window.confirm("Throw this recording away? It has not been saved anywhere.")) return;
    discardOnStop.current = true;
    finish();
  }

  // One tap from the top bar lands here with autoStart, and that tap is the
  // user gesture the browser wants before it will ask for the microphone.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStart && !autoStarted.current) {
      autoStarted.current = true;
      void start();
    }
  }, [autoStart, start]);

  // ---- render ---------------------------------------------------------------
  const consentLine = (
    <p className="mx-auto max-w-sm text-center text-xs text-muted-foreground">
      Ask first: “{CONSENT_SCRIPT}”
    </p>
  );

  if (!active) {
    return (
      <div className="flex flex-col items-center gap-5 rounded-lg border bg-card px-6 py-10 shadow-card">
        <button
          type="button"
          onClick={() => void start()}
          disabled={phase === "starting"}
          aria-label="Start recording"
          className={cn(
            "flex size-24 items-center justify-center rounded-full bg-brand text-on-brand shadow-card transition-transform duration-150",
            "hover:bg-brand-hover active:scale-95 disabled:opacity-60",
            "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring",
          )}
        >
          <Mic className="size-10" aria-hidden />
        </button>
        <div className="text-center">
          <p className="font-medium">
            {phase === "starting" ? "Waiting for the microphone…" : "Tap to record"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pause any time. The audio stays on this device until you process it.
          </p>
        </div>
        {consentLine}
        {error && <p className="text-center text-sm text-danger">{error}</p>}
      </div>
    );
  }

  const paused = phase === "paused";

  return (
    <div className="rounded-lg border bg-card px-6 py-8 shadow-card">
      <div className="flex flex-col items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium",
            paused ? "bg-muted text-muted-foreground" : "bg-danger-soft text-on-danger-soft",
          )}
          aria-live="polite"
        >
          <span
            className={cn(
              "size-2 rounded-full",
              paused ? "bg-muted-foreground" : "animate-pulse bg-danger",
            )}
            aria-hidden
          />
          {paused ? "Paused — not recording" : "Recording"}
        </span>

        <p
          className="font-display text-6xl tabular-nums leading-none"
          aria-label={`Recorded ${formatDuration(elapsedMs / 1000)}`}
        >
          {formatDuration(elapsedMs / 1000)}
        </p>
      </div>

      <div className="mt-6 flex h-16 items-center justify-center gap-[3px]" aria-hidden>
        {levels.map((l, i) => (
          <span
            key={i}
            className={cn(
              "w-1.5 rounded-full transition-[height] duration-100",
              paused ? "bg-border" : "bg-brand",
            )}
            style={{ height: `${Math.max(6, l * 100)}%` }}
          />
        ))}
      </div>

      <div className="mt-8 flex items-center justify-center gap-3">
        <Button variant="ghost" size="icon" onClick={discard} aria-label="Discard recording">
          <Trash2 className="size-4" />
        </Button>

        <Button variant="outline" size="lg" onClick={paused ? resume : pause} className="min-w-32">
          {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          {paused ? "Resume" : "Pause"}
        </Button>

        <Button
          size="lg"
          onClick={finish}
          className="min-w-32 bg-brand text-on-brand hover:bg-brand-hover"
        >
          <Square className="size-4 fill-current" />
          Finish
        </Button>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Keep this tab open and the screen on until you press Finish.
      </p>
    </div>
  );
}
