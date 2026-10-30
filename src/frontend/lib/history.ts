// The History page: one list of what the session holds, newest first. A dataset is one row, with
// the job that computed it on that row; a run of a single log is a row of its own.

import type { AnalyzeOptions, DatasetSummary, FactorKind, Job } from "./api";
import {
  countText,
  defaultOptions,
  optionsFromSaved,
  sameOptions,
  settingsSummary,
  type AnalysisOptions,
} from "./factor-analysis";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** What a row is: a dataset of either tab, or a run of a single log. */
export type HistoryType = FactorKind | "single";
export type HistoryStatus = "active" | "completed" | "failed" | "aborted";

export interface HistoryRow {
  key: string;
  type: HistoryType;
  /** When it was created, in milliseconds since the epoch. */
  time: number;
  status: HistoryStatus;
  /** How far a job that runs has come, in percent; null while it waits or without a job. */
  percent: number | null;
  /** The dataset of the row; null for a single run, and for a dataset job whose dataset is not listed (yet). */
  dataset: DatasetSummary | null;
  /** The job of the row: the run of a single log, or the job that computed the dataset. */
  job: Job | null;
}

const DATASET_PREFIX = "_dataset:";

function jobStatus(job: Job): HistoryStatus {
  if (job.status === "pending" || job.status === "running") return "active";
  return job.status;
}

function jobKind(job: Job): FactorKind | null {
  if (!job.algorithm_id.startsWith(DATASET_PREFIX)) return null;
  return job.algorithm_id.slice(DATASET_PREFIX.length) === "log" ? "log" : "model";
}

function runningPercent(job: Job | null): number | null {
  return job?.status === "running" ? Math.max(0, Math.min(100, job.percentage)) : null;
}

/**
 * The rows of the History, newest first: every dataset with its job, every run of a single log
 * (those of the removed batch mode with them), and a dataset job whose dataset the list does not
 * have yet, so nothing that runs is missing between two loads of the datasets.
 */
export function historyRows(datasets: readonly DatasetSummary[], jobs: readonly Job[]): HistoryRow[] {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const shown = new Set<string>();
  const rows: HistoryRow[] = [];
  for (const d of datasets) {
    const job = d.job_id ? (byId.get(d.job_id) ?? null) : null;
    if (job) shown.add(job.id);
    const status: HistoryStatus =
      d.status === "ready"
        ? "completed"
        : d.status === "computing"
          ? job && jobStatus(job) !== "active" && job.status !== "completed"
            ? jobStatus(job)
            : "active"
          : d.status === "aborted" || job?.status === "aborted"
            ? "aborted"
            : "failed";
    rows.push({
      key: `dataset:${d.id}`,
      type: d.kind,
      time: new Date(d.created_at).getTime(),
      status,
      percent: status === "active" ? runningPercent(job) : null,
      dataset: d,
      job,
    });
  }
  const datasetIds = new Set(datasets.map((d) => d.id));
  for (const job of jobs) {
    if (shown.has(job.id)) continue;
    const kind = jobKind(job);
    const datasetId = job.params?.dataset_id;
    // The dataset job of a dataset already listed under another job id is that dataset's.
    if (kind && typeof datasetId === "string" && datasetIds.has(datasetId)) continue;
    rows.push({
      key: `job:${job.id}`,
      type: kind ?? "single",
      time: job.created_at * 1000,
      status: jobStatus(job),
      percent: runningPercent(job),
      dataset: null,
      job,
    });
  }
  return rows.sort((a, b) => b.time - a.time);
}

/** The page of the tool a row opens: its dataset on its tab, or the run on the page of a single log. */
export function historyHref(row: HistoryRow): string {
  if (row.type === "single") return `/inspect?job=${encodeURIComponent(row.job?.id ?? "")}`;
  const tab = row.type === "log" ? "/log" : "/";
  const id = row.dataset?.id ?? row.job?.params?.dataset_id;
  return typeof id === "string" ? `${tab}?dataset=${encodeURIComponent(id)}` : tab;
}

/** The type filter of the page as its address names it (?type=single), or "all". */
export type TypeFilter = HistoryType | "all";

export function parseTypeFilter(value: string | null): TypeFilter {
  return value === "model" || value === "log" || value === "single" ? value : "all";
}

/**
 * The settings of the last analysis of a dataset in short: "Tool standard", "Paper settings", or
 * those that differ from the standard, e.g. "4 factors · h² ≥ 0.3 · multiple membership". Null
 * before a first analysis.
 */
export function savedSettingsText(
  kind: FactorKind,
  saved: AnalyzeOptions | null | undefined,
  measureCount: number | null,
  published: AnalysisOptions | null,
  t: Translate,
): string | null {
  if (!saved) return null;
  const options = optionsFromSaved(kind, saved);
  const standard = defaultOptions(kind);
  if (published && sameOptions(options, published)) return t("factor.data.preset.published");
  if (sameOptions(options, standard)) return t("factor.data.preset.standard");
  return (
    settingsSummary(options, standard, null, measureCount ?? 0, t)
      .filter((chip) => chip.differs)
      // Without the analysis there is no Kaiser count to set a count of one's own beside.
      .map((chip) =>
        chip.id === "factors" && options.n_factors !== null
          ? countText(t, "factor.factors.criterion_count", options.n_factors)
          : chip.text,
      )
      .join(" · ")
  );
}

/** The calendar day of a moment in the browser's time zone, to group the rows by. */
export function dayKey(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
