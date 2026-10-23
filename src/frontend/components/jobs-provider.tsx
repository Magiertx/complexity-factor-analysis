"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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
import { useToasts } from "./ui/toasts";

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
 * dataset computed while the app is open raises the notice "… is ready · Open" on any page but
 * the one that shows it already.
 */
export function JobsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onHistory = pathname === TAB_HREFS.history;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [activity, setActivity] = useState<JobActivity>(NO_ACTIVITY);
  const { notify } = useToasts();
  const { t } = useLocale();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
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
      // The page that shows the dataset already needs no notice of it.
      const news = done.filter((job) => !shownHere(job));
      const first = news[0];
      if (first) {
        notify({
          key: `ready:${news.map((j) => j.id).join(",")}`,
          tone: "success",
          message:
            news.length === 1
              ? tRef.current("jobs.ready", { name: jobTitle(first, tRef.current) })
              : tRef.current("jobs.ready_several", { n: news.length }),
          action: { label: tRef.current("jobs.ready_open"), href: datasetJobHref(first) ?? "/" },
        });
      }
    }
    statuses.current = statusesOf(jobs);
  }, [jobs, loaded, onHistory, notify]);

  const value = useMemo(() => ({ jobs, loaded, activity, refresh: load }), [jobs, loaded, activity, load]);
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

/** The dataset of a job is the one open on the tab on screen. */
function shownHere(job: Job): boolean {
  const kind = job.algorithm_id === "_dataset:log" ? "log" : "model";
  const tab = kind === "log" ? TAB_HREFS.log : TAB_HREFS.model;
  try {
    return window.location.pathname === tab && localStorage.getItem(`app.factor-dataset-${kind}`) === job.params?.dataset_id;
  } catch {
    return false;
  }
}
