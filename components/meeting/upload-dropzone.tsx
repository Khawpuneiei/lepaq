"use client";

import { useCallback, useRef, useState } from "react";
import { FileAudio, Loader2, Trash2, UploadCloud, Wand2 } from "lucide-react";

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
}

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
}: {
  value: PickedFile | null;
  onChange: (value: PickedFile | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<CompressProgress | null>(null);

  const accept = useCallback(
    async (file: File) => {
      setError(null);

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

      const durationSec = await readDuration(file);

      // Shrink before upload rather than rejecting. An hour and a half off a
      // phone is ~130MB, well past the storage limit; the same audio as mono
      // 48kbps MP3 is ~32MB and transcribes just as well.
      let result;
      try {
        setWorking({ stage: "loading" });
        result = await compressAudio(file, { onProgress: setWorking });
      } finally {
        setWorking(null);
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
            <FileAudio className="size-5 text-on-success-soft" aria-hidden />
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
            aria-label="Remove file"
            onClick={() => {
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
  return (
    <div>
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

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </div>
  );
}

export { estimateCompressedBytes };
