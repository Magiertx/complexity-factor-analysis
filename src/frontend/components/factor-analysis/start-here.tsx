"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Columns3, Download, Network, ScrollText, Signpost } from "lucide-react";
import type { FactorKind } from "@/lib/api";
import { cn } from "@/lib/utils";
import { COMPARE_HREF, COMPARE_K4_K6_HREF } from "@/lib/compare";
import { countText } from "@/lib/factor-analysis";
import { useT } from "@/lib/i18n";

const STORAGE_KEY = "app.start-here-open";

/** The tab an entry of Start here opens. */
type Destination = FactorKind | "compare";

const DESTINATION_ICON: Record<Destination, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  model: Network,
  log: ScrollText,
  compare: Columns3,
};

/**
 * Analyses to open in one click, as links of the kind "Copy link" makes. An analysis opens on its
 * loadings, the result, with the steps before it done. Scenarios that need features still to come
 * stay in the list, hidden, so they are switched on in one place.
 */
const SCENARIOS: { id: string; href: string; to: Destination; available: boolean }[] = [
  {
    id: "if_inductive",
    href: "/?bundled=comfy-paper-inductive-miner&preset=published&step=loadings",
    to: "model",
    available: true,
  },
  {
    id: "log_standard",
    href: "/log?bundled=comfy-log-pdc-training-logs&preset=standard&step=loadings",
    to: "log",
    available: true,
  },
  { id: "if_four_miners", href: COMPARE_HREF, to: "compare", available: true },
  { id: "if_k4_k6", href: COMPARE_K4_K6_HREF, to: "compare", available: true },
  { id: "log_paper", href: "", to: "log", available: false },
];

/**
 * The entries of Start here on a tab: on the log tab only the analyses of log measures; the model
 * tab, where the app opens, has every way in, and names the tab of those that open another.
 */
function scenariosFor(kind: FactorKind) {
  return SCENARIOS.filter((s) => s.available && (kind === "model" || s.to === kind));
}

/** A small synthetic table in the format of an own CSV upload. */
const EXAMPLE_CSV = "/examples/example-measures.csv";

/**
 * "Start here": the shortest ways into the tool for someone with little time, such as a
 * reviewer. Collapsible, and it stays as it was left.
 */
export function StartHere({ kind }: { kind: FactorKind }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const panelId = useId();
  const scenarios = scenariosFor(kind);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "0") setOpen(false);
    } catch {
      /* storage blocked */
    }
  }, []);

  const toggle = () => {
    setOpen(!open);
    try {
      localStorage.setItem(STORAGE_KEY, open ? "0" : "1");
    } catch {
      /* storage blocked */
    }
  };

  return (
    <section aria-labelledby={`${panelId}-title`} className="rounded-lg bg-tile/50">
      <h3 id={`${panelId}-title`}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={panelId}
          className="w-full flex items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left transition hover:bg-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Signpost className="h-4 w-4 text-accent-ink shrink-0" aria-hidden />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold">{t("factor.start.title")}</span>
            {!open && (
              <span className="block text-xs text-muted">{countText(t, "factor.start.collapsed_hint", scenarios.length)}</span>
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 text-muted shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="px-3.5 pb-3.5 space-y-2.5">
        <p className="text-xs text-muted max-w-prose">{t("factor.start.intro")}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {scenarios.map((s) => {
            const elsewhere = s.to !== kind;
            const Icon = DESTINATION_ICON[s.to];
            return (
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
                    {/* Where an entry leads off this tab, it says to which. */}
                    {elsewhere && (
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-muted">
                        <Icon className="h-3 w-3" aria-hidden />
                        {t("factor.start.opens", { page: t(`mode_bar.${s.to}_label`) })}
                      </span>
                    )}
                  </span>
                  <ArrowRight
                    className="h-4 w-4 mt-0.5 text-muted shrink-0 transition group-hover:text-accent-ink group-hover:translate-x-0.5 motion-reduce:transition-none"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
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
