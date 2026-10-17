"use client";

import { useCallback, useRef, useState } from "react";
import { Download, FileAudio, Loader2, Mic, Trash2, UploadCloud, Wand2 } from "lucide-react";

import { AudioRecorder } from "@/components/meeting/audio-recorder";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/talkRatio";
import {
  MAX_SOURCE_BYTES,
  compressAudio,
  estimateCompressedBytes,
  type CompressProgress,
} from "@/lib/audio/compress-client";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  OPENAI_AUDIO_LIMIT_BYTES,
} from "@/lib/constants";

export interface PickedFile {
  file: File;
  durationSec: number | null;
  originalBytes: number;
  compressed: boolean;
  /** Captured in this tab rather than picked from disk. */
  recorded?: boolean;
}

export type SourceMode = "record" | "upload";

/**
 * A recording at or under this rate is already as small as the compressor
 * would make it — the recorder asks for 48kbps Opus — so re-encoding would
 * spend a 32MB download and a minute of CPU to gain nothing. Safari records
 * AAC at a higher rate, which lands above this and still gets compressed.
 */
const ALREADY_COMPACT_BYTES_PER_SECOND = 7_000;

function extensionAllowed(name: string) {
  return ACCEPTED_AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** Read duration in the browser so the user sees it before committing. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      done(Number.isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

export function UploadDropzone({
  value,
  onChange,
  defaultMode = "upload",
  autoStartRecording = false,
}: {
  value: PickedFile | null;
  onChange: (value: PickedFile | null) => void;
  defaultMode?: SourceMode;
  /** Start recording on mount — the one-tap entry from the top bar. */
  autoStartRecording?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<SourceMode>(defaultMode);
  const [recording, setRecording] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<CompressProgress | null>(null);

  const accept = useCallback(
    async (file: File, recordedSec?: number) => {
      setError(null);
      const recorded = recordedSec !== undefined;

      if (!extensionAllowed(file.name)) {
        setError(
          `That looks like ${file.name.split(".").pop() ?? "an unknown type"}. Use ${ACCEPTED_AUDIO_EXTENSIONS.join(", ")}.`,
        );
        return;
      }

      if (file.size > MAX_SOURCE_BYTES) {
        setError(
          `That file is ${mb(file.size)}, which is too big to process in the browser. Export it as mono MP3 first.`,
        );
        return;
      }

      // A browser recording's header has no duration (Chrome writes WebM as a
      // stream), so trust the recorder's own clock over the metadata.
      const durationSec = recorded ? recordedSec : await readDuration(file);

      // Shrink before upload rather than rejecting. An hour and a half off a
      // phone is ~130MB, well past the storage limit; the same audio as mono
      // 48kbps MP3 is ~32MB and transcribes just as well.
      let result;
      if (recorded && file.size / Math.max(1, recordedSec) <= ALREADY_COMPACT_BYTES_PER_SECOND) {
        result = { file, originalBytes: file.size, skipped: true, reason: "already compact" };
      } else {
        try {
          setWorking({ stage: "loading" });
          result = await compressAudio(file, { onProgress: setWorking });
        } finally {
          setWorking(null);
        }
      }

      if (result.file.size > MAX_UPLOAD_BYTES) {
        setError(
          result.skipped
            ? `That file is ${mb(result.file.size)} and the limit is ${MAX_UPLOAD_MB} MB. Compression was unavailable (${result.reason}), so export it as mono MP3 at 48 kbps and try again.`
            : `Even compressed that is ${mb(result.file.size)}, over the ${MAX_UPLOAD_MB} MB limit. Try splitting the recording in two.`,
        );
        return;
      }

      onChange({
        file: result.file,
        durationSec,
        originalBytes: result.originalBytes,
        compressed: !result.skipped,
        recorded,
      });
    },
    [onChange],
  );

  // ---- working ------------------------------------------------------------
  if (working) {
    return (
      <div className="rounded-lg border bg-card p-6 shadow-card">
        <div className="flex items-center gap-3">
          <Loader2 className="size-5 shrink-0 animate-spin text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {working.stage === "loading"
                ? "Getting the compressor ready"
                : "Shrinking the recording"}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {working.stage === "loading"
                ? "One-off 32 MB download, cached after this."
                : "Runs on your machine — the audio has not left your browser yet."}
            </p>
          </div>
          {working.stage === "encoding" && working.ratio !== undefined && (
            <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
              {Math.round(working.ratio * 100)}%
            </span>
          )}
        </div>
        {working.stage === "encoding" && (
          <Progress value={(working.ratio ?? 0) * 100} className="mt-4" />
        )}
      </div>
    );
  }

  // ---- chosen -------------------------------------------------------------
  if (value) {
    const willSplit = value.file.size > OPENAI_AUDIO_LIMIT_BYTES;
    const saved = value.originalBytes - value.file.size;

    return (
      <div className="rounded-lg border bg-card p-5 shadow-card">
        <div className="flex items-start gap-4">
          <div className="rounded-md bg-success-soft p-3">
            {value.recorded ? (
              <Mic className="size-5 text-on-success-soft" aria-hidden />
            ) : (
              <FileAudio className="size-5 text-on-success-soft" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{value.file.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {mb(value.file.size)}
              {value.durationSec ? ` · ${formatDuration(value.durationSec)}` : ""}
            </p>

            {value.compressed && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-on-success-soft">
                <Wand2 className="size-3.5 shrink-0" aria-hidden />
                Compressed here in your browser — {mb(value.originalBytes)} down to{" "}
                {mb(value.file.size)}, {Math.round((saved / value.originalBytes) * 100)}%
                smaller.
              </p>
            )}

            {value.recorded && (
              <p className="mt-2 text-xs text-muted-foreground">
                Recorded here. It only exists in this tab until you process it —{" "}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
                  onClick={() => {
                    const url = URL.createObjectURL(value.file);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = value.file.name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  }}
                >
                  <Download className="size-3" aria-hidden />
                  save a copy
                </button>
                .
              </p>
            )}

            {willSplit && (
              <p className="mt-2 text-xs text-on-butter">
                Long recording — it will be split into parts and transcribed in
                parallel. Expect a few minutes.
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={value.recorded ? "Discard recording" : "Remove file"}
            onClick={() => {
              if (
                value.recorded &&
                !window.confirm("Throw this recording away? It has not been saved anywhere.")
              ) {
                return;
              }
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  // ---- empty --------------------------------------------------------------
  const modes: { key: SourceMode; label: string; icon: typeof Mic }[] = [
    { key: "record", label: "Record now", icon: Mic },
    { key: "upload", label: "Upload a file", icon: UploadCloud },
  ];

  return (
    <div>
      <div
        role="radiogroup"
        aria-label="How to add the recording"
        className="mb-4 inline-flex rounded-lg border bg-muted p-1"
      >
        {modes.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={mode === key}
            disabled={recording}
            onClick={() => setMode(key)}
            className={cn(
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50",
              mode === key
                ? "bg-card font-medium text-foreground shadow-card"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {mode === "record" ? (
        <AudioRecorder
          autoStart={autoStartRecording}
          onActiveChange={setRecording}
          onFinish={(file, seconds) => void accept(file, seconds)}
        />
      ) : (
        <>
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void accept(file);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-14 text-center transition-colors duration-150",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              dragging ? "border-primary bg-primary/5" : "hover:border-primary/50",
            )}
          >
            <div className="mb-4 rounded-full bg-muted p-3">
              <UploadCloud className="size-6 text-muted-foreground" aria-hidden />
            </div>
            <p className="font-medium">Drop the recording here</p>
            <p className="mt-1 text-sm text-muted-foreground">or click to choose a file</p>
            <p className="mt-4 text-xs text-muted-foreground">
              {ACCEPTED_AUDIO_EXTENSIONS.join(", ")} · long recordings are compressed
              here in your browser before they are uploaded
            </p>
          </div>

          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept={ACCEPTED_AUDIO_EXTENSIONS.join(",")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void accept(file);
            }}
          />
        </>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}

export { estimateCompressedBytes };
