// The `useScrollFade` hook for containers that scroll sideways.

import { useEffect, type RefObject } from "react";

/**
 * Keeps --fade-start and --fade-end on a container that scrolls sideways at 2rem where more content
 * lies beyond that edge and at 0 where it does not. The `scroll-fade` class (globals.css) turns them
 * into a mask, so a cut-off line fades out instead of ending in half a letter. Without script the
 * variables stay unset and nothing is masked.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      el.style.setProperty("--fade-start", start ? "2rem" : "0px");
      el.style.setProperty("--fade-end", end ? "2rem" : "0px");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    for (const child of Array.from(el.children)) observer?.observe(child);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [ref]);
}
