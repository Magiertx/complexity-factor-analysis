"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Download, Signpost } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

const STORAGE_KEY = "app.start-here-open";

/**
 * Analyses to open in one click, as links of the kind "Copy link" makes. Scenarios that need
 * features still to come stay in the list, hidden, so they are switched on in one place.
 */
const SCENARIOS: { id: string; href: string; available: boolean }[] = [
  { id: "if_inductive", href: "/?bundled=comfy-paper-inductive-miner&preset=published", available: true },
  { id: "log_standard", href: "/log?bundled=comfy-log-pdc-training-logs&preset=standard", available: true },
  { id: "if_four_miners", href: "", available: false },
  { id: "if_k4_k6", href: "", available: false },
  { id: "log_paper", href: "", available: false },
];

/** A small synthetic table in the format of an own CSV upload. */
const EXAMPLE_CSV = "/examples/example-measures.csv";

/**
 * "Start here": the shortest ways into the tool for someone with little time, such as a
 * reviewer. Collapsible, and it stays as it was left. `request` (from the toolbar) opens it and
 * gives it the focus; `onRequestHandled` says that it did.
 */
export function StartHere({ request, onRequestHandled }: { request?: number; onRequestHandled?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "0") setOpen(false);
    } catch {
      /* storage blocked */
    }
  }, []);

  const remember = useCallback((next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked */
    }
  }, []);
  const toggle = () => remember(!open);

  useEffect(() => {
    if (!request) return;
    remember(true);
    const button = toggleRef.current;
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest" });
    onRequestHandled?.();
  }, [request, onRequestHandled, remember]);

  return (
    <section aria-labelledby={`${panelId}-title`} className="rounded-lg bg-tile/50">
      <h3 id={`${panelId}-title`}>
        <button
          ref={toggleRef}
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left transition hover:bg-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Signpost className="h-4 w-4 text-accent-ink shrink-0" aria-hidden />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold">{t("factor.start.title")}</span>
            {!open && <span className="block text-xs text-muted">{t("factor.start.collapsed_hint")}</span>}
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="px-3.5 pb-3.5 space-y-2.5">
        <p className="text-xs text-muted max-w-prose">{t("factor.start.intro")}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {SCENARIOS.filter((s) => s.available).map((s) => (
            <li key={s.id}>
              <Link
                href={s.href}
                className="group h-full flex items-start gap-2.5 rounded-md bg-surface px-3 py-2.5 transition hover:bg-accent/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(`factor.start.scenario.${s.id}.title`)}</span>
                  <span className="block text-[11px] text-muted leading-snug mt-0.5">
                    {t(`factor.start.scenario.${s.id}.text`)}
                  </span>
                </span>
                <ArrowRight
                  className="h-4 w-4 mt-0.5 text-muted shrink-0 transition group-hover:text-accent-ink group-hover:translate-x-0.5 motion-reduce:transition-none"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted flex items-center gap-1.5 flex-wrap">
          <a
            href={EXAMPLE_CSV}
            download
            className="inline-flex items-center gap-1 rounded font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            {t("factor.start.example_csv")}
          </a>
          <span>{t("factor.start.example_csv_hint")}</span>
        </p>
      </div>
    </section>
  );
}
