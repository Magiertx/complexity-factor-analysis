"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { tipTookEscape } from "./tip";

/** What Tab reaches inside the sheet. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A panel at the right edge of the window that holds something to read next to the page, such as
 * the fact sheet of a measure: a modal dialog while it is open. It takes the focus, keeps Tab
 * inside, holds the page behind it still, closes with Escape or a click beside it, and hands the
 * focus back to where it came from.
 *
 * `labelledBy` is the id of its heading. `returnFocus` finds the element to focus when it closes
 * where the one it was opened from is gone, e.g. a row that was rendered anew.
 */
export function Sheet({
  open,
  labelledBy,
  onClose,
  onKeyDown,
  from,
  returnFocus,
  className,
  children,
}: {
  open: boolean;
  labelledBy: string;
  onClose: () => void;
  /** Keys the sheet's content answers to, e.g. the arrows that page through its measures. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  /** The element the sheet was opened from. */
  from?: HTMLElement | null;
  returnFocus?: () => HTMLElement | null;
  className?: string;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  const fromRef = useRef(from);
  const returnRef = useRef(returnFocus);
  const closeRef = useRef(onClose);
  useEffect(() => {
    fromRef.current = from;
    returnRef.current = returnFocus;
    closeRef.current = onClose;
  }, [from, returnFocus, onClose]);

  useEffect(() => {
    if (!open) return;
    const el = panel.current;
    if (!el) return;
    const previous = fromRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    // The first thing to read or do; the panel itself when it has no control.
    (el.querySelector<HTMLElement>("[data-autofocus]") ?? el).focus({ preventScroll: true });
    const frame = requestAnimationFrame(() => setEntered(true));

    const trap = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // A tooltip that was up closes first.
        if (tipTookEscape(e)) return;
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const elements = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (x) => x.getClientRects().length > 0,
      );
      if (elements.length === 0) {
        e.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const inside = el.contains(document.activeElement) && document.activeElement !== el;
      if (e.shiftKey ? !inside || document.activeElement === first : !inside || document.activeElement === last) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", trap);

    // The padding takes the place of the scrollbar, so the page does not shift sideways.
    const body = document.body.style;
    const locked = { overflow: body.overflow, paddingRight: body.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.overflow = "hidden";
    if (scrollbar > 0) body.paddingRight = `${scrollbar}px`;

    return () => {
      cancelAnimationFrame(frame);
      setEntered(false);
      document.removeEventListener("keydown", trap);
      body.overflow = locked.overflow;
      body.paddingRight = locked.paddingRight;
      const target = previous?.isConnected ? previous : (returnRef.current?.() ?? null);
      target?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-[27rem] max-w-[94vw] flex-col bg-surface shadow-2xl ring-1 ring-border/70 outline-none",
          "transition-transform duration-150 ease-out motion-reduce:transition-none",
          entered ? "translate-x-0" : "translate-x-6 opacity-0",
          entered && "opacity-100",
          className,
        )}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
