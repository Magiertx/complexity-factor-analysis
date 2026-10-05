"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Play, Layers, History } from "lucide-react";
import { useJobsDrawer } from "./jobs-drawer";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type Mode = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const MODE_HREFS = new Set(["/", "/batch"]);

export function ModeBar() {
  const pathname = usePathname();
  const { toggle, count, open } = useJobsDrawer();
  const t = useT();

  const MODES: Mode[] = useMemo(
    () => [
      { href: "/", label: t("mode_bar.single_run_label"), description: t("mode_bar.single_run_desc"), icon: Play },
      { href: "/batch", label: t("mode_bar.batch_label"), description: t("mode_bar.batch_desc"), icon: Layers },
    ],
    [t],
  );

  if (!MODE_HREFS.has(pathname)) return null;

  return (
    <div className="border-b border-border bg-bg">
      <div className="mx-auto max-w-[1920px] px-6">
        <nav
          className="flex items-stretch gap-1 overflow-x-auto no-scrollbar -mb-px"
          aria-label={t("mode_bar.aria_label")}
        >
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const isActive = pathname === mode.href;
            return (
              <Link
                key={mode.href}
                href={mode.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group relative inline-flex items-center gap-2.5 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap shrink-0",
                  isActive
                    ? "border-accent text-fg"
                    : "border-transparent text-muted hover:text-fg hover:bg-surface/40",
                )}
              >
                <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-accent" : "text-muted/70 group-hover:text-muted")} />
                <div className="flex flex-col items-start leading-tight">
                  <span>{mode.label}</span>
                  <span className={cn("text-[10px] font-normal", isActive ? "text-muted" : "text-muted/60")}>
                    {mode.description}
                  </span>
                </div>
              </Link>
            );
          })}
          <div className="ml-auto flex items-stretch">
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls="jobs-drawer"
              className={cn(
                "group relative inline-flex items-center gap-2.5 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap shrink-0 appearance-none",
                open
                  ? "border-accent text-fg"
                  : "border-transparent text-muted hover:text-fg hover:bg-surface/40",
              )}
              title={t("mode_bar.jobs_title")}
            >
              <History className={cn("h-4 w-4 shrink-0", open ? "text-accent" : "text-muted/70 group-hover:text-muted")} />
              <div className="flex flex-col items-start leading-tight">
                <span className="flex items-baseline gap-1.5">
                  {t("mode_bar.jobs_label")}
                  {count > 0 && (
                    <span className="text-[10px] font-mono text-muted">({count})</span>
                  )}
                </span>
                <span className={cn("text-[10px] font-normal", open ? "text-muted" : "text-muted/60")}>
                  {t("mode_bar.jobs_desc")}
                </span>
              </div>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
