"use client";

import { useEffect, useRef } from "react";

/**
 * Marks its element `data-in` the first time it scrolls into view, so CSS
 * can play an entrance (the benchmark bars growing, the promises rising).
 *
 * The hidden starting state only applies once this has run (`data-armed`),
 * so without JavaScript, or before hydration, everything is simply visible.
 */
export function Reveal({
  as: Tag = "div",
  className,
  children,
  threshold = 0.2,
  ...rest
}: {
  as?: "div" | "section" | "figure" | "dl" | "ol" | "ul";
  className?: string;
  children: React.ReactNode;
  threshold?: number;
} & React.AriaAttributes) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
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
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return (
    // one ref for whichever tag renders; TS cannot match a ref to a union of tags
    <Tag ref={ref as React.RefObject<never>} className={className} {...rest}>
      {children}
    </Tag>
  );
}
