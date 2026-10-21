"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { Network, ScrollText, History, ListChecks, Loader2 } from "lucide-react";
import { countText } from "@/lib/factor-analysis";
import { formatPercent } from "@/lib/format";
import { hasJobsPanel, useJobsDrawer } from "./jobs-drawer";
import { cn } from "@/lib/utils";
import { useLocale, useT } from "@/lib/i18n";
import { useTip } from "./ui/tip";

type Mode = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Further routes on which this tab counts as active. */
  also?: string[];
};

const tabClass = (active: boolean) =>
  cn(
    "group relative inline-flex items-center gap-2.5 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap shrink-0 appearance-none focus-visible:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    active ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg hover:bg-surface/40",
  );

// The drawer button opens a panel instead of a page, so it is never underlined like the tab of
// the page; while the drawer is open it is tinted instead.
const toggleClass = (open: boolean) =>
  cn(
    "group relative inline-flex items-center gap-2.5 px-4 py-3 text-sm font-medium border-b-2 border-transparent transition whitespace-nowrap shrink-0 appearance-none focus-visible:outline-none focus-visible:bg-surface focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
    open ? "bg-accent/[0.08] text-fg" : "text-muted hover:text-fg hover:bg-surface/40",
  );

const iconClass = (active: boolean) =>
  cn("h-4 w-4 shrink-0", active ? "text-accent-ink" : "text-muted group-hover:text-fg");

// Full muted colour: at 10 px a lighter shade falls below a readable contrast.
const descClass = "hidden sm:block text-[10px] font-normal text-muted";

export function ModeBar() {
  const pathname = usePathname();
  const { toggle, count, open, activity } = useJobsDrawer();
  const t = useT();
  const { locale } = useLocale();

  const modes: Mode[] = useMemo(
    () => [
      {
        href: "/",
        label: t("mode_bar.model_label"),
        description: t("mode_bar.model_desc"),
        icon: Network,
        also: ["/inspect", "/compare"],
      },
      { href: "/log", label: t("mode_bar.log_label"), description: t("mode_bar.log_desc"), icon: ScrollText },
    ],
    [t],
  );

  const showJobs = hasJobsPanel(pathname);
  const jobsTip = useTip<HTMLButtonElement>({
    more: [t("mode_bar.jobs_title"), activity.failed > 0 ? t("mode_bar.jobs_failed") : ""].filter(Boolean).join(" "),
  });
  // What runs, e.g. "1 running · 37 %"; the waiting ones have no percentage yet.
  const running =
    activity.active > 0
      ? activity.percent === null
        ? countText(t, "mode_bar.jobs_waiting", activity.active)
        : countText(t, "mode_bar.jobs_running", activity.active, {
            pct: formatPercent(activity.percent / 100, locale, 0),
          })
      : null;

  // On a phone the bar scrolls sideways; the tab of the open page is scrolled into view, so
  // /runs does not open with its tab hidden past the edge. Not scrollIntoView, which would
  // scroll the page as well.
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navRef.current;
    const tab = nav?.querySelector<HTMLElement>("[data-active]");
    if (!nav || !tab) return;
    const n = nav.getBoundingClientRect();
    const r = tab.getBoundingClientRect();
    if (r.right > n.right) nav.scrollLeft += r.right - n.right;
    else if (r.left < n.left) nav.scrollLeft -= n.left - r.left;
  }, [pathname]);

  return (
    <div className="border-b border-border bg-bg print:hidden">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
        <nav
          ref={navRef}
          className="flex items-stretch gap-1 overflow-x-auto no-scrollbar -mb-px"
          aria-label={t("mode_bar.aria_label")}
        >
          {modes.map((mode) => {
            const Icon = mode.icon;
            const isActive = pathname === mode.href || !!mode.also?.includes(pathname);
            return (
              <Link
                key={mode.href}
                href={mode.href}
                aria-current={pathname === mode.href ? "page" : undefined}
                data-active={isActive || undefined}
                className={tabClass(isActive)}
              >
                <Icon className={iconClass(isActive)} />
                <div className="flex flex-col items-start leading-tight">
                  <span>{mode.label}</span>
                  <span className={descClass}>{mode.description}</span>
                </div>
              </Link>
            );
          })}
          <div className="ml-auto flex items-stretch">
            {showJobs && (
              <button
                ref={jobsTip}
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls="jobs-drawer"
                className={toggleClass(open)}
              >
                <span className="relative">
                  <History className={iconClass(open)} />
                  {/* A failure nobody has looked at; opening the list is looking. */}
                  {activity.failed > 0 && (
                    <>
                      <span
                        aria-hidden
                        className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-bg"
                      />
                      <span className="sr-only">{t("mode_bar.jobs_failed")}</span>
                    </>
                  )}
                </span>
                <div className="flex flex-col items-start leading-tight">
                  <span className="flex items-baseline gap-1.5">
                    {t("mode_bar.jobs_label")}
                    {count > 0 && <span className="text-[10px] font-mono text-muted">({count})</span>}
                  </span>
                  {running ? (
                    <span className="flex items-center gap-1 text-[10px] font-normal text-accent-ink tabular-nums">
                      <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" aria-hidden />
                      {running}
                    </span>
                  ) : (
                    <span className={descClass}>{t("mode_bar.jobs_desc")}</span>
                  )}
                </div>
              </button>
            )}
            <Link
              href="/runs"
              aria-current={pathname === "/runs" ? "page" : undefined}
              data-active={pathname === "/runs" || undefined}
              className={tabClass(pathname === "/runs")}
            >
              <ListChecks className={iconClass(pathname === "/runs")} />
              <div className="flex flex-col items-start leading-tight">
                <span>{t("mode_bar.runs_label")}</span>
                <span className={descClass}>{t("mode_bar.runs_desc")}</span>
              </div>
            </Link>
          </div>
        </nav>
      </div>
    </div>
  );
}
