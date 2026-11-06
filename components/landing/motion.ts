/**
 * The landing page's one motion trick: lift a copy of an element and carry it
 * along an arc into another element, cross-fading from the first one's type
 * to the second one's on the way. It is how the spoken line turns into a
 * transcript line, and how its words turn into a follow-up.
 *
 * Copies are pinned inside a host (the story's sticky stage) rather than the
 * page, so they stay with the stage while the page scrolls under them.
 */

export function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** What a copy needs to look like the original once it leaves its parent. */
const COPIED = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "text-transform",
  "color",
  "background-color",
  "background-image",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "text-decoration-line",
  "text-decoration-style",
  "text-decoration-color",
  "text-decoration-thickness",
  "text-underline-offset",
];

export interface Ghost {
  node: HTMLElement;
  rect: DOMRect;
}

/** True when `el` is laid out, so there is a box to fly from or to. */
export function hasBox(el: Element | null): el is HTMLElement {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** A free-floating copy of `el`, pinned inside `host` exactly where `el` is now. */
export function lift(el: HTMLElement, host: HTMLElement): Ghost {
  const rect = el.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const node = el.cloneNode(true) as HTMLElement;
  node.removeAttribute("class");
  node.removeAttribute("data-k");
  node.removeAttribute("data-hold");
  node.setAttribute("aria-hidden", "true");
  for (const p of COPIED) node.style.setProperty(p, cs.getPropertyValue(p));
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  Object.assign(node.style, {
    position: "absolute",
    left: `${rect.left - h.left}px`,
    top: `${rect.top - h.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    lineHeight: `${Math.max(rect.height - padY, 1)}px`,
    margin: "0",
    display: "block",
    boxSizing: "border-box",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    transformOrigin: "0 0",
    zIndex: "30",
  });
  host.appendChild(node);
  return { node, rect };
}

interface FlyOptions {
  delay?: number;
  duration?: number;
  /** How far the arc bows upward, in px. Defaults to a curve that grows with distance. */
  arc?: number;
}

/**
 * Carry `a` (a copy of the source) into `b` (a copy of the destination).
 * Both copies travel the same path; `a` fades out as `b` fades in, so the
 * type changes mid-flight. Returns the animations, so a caller can wait on
 * them or finish them early.
 */
export function fly(a: Ghost, b: Ghost, { delay = 0, duration = 860, arc }: FlyOptions = {}): Animation[] {
  const s = a.rect;
  const d = b.rect;
  const dx = d.left - s.left;
  const dy = d.top - s.top;
  const k = d.height / s.height;
  const up = arc ?? Math.min(110, 30 + Math.hypot(dx, dy) * 0.14);
  const cx = dx / 2;
  const cy = dy / 2 - up;

  const steps = 16;
  const fa: Keyframe[] = [];
  const fb: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = 2 * (1 - t) * t * cx + t * t * dx;
    const y = 2 * (1 - t) * t * cy + t * t * dy;
    const sc = 1 + (k - 1) * t;
    const fade = t < 0.3 ? 1 : t > 0.62 ? 0 : 1 - (t - 0.3) / 0.32;
    fa.push({ offset: t, transform: `translate(${x}px, ${y}px) scale(${sc})`, opacity: fade });
    fb.push({
      offset: t,
      transform: `translate(${x - dx}px, ${y - dy}px) scale(${sc / k})`,
      opacity: 1 - fade,
    });
  }

  const timing: KeyframeAnimationOptions = {
    duration,
    delay,
    easing: "cubic-bezier(0.32, 0.72, 0.24, 1)",
    fill: "both",
  };
  return [a.node.animate(fa, timing), b.node.animate(fb, timing)];
}
