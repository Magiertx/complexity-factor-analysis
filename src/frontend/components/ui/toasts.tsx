"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle2, Info, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Tip, tipTookEscape } from "./tip";

/** At most this many notices are on screen, and the undo of a change above them; older ones fold into "+n more · History". */
export const MAX_TOASTS = 2;
const SHOW_MS = 10_000;

export interface ToastInput {
  /** Notices with the same key are one notice with a count, e.g. the same error twice. */
  key: string;
  message: string;
  tone?: "success" | "info" | "error";
  /** A link to where the notice is about, e.g. "Open". */
  action?: { label: string; href: string };
}

interface Toast extends ToastInput {
  /** Changes with every repeat, so the timer starts again. */
  id: number;
  count: number;
}

interface ToastContextValue {
  notify: (toast: ToastInput) => void;
  /** The place of a notice that brings its own controls, such as the undo of a reset. */
  slot: HTMLElement | null;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToasts must be used inside <ToastProvider>");
  return ctx;
}

/**
 * The one place for floating notices, at the bottom of the window: the newest on top, at most
 * MAX_TOASTS (two) and the undo slot, the same notice once with a count, and the older ones folded
 * into a line that leads to the History. Each closes after ten seconds, but not while the pointer
 * or the focus is on it.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const counter = useRef(0);

  const notify = useCallback((input: ToastInput) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((list) => {
      const same = list.find((x) => x.key === input.key);
      const rest = list.filter((x) => x.key !== input.key);
      return [{ ...input, id, count: (same?.count ?? 0) + 1 }, ...rest];
    });
  }, []);
  const close = useCallback((key: string) => setToasts((list) => list.filter((x) => x.key !== key)), []);

  const value = useMemo(() => ({ notify, slot }), [notify, slot]);
  const shown = toasts.slice(0, MAX_TOASTS);
  const folded = toasts.length - shown.length;
  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Always rendered, so screen readers announce each notice that appears in it. */}
      <div
        role="status"
        aria-live="polite"
        className="toast-region fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none print:hidden"
      >
        <div ref={setSlot} className="contents" />
        {shown.map((toast) => (
          <ToastItem key={toast.key} toast={toast} onClose={() => close(toast.key)} />
        ))}
        {folded > 0 && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface px-3 py-1 text-xs text-muted shadow ring-1 ring-border/70">
            <span>{t("toasts.more", { n: folded })}</span>
            <span aria-hidden>·</span>
            <Link href="/runs" className="font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">
              {t("mode_bar.history_label")}
            </Link>
            <button
              type="button"
              onClick={() => setToasts((list) => list.slice(0, MAX_TOASTS))}
              className="rounded hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {t("toasts.dismiss_more")}
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

const TONE_ICON = {
  success: <CheckCircle2 className="h-4 w-4 shrink-0 text-success-ink" aria-hidden />,
  info: <Info className="h-4 w-4 shrink-0 text-muted" aria-hidden />,
  error: <AlertCircle className="h-4 w-4 shrink-0 text-danger-ink" aria-hidden />,
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const t = useT();
  const [held, setHeld] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(() => closeRef.current(), SHOW_MS);
    return () => clearTimeout(timer);
  }, [toast.id, held]);
  return (
    <div
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !tipTookEscape(e)) onClose();
      }}
      className={cn(
        "pointer-events-auto flex items-center gap-2 rounded-lg bg-surface pl-3.5 pr-1.5 py-1.5 text-sm shadow-lg ring-1 ring-border/70 max-w-full",
      )}
    >
      {TONE_ICON[toast.tone ?? "info"]}
      <span className="min-w-0 break-words">{toast.message}</span>
      {toast.count > 1 && (
        <span className="shrink-0 rounded bg-tile px-1.5 text-xs font-medium tabular-nums text-muted">
          {t("toasts.count", { n: toast.count })}
        </span>
      )}
      {toast.action && (
        <Link
          href={toast.action.href}
          onClick={onClose}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-3 text-sm font-medium text-accent-ink hover:bg-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {toast.action.label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
      <Tip name={t("common.close")} keyCap="Esc">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="h-7 w-7 grid place-items-center rounded-md text-muted hover:text-fg hover:bg-tile transition shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </Tip>
    </div>
  );
}

/** Renders a notice with controls of its own (the undo of a reset) in the one place for notices. */
export function ToastSlot({ children }: { children: React.ReactNode }) {
  const { slot } = useToasts();
  return slot ? createPortal(children, slot) : null;
}
