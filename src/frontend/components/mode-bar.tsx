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
import { useTip } from "./ui/tip";

const ICONS: Record<TabId, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  model: Network,
  log: ScrollText,
  compare: Columns3,
  inspect: Microscope,
  history: History,
};

/**
 * A tab of an analysis: icon and label. On a phone the icon stands above the label, so that the
 * three tabs and the two tools share the width.
 */
const tabClass = (active: boolean) =>
  cn(
    "group relative flex flex-none min-[380px]:flex-1 sm:flex-none flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2.5 px-2 min-[380px]:px-1.5 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm font-medium border-b-2 transition whitespace-nowrap min-[380px]:whitespace-normal sm:whitespace-nowrap min-[380px]:min-w-0 sm:shrink-0 appearance-none focus-visible:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg hover:bg-surface/40",
  );

/** A tool of the app: smaller than the analyses, and icon-only below `lg`. */
const toolClass = (active: boolean) =>
  cn(
    "group relative inline-flex items-center gap-2 px-2.5 lg:px-3 py-3 text-[13px] font-medium border-b-2 transition whitespace-nowrap shrink-0 appearance-none focus-visible:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg hover:bg-surface/40",
  );

const iconClass = (active: boolean) =>
  cn("h-4 w-4 shrink-0", active ? "text-accent-ink" : "text-muted group-hover:text-fg");

/**
 * One entry of the bar. What the entry is for is its tooltip, not a line under its label. A tool
 * drops its label below `lg` and keeps it as its accessible name.
 */
function NavEntry({
  id,
  active,
  tool,
  extra,
  line,
  hint,
}: {
  id: TabId;
  active: boolean;
  tool?: boolean;
  extra?: React.ReactNode;
  line?: React.ReactNode;
  /** What runs, for the accessible name of an entry whose line is hidden. */
  hint?: string | null;
}) {
  const t = useT();
  const Icon = ICONS[id];
  const label = t(`mode_bar.${id}_label`);
  const tip = useTip<HTMLAnchorElement>({ name: label, more: t(`mode_bar.${id}_desc`) });
  return (
    <li className="flex min-w-0">
      <Link
        ref={tip}
        href={TAB_HREFS[id]}
        aria-current={active ? "page" : undefined}
        aria-label={tool ? (hint ? `${label}, ${hint}` : label) : undefined}
        className={tool ? toolClass(active) : tabClass(active)}
      >
        <span className="relative">
          <Icon className={iconClass(active)} aria-hidden />
          {extra}
        </span>
        <span className={cn("flex flex-col items-center sm:items-start leading-tight", tool && "hidden lg:flex lg:items-start")}>
          <span className={cn(!tool && "text-center sm:text-left [hyphens:auto]")}>{label}</span>
          {line}
        </span>
      </Link>
    </li>
  );
}

/**
 * The tabs of the app, the same on every page, in two groups: the analyses (model and log
 * complexity, a single log), and set apart on the right the tools of the app, the comparison and
 * the History, which also says what runs ("1 running · 37 %") and has a red dot for a run that
 * failed unseen. One nav with two labelled lists. Exactly one tab is active on the page of a tab;
 * the pages of the header activate none. What a tab is for is its tooltip. Below `lg` the tools
 * are icons, and from 380 px all five entries fit. Below that, "Modellkomplexität" no longer fits
 * its third of the width, so the tabs keep their own width and the bar scrolls sideways in the same
 * order, fading at the edge where more tabs lie beyond it.
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

  return (
    <div className="border-b border-border bg-bg print:hidden">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <nav
          ref={navRef}
          className="scroll-fade flex items-stretch gap-1 overflow-x-auto no-scrollbar -mb-px"
          aria-label={t("mode_bar.aria_label")}
        >
          <ul aria-label={t("mode_bar.analyses_aria")} className="flex flex-none min-[380px]:flex-1 sm:flex-none items-stretch gap-1 min-[380px]:min-w-0">
            {ANALYSIS_TABS.map((id) => (
              <NavEntry key={id} id={id} active={active === id} />
            ))}
          </ul>
          {/* The tools of the app, set apart at the right end by a line before them. */}
          <ul
            aria-label={t("mode_bar.tools_aria")}
            className="relative sm:ml-auto flex items-stretch gap-1.5 shrink-0 pl-3 sm:pl-4 before:absolute before:left-1 sm:before:left-1.5 before:top-1/2 before:h-6 before:w-px before:-translate-y-1/2 before:bg-border"
          >
            <NavEntry id="compare" tool active={active === "compare"} />
            <NavEntry
              id="history"
              tool
              active={active === "history"}
              hint={running}
              extra={
                <>
                  {/* A failure nobody has seen yet; the History page shows it. */}
                  {activity.failed > 0 && (
                    <>
                      <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" />
                      <span className="sr-only">{t("mode_bar.jobs_failed")}</span>
                    </>
                  )}
                  {/* Below `lg` the line is hidden: a dot says that something runs. */}
                  {running && activity.failed === 0 && (
                    <span aria-hidden className="lg:hidden absolute -right-1 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-bg animate-pulse" />
                  )}
                </>
              }
              line={
                running && (
                  <span className="flex items-center gap-1 text-xs font-normal text-accent-ink tabular-nums">
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
                    {running}
                  </span>
                )
              }
            />
          </ul>
        </nav>
      </div>
    </div>
  );
}
