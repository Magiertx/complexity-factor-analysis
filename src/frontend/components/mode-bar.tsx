"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Columns3, History, Loader2, Microscope, Network, ScrollText } from "lucide-react";
import { countText } from "@/lib/factor-analysis";
import { formatPercent } from "@/lib/format";
import { ANALYSIS_TABS, TAB_HREFS, activeTab, type TabId } from "@/lib/nav";
import { useScrollFade } from "@/lib/use-scroll-fade";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { useJobs } from "./jobs-provider";

const ICONS: Record<TabId, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  model: Network,
  log: ScrollText,
  compare: Columns3,
  inspect: Microscope,
  history: History,
};

/** A tab of an analysis: icon, label and from a small screen on the line that says what it is for. */
const tabClass = (active: boolean) =>
  cn(
    "group relative inline-flex items-center gap-2.5 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap shrink-0 appearance-none focus-visible:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg hover:bg-surface/40",
  );

/** A tool of the app: smaller than the analyses, without the description line. */
const toolClass = (active: boolean) =>
  cn(
    "group relative inline-flex items-center gap-2 px-3 py-3 text-[13px] font-medium border-b-2 transition whitespace-nowrap shrink-0 appearance-none focus-visible:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg hover:bg-surface/40",
  );

const iconClass = (active: boolean) =>
  cn("h-4 w-4 shrink-0", active ? "text-accent-ink" : "text-muted group-hover:text-fg");

// Full muted colour: at 10 px a lighter shade falls below a readable contrast.
const descClass = "hidden sm:block text-[10px] font-normal text-muted";

/**
 * The tabs of the app, the same on every page, in two groups: the analyses (model and log
 * complexity, a single log), and set apart on the right the tools of the app, the comparison and
 * the History, which also says what runs ("1 running · 37 %") and has a red dot for a run that
 * failed unseen. One nav with two labelled lists. Exactly one tab is active on the page of a tab;
 * the pages of the header activate none. On a phone the bar scrolls sideways in the same order,
 * fading at the edge where more tabs lie beyond it.
 */
export function ModeBar() {
  const pathname = usePathname();
  const { activity } = useJobs();
  const t = useT();
  const { locale } = useLocale();
  // The print view belongs to the tab of its analysis, which its query names.
  const [search, setSearch] = useState("");
  useEffect(() => {
    setSearch(window.location.search);
  }, [pathname]);
  const active = activeTab(pathname, search);

  // What runs, e.g. "1 running · 37 %"; the waiting ones have no percentage yet.
  const running =
    activity.active > 0
      ? activity.percent === null
        ? countText(t, "mode_bar.jobs_waiting", activity.active)
        : countText(t, "mode_bar.jobs_running", activity.active, {
            pct: formatPercent(activity.percent / 100, locale, 0),
          })
      : null;

  // The tab of the open page is scrolled into view, so a phone does not open /runs with its tab
  // past the edge; no further than needed, and not with scrollIntoView, which would scroll the page.
  // Again once the labels are in the language of the UI, which changes their widths.
  const navRef = useRef<HTMLElement>(null);
  useScrollFade(navRef);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const nav = navRef.current;
      const tab = nav?.querySelector<HTMLElement>("[aria-current='page']");
      if (!nav || !tab) return;
      const n = nav.getBoundingClientRect();
      const r = tab.getBoundingClientRect();
      // Clear of the fade at an edge as well (2rem, see useScrollFade); the browser stops at the end.
      const fade = 32;
      if (r.right > n.right - fade) nav.scrollLeft += r.right - (n.right - fade);
      else if (r.left < n.left + fade) nav.scrollLeft -= n.left + fade - r.left;
    });
    return () => cancelAnimationFrame(frame);
  }, [active, locale]);

  const tab = (id: TabId) => {
    const Icon = ICONS[id];
    const on = active === id;
    return (
      <li key={id} className="flex">
        <Link href={TAB_HREFS[id]} aria-current={on ? "page" : undefined} className={tabClass(on)}>
          <Icon className={iconClass(on)} aria-hidden />
          <span className="flex flex-col items-start leading-tight">
            <span>{t(`mode_bar.${id}_label`)}</span>
            <span className={descClass}>{t(`mode_bar.${id}_desc`)}</span>
          </span>
        </Link>
      </li>
    );
  };

  const tool = (id: TabId, extra?: React.ReactNode, line?: React.ReactNode) => {
    const Icon = ICONS[id];
    const on = active === id;
    return (
      <li key={id} className="flex">
        <Link href={TAB_HREFS[id]} aria-current={on ? "page" : undefined} className={toolClass(on)}>
          <span className="relative">
            <Icon className={iconClass(on)} aria-hidden />
            {extra}
          </span>
          <span className="flex flex-col items-start leading-tight">
            <span>{t(`mode_bar.${id}_label`)}</span>
            {line}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <div className="border-b border-border bg-bg print:hidden">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <nav
          ref={navRef}
          className="scroll-fade flex items-stretch gap-1 overflow-x-auto no-scrollbar -mb-px"
          aria-label={t("mode_bar.aria_label")}
        >
          <ul aria-label={t("mode_bar.analyses_aria")} className="flex items-stretch gap-1 shrink-0">
            {ANALYSIS_TABS.map((id) => tab(id))}
          </ul>
          {/* The tools of the app, set apart at the right end by a line before them. */}
          <ul
            aria-label={t("mode_bar.tools_aria")}
            className="relative ml-auto flex items-stretch gap-0.5 shrink-0 pl-4 before:absolute before:left-1.5 before:top-1/2 before:h-6 before:w-px before:-translate-y-1/2 before:bg-border"
          >
            {tool("compare")}
            {tool(
              "history",
              // A failure nobody has seen yet; the History page shows it.
              activity.failed > 0 && (
                <>
                  <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" />
                  <span className="sr-only">{t("mode_bar.jobs_failed")}</span>
                </>
              ),
              running && (
                <span className="flex items-center gap-1 text-[10px] font-normal text-accent-ink tabular-nums">
                  <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" aria-hidden />
                  {running}
                </span>
              ),
            )}
          </ul>
        </nav>
      </div>
    </div>
  );
}
