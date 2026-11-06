"use client";

import { useEffect, useRef } from "react";

/**
 * Marks its element `data-in` the first time it scrolls into view, so CSS
 * can play an entrance (the benchmark bars growing, the promises rising).
 *
 * Only content that starts below the screen is held back (`data-armed`).
 * Whatever is already on screen, or above it, when this runs stays as it is,
 * so nothing that has been seen vanishes at hydration, and without
 * JavaScript, or before hydration, everything is simply visible.
 *
 * Any part of the element coming into view counts (no threshold), so a block
 * taller than the screen, as at 400% zoom, still arrives. Paper cannot
 * scroll: the CSS prints held-back content as if it had arrived.
 */
export function Reveal({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "figure" | "dl" | "ol" | "ul";
  className?: string;
  children: React.ReactNode;
} & React.AriaAttributes) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window) || el.getBoundingClientRect().top < window.innerHeight) {
      el.dataset.in = "";
      return;
    }
    el.dataset.armed = "";
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.dataset.in = "";
          io.disconnect();
        }
      },
      // a little way into the screen, so the entrance is seen, not missed at the edge
      { threshold: 0, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    // one ref for whichever tag renders; TS cannot match a ref to a union of tags
    <Tag ref={ref as React.RefObject<never>} className={className} {...rest}>
      {children}
    </Tag>
  );
}
