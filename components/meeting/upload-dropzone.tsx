"use client";

import { useCallback, useRef, useState } from "react";
import { FileAudio, Trash2, UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/talkRatio";
import {
  ACCEPTED_AUDIO_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MB,
  OPENAI_AUDIO_LIMIT_BYTES,
} from "@/lib/constants";

export interface PickedFile {
  file: File;
  durationSec: number | null;
}

function extensionAllowed(name: string) {
  return ACCEPTED_AUDIO_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

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

  const accept = useCallback(
    async (file: File) => {
      setError(null);

      if (!extensionAllowed(file.name)) {
        setError(
          `That looks like ${file.name.split(".").pop() ?? "an unknown type"}. Use ${ACCEPTED_AUDIO_EXTENSIONS.join(", ")}.`,
        );
        return;
      }

      if (file.size > MAX_UPLOAD_BYTES) {
        setError(
          `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB and the limit is ${MAX_UPLOAD_MB}MB. Exporting it as mono MP3 at 48-64 kbps usually shrinks it by 5-10x.`,
        );
        return;
      }

      onChange({ file, durationSec: await readDuration(file) });
    },
    [onChange],
  );

  if (value) {
    const mb = value.file.size / 1024 / 1024;
    // Over 25MB is no longer a rejection — it just means the server will split
    // the audio before transcribing. Say so, so the wait is not a surprise.
    const willSplit = value.file.size > OPENAI_AUDIO_LIMIT_BYTES;

    return (
      <div className="rounded-lg border bg-card p-5 shadow-card">
        <div className="flex items-start gap-4">
          <div className="rounded-md bg-success-soft p-3">
            <FileAudio className="size-5 text-on-success-soft" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{value.file.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {mb.toFixed(1)} MB
              {value.durationSec ? ` · ${formatDuration(value.durationSec)}` : ""}
            </p>
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
        <p className="mt-1 text-sm text-muted-foreground">
          or click to choose a file
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          {ACCEPTED_AUDIO_EXTENSIONS.join(", ")} · up to {MAX_UPLOAD_MB}MB
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
