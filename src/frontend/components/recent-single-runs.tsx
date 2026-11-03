"use client";

import Link from "next/link";
import { ArrowRight, Check, CircleSlash, Loader2, XCircle } from "lucide-react";
import type { Job } from "@/lib/api";
import { formatDateTime, formatPercent, formatRelative } from "@/lib/format";
import { isSingleRun } from "@/lib/history";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useJobs } from "./jobs-provider";
import { useTip } from "./ui/tip";

const SHOWN = 5;

/**
 * The last runs of single logs, on the page that starts them: each opens the run here, with its
 * status, and the whole list is in the History. Nothing while there are none.
 */
export function RecentSingleRuns({ activeId }: { activeId: string | null }) {
  const { t } = useLocale();
  const { jobs } = useJobs();
  const runs = jobs.filter(isSingleRun);
  if (runs.length === 0) return null;
  return (
    <section aria-labelledby="recent-single-runs" className="rounded-lg bg-surface">
      <div className="px-4 pt-3 pb-2 flex items-baseline justify-between gap-3">
        <h2 id="recent-single-runs" className="text-sm font-semibold">
          {t("inspect.recent.title")} <span className="text-xs font-normal text-muted">({runs.length})</span>
        </h2>
        <Link
          href="/runs?type=single"
          className="inline-flex items-center gap-1 rounded text-xs font-medium text-accent-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {t("inspect.recent.all")}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <ul className="px-2 pb-2">
        {runs.slice(0, SHOWN).map((job) => (
          <RunItem key={job.id} job={job} active={job.id === activeId} />
        ))}
      </ul>
    </section>
  );
}

function RunItem({ job, active }: { job: Job; active: boolean }) {
  const { t, locale } = useLocale();
  const time = job.created_at * 1000;
  const timeTip = useTip<HTMLElement>({ more: formatDateTime(time, locale) });
  const miners = Array.isArray(job.params?.discovery_algorithms) ? (job.params.discovery_algorithms as string[]) : [];
  return (
    <li>
      <Link
        href={`/inspect?job=${encodeURIComponent(job.id)}`}
        aria-current={active ? "true" : undefined}
        className={cn(
          "relative flex items-start gap-2 rounded-md px-2 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
          // The run on screen, marked like a chosen tile (docs/UI.md).
          active ? "bg-surface ring-[1.5px] ring-inset ring-accent" : "hover:bg-tile",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium truncate">{job.filename}</span>
          <span className="block text-xs text-muted truncate">
            {miners.length > 0 && `${miners.join(", ")} · `}
            <time ref={timeTip} dateTime={new Date(time).toISOString()}>
              {formatRelative(time, locale)}
            </time>
          </span>
        </span>
        <RunStatus job={job} label={t(`run_history.status_label_${job.status}`)} />
      </Link>
    </li>
  );
}

/** The status as a sign, named by its tooltip and for screen readers. */
function RunStatus({ job, label }: { job: Job; label: string }) {
  const { locale } = useLocale();
  const tip = useTip<HTMLSpanElement>({ name: label });
  const sign =
    job.status === "completed" ? (
      <Check className="h-3.5 w-3.5 text-success-ink" aria-hidden />
    ) : job.status === "failed" ? (
      <XCircle className="h-3.5 w-3.5 text-danger-ink" aria-hidden />
    ) : job.status === "aborted" ? (
      <CircleSlash className="h-3.5 w-3.5 text-muted" aria-hidden />
    ) : (
      <span className="inline-flex items-center gap-1 text-xs text-accent-ink tabular-nums">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
        {job.status === "running" && formatPercent(job.percentage / 100, locale, 0)}
      </span>
    );
  return (
    <span ref={tip} className="mt-0.5 shrink-0 inline-flex">
      {sign}
      <span className="sr-only">{label}</span>
    </span>
  );
}
