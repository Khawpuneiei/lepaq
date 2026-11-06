"use client";

import { useEffect } from "react";

type RouterState = { __NA?: boolean } | null;

/**
 * Keeps Back working after the page's #links.
 *
 * A plain #link (the rail, the header's "How it works", the scroll cue, the
 * skip links) adds a history entry whose state is null, and Next 16's router
 * ignores Back to an entry like that (app-router.js, onPopState: "if
 * (!event.state) return"). So after a rail link and then Open Lepaq, Back
 * changed the address to /#chapter-approved and left the sign-in page on
 * screen; it took a second Back to see this page again.
 *
 * Each new #entry gets the router's state of the page it came from. Next's own
 * replaceState passes a state carrying __NA through untouched, and no URL is
 * given, so the address stays as the link left it.
 *
 * It also lands Back on the #chapter when the page has to be drawn again
 * after a reload elsewhere (below).
 */
export function FragmentHistory() {
  useEffect(() => {
    const read = () => window.history.state as RouterState;
    let saved: RouterState = null;
    // the entry a link leaves: a click runs before the link navigates
    const remember = () => {
      const state = read();
      if (state?.__NA) saved = state;
    };

    const onHashChange = () => {
      if (read() === null && saved) {
        window.history.replaceState(saved, "");
      } else {
        remember();
      }
    };

    remember();
    document.addEventListener("click", remember, true);
    window.addEventListener("hashchange", onHashChange);

    // Back to a #chapter after the next page was reloaded: Next has to fetch
    // this page again and draws it after the browser has already restored the
    // scroll (against the shorter page), so it opened at the top. The address
    // still names the chapter, so go there. Only when the router drew this
    // page into a document loaded elsewhere: a load of this page itself keeps
    // its own scroll, whether a fresh load that went to the #chapter or a
    // reload at the top (F5, or pulling down on a phone) [REV-26]. A plain
    // Back has scrolled by now, and this does nothing.
    const loaded = performance.getEntriesByType("navigation")[0];
    const loadedHere = !loaded || new URL(loaded.name).pathname === location.pathname;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (loadedHere || window.scrollY !== 0 || location.hash.length < 2) return;
        let id = location.hash.slice(1);
        try {
          id = decodeURIComponent(id);
        } catch {
          // a malformed escape: look the fragment up as typed
        }
        document.getElementById(id)?.scrollIntoView();
      });
    });

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("click", remember, true);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  return null;
}
