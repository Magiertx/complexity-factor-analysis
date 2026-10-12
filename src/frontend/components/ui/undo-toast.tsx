"use client";

import { useEffect, useRef, useState } from "react";
import { Undo2, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { Button } from "./button";

const SHOW_MS = 10_000;

export interface UndoNotice {
  /** Changes with every notice, so a second one restarts the timer. */
  id: number;
  message: string;
}

/**
 * A floating notice at the bottom of the page with a one-step "Undo". It closes after ten
 * seconds, but not while the pointer or the focus is on it, so there is time to reach it by
 * keyboard. The live region is always there, so screen readers announce each notice.
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
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pointer-events-none"
    >
      {notice && (
        <div
          key={notice.id}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface pl-3.5 pr-1.5 py-1.5 text-sm shadow-lg ring-1 ring-border/70 max-w-full"
        >
          <span className="min-w-0">{notice.message}</span>
          <Button variant="ghost" size="sm" onClick={onUndo} className="shrink-0 text-accent-ink">
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            {t("common.undo")}
          </Button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-tile transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
