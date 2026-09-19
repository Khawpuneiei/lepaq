import { Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  SENTIMENT_CLASS,
  SENTIMENT_DOT,
  SENTIMENT_LABEL,
} from "@/lib/constants";
import type { Confidence, Sentiment } from "@/lib/types";

/** A user-defined status, rendered in the colour they picked in Settings. */
export function StatusChip({
  label,
  color,
  className,
}: {
  label: string | null | undefined;
  color?: string | null;
  className?: string;
}) {
  if (!label) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        No status
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        className,
      )}
      style={
        color
          ? { borderColor: `${color}66`, backgroundColor: `${color}1a`, color }
          : undefined
      }
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color ?? "currentColor" }}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function SentimentChip({
  sentiment,
  className,
}: {
  sentiment: Sentiment | null | undefined;
  className?: string;
}) {
  if (!sentiment) return null;
  return (
    <Badge
      variant="outline"
      className={cn(SENTIMENT_CLASS[sentiment], "font-medium", className)}
    >
      {SENTIMENT_LABEL[sentiment]}
    </Badge>
  );
}

export function SentimentDot({
  sentiment,
  className,
}: {
  sentiment: Sentiment | null | undefined;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        sentiment ? SENTIMENT_DOT[sentiment] : "bg-border",
        className,
      )}
      aria-label={sentiment ? SENTIMENT_LABEL[sentiment] : "No reading"}
    />
  );
}

/**
 * Low confidence gets the butter yellow, because "look at this one" is
 * exactly what the accent colour is reserved for (spec 8.2 rule 3).
 */
export function ConfidenceChip({ confidence }: { confidence: Confidence | null }) {
  if (!confidence) return null;
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-medium",
        confidence === "low"
          ? "bg-butter text-on-butter"
          : "bg-muted text-muted-foreground",
      )}
    >
      {confidence} confidence
    </span>
  );
}

export function EngagementDots({ value }: { value: number | null }) {
  const n = value ?? 0;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`Engagement ${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "size-1.5 rounded-full",
            i <= n ? "bg-success" : "bg-border",
          )}
          aria-hidden
        />
      ))}
    </span>
  );
}

/** Anything the user has not approved says so, everywhere (spec 3.2). */
export function DraftBadge({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("border-butter-strong bg-butter text-on-butter", className)}
    >
      Draft
    </Badge>
  );
}

export function PrivateBadge({ shared }: { shared: boolean }) {
  return shared ? (
    <Badge variant="outline" className="border-info/40 bg-info-soft text-on-info-soft">
      Shared
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Lock className="size-3" aria-hidden />
      Private
    </Badge>
  );
}
