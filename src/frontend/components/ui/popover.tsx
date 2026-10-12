"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * A small non-modal dialog under a trigger, in a portal so that a scrolling container cannot
 * cut it off. It takes the focus when it opens; Escape, the close button and a click outside
 * close it, and the first two hand the focus back to the trigger.
 */
export function Popover({
  open,
  onClose,
  anchor,
  title,
  titleId,
  id,
  width = 360,
  children,
}: {
  open: boolean;
  /** `refocus`: give the focus back to the trigger. */
  onClose: (refocus: boolean) => void;
  anchor: React.RefObject<HTMLElement | null>;
  title: string;
  titleId: string;
  id: string;
  width?: number;
  children: React.ReactNode;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const place = useCallback(() => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(width, window.innerWidth - 16);
    setPos({ left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), top: r.bottom + 6, width: w });
  }, [anchor, width]);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  const shown = open && pos !== null;
  useEffect(() => {
    if (!shown) return;
    panelRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!panelRef.current?.contains(target) && !anchor.current?.contains(target)) closeRef.current(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [shown, place, anchor]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose(true);
        }
      }}
      style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width }}
      className="z-50 rounded-lg bg-surface p-3.5 text-xs shadow-xl ring-1 ring-border/70 space-y-2.5 focus:outline-none"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 id={titleId} className="text-sm font-semibold">
          {title}
        </h3>
        <button
          type="button"
          onClick={() => onClose(true)}
          aria-label={t("common.close")}
          className="-mt-1 -mr-1 h-6 w-6 grid place-items-center rounded text-muted hover:text-fg hover:bg-tile shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
