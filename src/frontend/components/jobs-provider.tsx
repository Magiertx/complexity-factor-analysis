"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, CheckCircle2, X } from "lucide-react";
import { fetchJobs, type Job } from "@/lib/api";
import { datasetJobHref, jobTitle } from "@/lib/factor-analysis";
import {
  NO_ACTIVITY,
  finishedDatasets,
  jobActivity,
  loadSeenFailures,
  saveSeenFailures,
  statusesOf,
  type JobActivity,
} from "@/lib/job-status";
import { useLocale } from "@/lib/i18n";
import { TAB_HREFS } from "@/lib/nav";
import { Tip, tipTookEscape } from "./ui/tip";

interface JobsContextValue {
  /** The jobs of the session, newest first. */
  jobs: Job[];
  /** The first list has arrived. */
  loaded: boolean;
  /** What runs and what failed unseen, for the History tab. */
  activity: JobActivity;
  /** Reads the list again now, e.g. after a delete. */
  refresh: () => Promise<void>;
}

const JobsContext = createContext<JobsContextValue | null>(null);

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used inside <JobsProvider>");
  return ctx;
}

/**
 * The jobs of the session for every page: loaded once and kept current by the server's events,
 * with polling every 10 s in case a proxy buffers them. The History tab of the mode bar shows from
 * it what runs and whether a run failed unseen (the History page is where it is seen), and a
 * dataset computed while the app is open raises the notice "… is ready · Open" on any page.
 */
export function JobsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onHistory = pathname === TAB_HREFS.history;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activity, setActivity] = useState<JobActivity>(NO_ACTIVITY);
  // A dataset that has just been computed, for the notice.
  const [ready, setReady] = useState<{ id: number; jobs: Job[] } | null>(null);
  const statuses = useRef<Map<string, Job["status"]> | null>(null);
  // The jobs of the first list, and those already reported by the notice.
  const initialJobs = useRef<Set<string> | null>(null);
  const reportedJobs = useRef<Set<string>>(new Set());
  const seenFailures = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await fetchJobs();
      setJobs(list);
      setLoaded(true);
    } catch {
      /* the next event or poll tries again */
    }
  }, []);

  useEffect(() => {
    let active = true;
    let es: EventSource | null = null;
    // Only the updates wait while the tab is hidden; the first load does not, or a page opened in
    // a background tab would show nothing until it is looked at.
    const refresh = (always = false) => {
      if (!active || (document.hidden && !always)) return;
      void load();
    };
    refresh(true);
    const sseUrl = process.env.NEXT_PUBLIC_SSE_URL || "/api/jobs/events";
    try {
      es = new EventSource(sseUrl);
      es.onmessage = (e) => {
        if (e.data === "update" || e.data === "initial") refresh();
      };
    } catch {
      /* without events the polling keeps the list current */
    }
    const timer = setInterval(() => refresh(), 10_000);
    const onVisible = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearInterval(timer);
      es?.close();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  // What the History tab shows of the list: what runs, a failure nobody has seen (the History page
  // shows it), and the datasets that finished while the app was open.
  useEffect(() => {
    if (!loaded) return;
    if (!seenFailures.current) seenFailures.current = loadSeenFailures();
    const seen = seenFailures.current;
    if (onHistory) {
      for (const job of jobs) if (job.status === "failed") seen.add(job.id);
      saveSeenFailures(seen);
    }
    setActivity(jobActivity(jobs, seen));
    // The first list is what was there before: nothing in it counts as finished since.
    if (!initialJobs.current) {
      initialJobs.current = new Set(jobs.map((j) => j.id));
    } else if (statuses.current) {
      const done = finishedDatasets(statuses.current, jobs, { initial: initialJobs.current, reported: reportedJobs.current });
      for (const job of done) reportedJobs.current.add(job.id);
      if (done.length > 0) setReady({ id: Date.now(), jobs: done });
    }
    statuses.current = statusesOf(jobs);
  }, [jobs, loaded, onHistory]);

  const value = useMemo(() => ({ jobs, loaded, activity, refresh: load }), [jobs, loaded, activity, load]);
  return (
    <JobsContext.Provider value={value}>
      {children}
      <ReadyToast notice={ready} onClose={() => setReady(null)} />
    </JobsContext.Provider>
  );
}

const READY_SHOW_MS = 10_000;

/**
 * "<dataset> is ready · Open", a floating notice for a dataset the tool has finished computing, with
 * a link to its tab. The live region is always there, so a screen reader announces each notice. It
 * closes after ten seconds, but not while the pointer or the focus is on it.
 */
function ReadyToast({ notice, onClose }: { notice: { id: number; jobs: Job[] } | null; onClose: () => void }) {
  const { t } = useLocale();
  const [held, setHeld] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!notice || held) return;
    const timer = setTimeout(() => closeRef.current(), READY_SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice, held]);

  const jobs = notice?.jobs ?? [];
  const first = jobs[0];
  const message = !first
    ? ""
    : jobs.length === 1
      ? t("jobs.ready", { name: jobTitle(first, t) })
      : t("jobs.ready_several", { n: jobs.length });
  return (
    <div
      role="status"
      aria-live="polite"
      className="job-toast fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 pointer-events-none print:hidden"
    >
      {notice && first && (
        <div
          key={notice.id}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !tipTookEscape(e)) onClose();
          }}
          className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface pl-3.5 pr-1.5 py-1.5 text-sm shadow-lg ring-1 ring-border/70 max-w-full"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success-ink" aria-hidden />
          <span className="min-w-0 break-words">{message}</span>
          <Link
            href={datasetJobHref(first) ?? "/"}
            onClick={onClose}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-3 text-sm font-medium text-accent-ink hover:bg-tile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {t("jobs.ready_open")}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
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
      )}
    </div>
  );
}
