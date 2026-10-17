import { cn } from "@/lib/utils";

/**
 * The Lepaq mark from the pitch deck: a cup whose steam is a sound wave.
 *
 * Redrawn as SVG from the deck's artwork rather than shipped as its PNG, so
 * the cup can take the surrounding text colour. The deck draws it in ink,
 * which vanishes on the dark sidebar; the steam stays brand orange either way.
 */
export function LepaqMark({ className }: { className?: string }) {
  return (
    <svg viewBox="112 82 522 502" className={className} aria-hidden focusable="false">
      <g className="fill-brand">
        <rect x="174" y="142" width="36" height="84" rx="18" />
        <rect x="238" y="110" width="36" height="148" rx="18" />
        <rect x="302" y="82" width="36" height="204" rx="18" />
        <rect x="366" y="118" width="36" height="132" rx="18" />
        <rect x="430" y="138" width="36" height="92" rx="18" />
      </g>
      <g fill="currentColor">
        <path d="M112 312H528V444A140 140 0 0 1 388 584H252A140 140 0 0 1 112 444Z" />
        <path d="M528 342H552A82 82 0 0 1 552 506H528V470H552A46 46 0 0 0 552 378H528Z" />
      </g>
    </svg>
  );
}

/** Mark plus the lowercase wordmark, as on the deck's title slide. Sized by font-size. */
export function LepaqLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-[0.35em] leading-none", className)}>
      <LepaqMark className="h-[1.05em] w-auto shrink-0" />
      <span className="font-bold tracking-tight">lepaq</span>
    </span>
  );
}
