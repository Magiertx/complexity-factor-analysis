"use client";

import { useEffect, useRef, useState } from "react";
import { Undo2, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Button } from "./button";
import { Tip } from "./tip";
import { ToastSlot } from "./toasts";

const SHOW_MS = 10_000;

export interface UndoNotice {
  /** Changes with every notice, so a second one restarts the timer. */
  id: number;
  message: string;
  /** Where the focus goes when the notice closes with the focus in it, e.g. the button that caused it. */
  returnFocus?: HTMLElement | null;
}

/**
 * A floating notice with a one-step "Undo", in the one place for notices at the bottom of the
 * window (ToastProvider), whose live region screen readers announce it from. It closes after ten
 * seconds, but not while the pointer or the focus is on it, so there is time to reach it by
 * keyboard. A new notice replaces the one before.
 */
export function UndoToast({
  notice,
  onUndo,
  onClose,
}: {
  notice: UndoNotice | null;
  onUndo: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [held, setHeld] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // The notice goes away with the button that was pressed in it; the focus goes back to where
  // the change came from instead of to the page.
  const leave = (action: () => void) => {
    const hadFocus = !!boxRef.current?.contains(document.activeElement);
    const target = notice?.returnFocus;
    action();
    setHeld(false);
    if (hadFocus && target?.isConnected) target.focus();
  };
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!notice || held) return;
    const timer = setTimeout(() => closeRef.current(), SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice, held]);

  return (
    <ToastSlot>
      {notice && (
        <div
          key={notice.id}
          ref={boxRef}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") leave(onClose);
          }}
          className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface pl-3.5 pr-1.5 py-1.5 text-sm shadow-lg ring-1 ring-border/70 max-w-full"
        >
          <span className="min-w-0">{notice.message}</span>
          <Button variant="ghost" size="sm" onClick={() => leave(onUndo)} className="shrink-0 text-accent-ink">
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            {t("common.undo")}
          </Button>
          <Tip name={t("common.close")} keyCap="Esc">
            <button
              type="button"
              onClick={() => leave(onClose)}
              aria-label={t("common.close")}
              className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-tile transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </Tip>
        </div>
      )}
    </ToastSlot>
  );
}
