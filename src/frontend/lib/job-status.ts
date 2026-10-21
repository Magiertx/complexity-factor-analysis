// What the "Recent runs" tab says about the jobs of the session without opening the list: how many
// run and how far they are, whether one failed that nobody has looked at yet, and which dataset jobs
// have just finished. The drawer fetches the jobs; this turns the list into those three things.

import type { Job } from "./api";

/** What runs now, and what failed unseen. */
export interface JobActivity {
  /** Jobs waiting or running. */
  active: number;
  /** The mean progress of the running ones in percent; null while none runs yet. */
  percent: number | null;
  /** Failed jobs the reader has not looked at. */
  failed: number;
}

export const NO_ACTIVITY: JobActivity = { active: 0, percent: null, failed: 0 };

const ACTIVE: readonly Job["status"][] = ["pending", "running"];

/** The activity of a list of jobs; `seen` are the ids of failed jobs the reader has looked at. */
export function jobActivity(jobs: readonly Job[], seen: ReadonlySet<string>): JobActivity {
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const running = active.filter((j) => j.status === "running");
  const percent =
    running.length === 0
      ? null
      : Math.round(running.reduce((sum, j) => sum + Math.max(0, Math.min(100, j.percentage)), 0) / running.length);
  return {
    active: active.length,
    percent,
    failed: jobs.filter((j) => j.status === "failed" && !seen.has(j.id)).length,
  };
}

/** The status of each job, to compare the next list with. */
export function statusesOf(jobs: readonly Job[]): Map<string, Job["status"]> {
  return new Map(jobs.map((j) => [j.id, j.status]));
}

/**
 * The jobs that computed a dataset and have finished since the page loaded, and not been reported.
 * One was waiting or running in `before` (the last list), or is new: not in `initial`, the first list
 * of the page, so it was started while the page was open, even if it finished between two lists.
 * One that was finished when the page loaded is none; neither is one already in `reported`.
 */
export function finishedDatasets(
  before: ReadonlyMap<string, Job["status"]>,
  jobs: readonly Job[],
  { initial, reported }: { initial: ReadonlySet<string>; reported: ReadonlySet<string> },
): Job[] {
  return jobs.filter((job) => {
    if (!job.algorithm_id.startsWith("_dataset:") || job.status !== "completed" || reported.has(job.id)) return false;
    const was = before.get(job.id);
    return was ? ACTIVE.includes(was) : !initial.has(job.id);
  });
}

const SEEN_KEY = "app.jobs-seen-failures";
/** The ids kept, so that the list does not grow with every failure there ever was. */
const SEEN_LIMIT = 200;

/** The failed jobs the reader has looked at, as this browser remembers them. */
export function loadSeenFailures(): Set<string> {
  try {
    const saved = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

export function saveSeenFailures(seen: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_LIMIT)));
  } catch {
    /* storage blocked */
  }
}
