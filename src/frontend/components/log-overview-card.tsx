"use client";

import { LogStats } from "@/lib/api";
import {
  FileBarChart,
  ListOrdered,
  Activity,
  Tag,
  GitBranch,
  Ruler,
  CalendarRange,
  Flame,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

type Props = {
  stats: LogStats;
  filename?: string | null;
};

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  try {
    const s = new Date(start);
    const e = new Date(end);
    const fmt = (d: Date) =>
      d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    if (fmt(s) === fmt(e)) return fmt(s);
    return `${fmt(s)} → ${fmt(e)}`;
  } catch {
    return null;
  }
}

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  try {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms <= 0 || !Number.isFinite(ms)) return null;
    const days = ms / (1000 * 60 * 60 * 24);
    if (days >= 365) return `${(days / 365).toFixed(1)} years`;
    if (days >= 30) return `${(days / 30).toFixed(1)} months`;
    if (days >= 1) return `${days.toFixed(1)} days`;
    const hours = ms / (1000 * 60 * 60);
    if (hours >= 1) return `${hours.toFixed(1)} h`;
    return `${(ms / 1000).toFixed(0)} s`;
  } catch {
    return null;
  }
}

export function LogOverviewCard({ stats, filename }: Props) {
  const t = useT();
  const dateRange = formatDateRange(stats.time_range_start, stats.time_range_end);
  const duration = formatDuration(stats.time_range_start, stats.time_range_end);
  const variantPct = Math.round(stats.variant_to_trace_ratio * 100);
  const noisyVariants = variantPct > 50;

  return (
    <section className="rounded-lg bg-surface px-4 py-3 space-y-2.5">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
        <FileBarChart className="h-3 w-3" />
        <span>{t("log_overview.heading")}</span>
        {filename && (
          <span className="font-mono normal-case text-muted/70 truncate" title={filename}>
            · {filename}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <Stat
          icon={<ListOrdered className="h-3.5 w-3.5" />}
          value={stats.num_traces.toLocaleString()}
          label={t("log_overview.traces")}
        />
        <Stat
          icon={<Activity className="h-3.5 w-3.5" />}
          value={stats.num_events.toLocaleString()}
          label={t("log_overview.events")}
        />
        <Stat
          icon={<Tag className="h-3.5 w-3.5" />}
          value={stats.num_activities.toLocaleString()}
          label={t("log_overview.activities")}
        />
        <Stat
          icon={<GitBranch className="h-3.5 w-3.5" />}
          value={stats.num_variants.toLocaleString()}
          label={t("log_overview.variants")}
          hint={`${variantPct}%`}
          accent={noisyVariants ? "warn" : "default"}
          title={
            noisyVariants
              ? t("log_overview.noisy_title", { pct: variantPct })
              : t("log_overview.normal_title", { pct: variantPct })
          }
        />
        <Stat
          icon={<Ruler className="h-3.5 w-3.5" />}
          value={`${stats.min_trace_length}–${stats.max_trace_length}`}
          label={t("log_overview.length")}
          hint={`${t("log_overview.median_abbr")} ${stats.median_trace_length}`}
          title={t("log_overview.length_title", { median: stats.median_trace_length, avg: stats.avg_trace_length })}
        />
        {dateRange && (
          <Stat
            icon={<CalendarRange className="h-3.5 w-3.5" />}
            value={dateRange}
            label={t("log_overview.span")}
            hint={duration ?? undefined}
            title={duration ? t("log_overview.span_title", { duration }) : undefined}
          />
        )}
      </div>

      {stats.top_activities.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted shrink-0">
            <Flame className="h-3 w-3" />
            <span>{t("log_overview.top_label")}</span>
          </span>
          {stats.top_activities.slice(0, 5).map(([name, count]) => (
            <span
              key={name}
              className="inline-flex items-baseline gap-1.5 rounded-md bg-tile/60 px-2 py-0.5 text-[11px] whitespace-nowrap min-w-0"
              title={name}
            >
              <span className="text-fg font-medium truncate max-w-[180px]">{name}</span>
              <span className="text-muted font-mono text-[10px]">{count.toLocaleString()}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function Stat({
  icon,
  value,
  label,
  hint,
  accent = "default",
  title,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  hint?: string;
  accent?: "default" | "warn";
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-md bg-tile/60 px-2.5 py-1"
      title={title}
    >
      <span className={cn("self-center", accent === "warn" ? "text-warn-ink" : "text-muted")}>
        {icon}
      </span>
      <span
        className={cn(
          "font-semibold text-sm",
          accent === "warn" ? "text-warn-ink" : "text-fg",
        )}
      >
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
      {hint && (
        <>
          <span className="text-muted/40 text-xs">·</span>
          <span className="text-xs text-muted">{hint}</span>
        </>
      )}
    </span>
  );
}
