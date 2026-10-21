// Typed client for the AlgoService backend.
// Mirrors src/AlgoService/algorithms/base.py.

import { downloadBlob } from "./factor-analysis";

export type ParameterType = "int" | "float" | "bool" | "enum" | "multi_enum" | "string";
// Open string; the backend's `/algorithms` response carries the authoritative
// `categories` list (id + label), and the frontend renders whichever ids show
// up. Keeping this typed as a closed Literal would make every new category a
// frontend change. Known id today: "complexity"; the locale files translate its
// label (algorithm_list.category.*), unknown ids fall back to the backend label.
export type ToolType = string;

export interface ParameterSpec {
  name: string;
  label: string;
  type: ParameterType;
  default: unknown;
  min?: number;
  max?: number;
  options?: string[];
  help?: string;
  /** Short hint about a sensible value range / paper-recommended default,
   *  surfaced in the form as supplementary text below the field. */
  recommended?: string;
}

export interface SecondaryFileSpec {
  name: string;
  label: string;
  accept: string;
  optional: boolean;
  help?: string | null;
}

export interface AlgorithmManifest {
  id: string;
  name: string;
  description: string;
  paper_url?: string | null;
  author?: string | null;
  tool_type: ToolType;
  parameters_schema: ParameterSpec[];
  secondary_files?: SecondaryFileSpec[];
  citation?: string | null;
  formatted_citation?: string | null;
}

export interface SampleLog {
  id: string;
  name: string;
  description: string;
  filename: string;
  size_bytes: number;
}

export interface RecentLog {
  id: string;
  name: string;
  filename: string;
  size_bytes: number;
  mtime: number;
}

export type Artifact =
  | { kind: "stat"; label: string; value: number | string; unit?: string | null; pct?: boolean; accent?: "default" | "success" | "warn" | "danger" }
  | { kind: "table"; label: string; columns: string[]; rows: (string | number | boolean | null)[][] }
  | { kind: "image"; label: string; data_base64: string; mime: string; caption?: string | null }
  | { kind: "log"; label: string; data_base64: string; filename: string; mime?: string }
  | { kind: "text"; label: string; markdown: string };

export interface AnalysisResult {
  algorithm: string;
  tool_type: ToolType;
  filename: string;
  summary: string | null;
  artifacts: Artifact[];
}

/**
 * Base URL of the API. In the browser this is the relative `/api`, which the Next.js rewrite
 * forwards to the backend, so requests go through the reverse proxy and the backend port can
 * stay unpublished. Use this instead of hardcoding a URL in components.
 */
export const API_BASE = typeof window === "undefined"
  ? (process.env.INTERNAL_API_URL || "http://algoservice:8000")
  : "/api";

const BASE = API_BASE;

export interface FetchAlgorithmsResponse {
  algorithms: AlgorithmManifest[];
  categories: { id: string; label: string }[];
}

export async function fetchAlgorithms(): Promise<FetchAlgorithmsResponse> {
  const r = await fetch(`${BASE}/algorithms`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load algorithms (${r.status})`);
  return r.json();
}

export async function fetchSampleLogs(): Promise<SampleLog[]> {
  const r = await fetch(`${BASE}/sample-logs`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load sample logs (${r.status})`);
  return r.json();
}

export async function fetchRecentLogs(): Promise<RecentLog[]> {
  const r = await fetch(`${BASE}/recent-logs`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load recent logs (${r.status})`);
  return r.json();
}

export interface LogStats {
  num_traces: number;
  num_events: number;
  num_activities: number;
  num_variants: number;
  variant_to_trace_ratio: number;
  avg_trace_length: number;
  min_trace_length: number;
  max_trace_length: number;
  median_trace_length: number;
  time_range_start: string | null;
  time_range_end: string | null;
  top_activities: [string, number][];
}

export interface LogStatsResponse {
  stats: LogStats;
}

export async function fetchLogStats(
  file: File | null,
  sampleLogId: string | null,
  recentLogId: string | null,
  signal?: AbortSignal,
): Promise<LogStatsResponse> {
  const form = new FormData();
  if (file) form.append("file", file);
  if (sampleLogId) form.append("sample_log_id", sampleLogId);
  if (recentLogId) form.append("recent_log_id", recentLogId);
  const r = await fetch(`${BASE}/log-stats`, { method: "POST", body: form, signal });
  if (!r.ok) {
    let msg = `Log statistics failed (${r.status})`;
    try {
      const j = await r.json();
      if (j.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    throw new Error(msg);
  }
  return r.json();
}

export interface AnalyzeResponse {
  algorithm: string;
  tool_type: ToolType;
  filename: string;
  job_id: string;
  status: string;
}

export class ValidationError extends Error {
  errors: Record<string, string>;

  constructor(message: string, errors: Record<string, string>) {
    super(message);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export async function analyze(
  algorithmId: string,
  file: File | null,
  sampleLogId: string | null,
  recentLogId: string | null,
  params: Record<string, unknown>,
  signal?: AbortSignal,
  secondaryFiles?: Record<string, File>,
): Promise<AnalyzeResponse> {
  const form = new FormData();
  if (file) {
    form.append("file", file);
  }
  if (sampleLogId) {
    form.append("sample_log_id", sampleLogId);
  }
  if (recentLogId) {
    form.append("recent_log_id", recentLogId);
  }
  if (secondaryFiles) {
    for (const [name, f] of Object.entries(secondaryFiles)) {
      form.append(name, f);
    }
  }
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) form.append(k, String(item));
    } else {
      form.append(k, typeof v === "boolean" ? String(v) : (v as string | Blob));
    }
  }
  const url = `${BASE}/algorithms/${algorithmId}/analyze`;
  const r = await fetch(url, {
    method: "POST",
    body: form,
    signal: signal,
  });
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    // A refusal such as a full run quota comes with a code, so the UI can say it in its language.
    let code: string | undefined = r.status === 429 ? "rate_limited" : undefined;
    let params: Record<string, string | number> | undefined;
    try {
      const j = await r.json();
      if (j.detail) {
        if (typeof j.detail === "object" && j.detail !== null && j.detail.type === "validation_error") {
          throw new ValidationError(j.detail.message || "Please fix validation errors.", j.detail.errors || {});
        }
        msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
      if (typeof j.code === "string") code = j.code;
      if (j.params && typeof j.params === "object") params = j.params;
    } catch (e) {
      if (e instanceof ValidationError) throw e;
    }
    throw new HttpError(msg, r.status, code, params);
  }
  return r.json();
}

/** Asks the backend to abort a job; false if the request failed. */
export async function abortTask(taskId: string): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/progress/${taskId}/abort`, { method: "POST" });
    return r.ok;
  } catch {
    return false;
  }
}

export interface Job {
  id: string;
  algorithm_id: string;
  algorithm_name: string;
  filename: string;
  params?: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  percentage: number;
  progress_status: string;
  created_at: number;
  error?: string | null;
  /** A known cause of the failure, e.g. "prom_unavailable"; the UI says it in its language. */
  error_code?: string | null;
  notes?: string | null;
  result?: AnalysisResult | null;
}

export async function fetchJobs(): Promise<Job[]> {
  const r = await fetch(`${BASE}/jobs`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load jobs`);
  const data = await r.json();
  return data.jobs;
}

export async function fetchJobDetail(jobId: string): Promise<Job> {
  const r = await fetch(`${BASE}/jobs/${jobId}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load job details`);
  return r.json();
}

export async function deleteJob(jobId: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}`, { method: "DELETE" });
}

export async function deleteAllJobs(): Promise<void> {
  await fetch(`${BASE}/jobs`, { method: "DELETE" });
}

export async function updateJobNotes(jobId: string, notes: string | null): Promise<void> {
  const r = await fetch(`${BASE}/jobs/${jobId}/notes`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: notes && notes.trim() ? notes.trim() : null }),
  });
  if (!r.ok) throw new Error(`Failed to update notes (${r.status})`);
}

// ----------------------- Factor analysis -----------------------
// Mirrors the /factor-analysis endpoints of the AlgoService.

export type FactorKind = "model" | "log";
export type DatasetSource = "bundled" | "csv" | "logs" | "pnml";
export type Rotation = "varimax" | "promax" | "oblimin" | "quartimax" | "none";
export const ROTATIONS: Rotation[] = ["varimax", "promax", "oblimin", "quartimax", "none"];

/**
 * How measures join factors: "largest" each to the factor it loads on most (ComFy's report),
 * "multi" also to every factor within a small gap of the largest loading (Important Factors,
 * Tab. 6-16), "hair" without the measures that load on more than one factor (Tab. 17).
 */
export type AssignmentRule = "largest" | "multi" | "hair";
export const ASSIGNMENT_RULES: AssignmentRule[] = ["largest", "multi", "hair"];

/**
 * Upload limits of one dataset request, as the server enforces them: `limits` of the catalog
 * and GET /factor-analysis/limits. The counts are set by the operator (MAX_LOG_FILES,
 * MAX_PNML_FILES).
 */
export interface UploadLimits {
  max_log_files: number;
  max_pnml_files: number;
  max_file_bytes: number;
  /** Budget over all files of one request. */
  max_total_bytes: number;
}

/** The server's defaults, for as long as it has not reported its own. */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  max_log_files: 50,
  max_pnml_files: 200,
  max_file_bytes: 100 * 1024 * 1024,
  max_total_bytes: 500 * 1024 * 1024,
};

/** Where a measure is implemented: the function of ComFy or feeed behind it, with a link to its file. */
export interface MeasureSource {
  /** The tool: "ComFy" or "feeed". */
  name: string;
  /** The function or method, e.g. "measure_size" or "TraceLength.trace_len_min". */
  function: string;
  file: string;
  /** The short commit the link points at. */
  commit: string;
  url: string;
}

export interface FactorMeasure {
  key: string;
  name: string;
  description: string;
  slow?: boolean;
  group?: string;
  /** The short code the papers print, e.g. "CNC"; absent from older servers. */
  short?: string;
  /** Where it is implemented; absent from older servers. */
  source?: MeasureSource;
}

/** The distribution of the values of a measure: counts in equal-width bins from `min` to `max`. */
export interface Histogram {
  min: number;
  max: number;
  counts: number[];
}

/** Statistics of one measure, as ComFy's report prints them; null where there is no value. */
export interface DescriptiveRow {
  measure: string;
  /** The values the statistics rest on; missing ones are not counted. */
  n: number;
  mean: number | null;
  median: number | null;
  /** Sample standard deviation (ddof = 1). */
  std: number | null;
  min: number | null;
  max: number | null;
  /** Why the cleaning left the measure out of the matrix, if it did. */
  dropped: DropReason | null;
  /** The values counted in bins; null without values, absent from older servers. */
  histogram?: Histogram | null;
}

export interface Descriptives {
  /** "input": the table before cleaning, as ComFy describes it; "cleaned": only the matrix was kept. */
  basis: "input" | "cleaned";
  n_rows: number;
  measures: DescriptiveRow[];
}

export interface NetSize {
  places: number;
  transitions: number;
  arcs: number;
}

/** One input file of a computed dataset: its size and the seconds to read it. */
export interface MeasurementInput {
  input: string;
  read_s?: number;
  events?: number;
  traces?: number;
  variants?: number;
  activities?: number;
  net?: NetSize | null;
  error?: string;
}

/** One row of a computed dataset: the seconds of each stage and the size of its net. */
export interface MeasurementObservation {
  observation: string;
  input: string;
  miner?: string;
  /** Wall time including the wait for ProM4Py; `discovery_run_s` is the call alone. */
  discovery_s?: number;
  discovery_run_s?: number;
  net?: NetSize | null;
  /** Seconds per measure (model) or feature group (log). */
  stages?: Record<string, number>;
  measures_s?: number;
  features_s?: number;
  error?: string;
}

/** Run times (wall time, seconds) and input sizes of a dataset the tool computed. */
export interface Measurement {
  kind: FactorKind;
  source: string;
  unit: "seconds";
  total_s: number;
  inputs: MeasurementInput[];
  observations: MeasurementObservation[];
}

/** Wall times of an analysis; a cached fit keeps the time its computation took. */
export interface AnalysisTimings {
  suitability_s: number;
  parallel_analysis_s: number;
  parallel_analysis_cached: boolean;
  fit_s: number;
  fit_cached: boolean;
  total_s: number;
}

export interface BundledDataset {
  id: string;
  name: string;
  description: string;
  observations: number;
  measures: number;
  citation?: string;
  license?: string;
  /** Short name within its collection, e.g. the miner. */
  label?: string;
  /** Id of the paper (collection) the dataset belongs to. */
  collection?: string;
  /** The settings of the paper the dataset comes from; "Paper settings" in the UI. */
  published_options?: AnalyzeOptions;
  /** The paper, as a citation, e.g. "Important Factors, ATAED 2026, Tab. 10–12". */
  published_source?: string;
  /**
   * "paper" if the paper analyses the dataset with these settings, "report" if only the report
   * in the tool's repository does, with the paper's settings; absent from older servers.
   */
  published_scope?: PublishedScope | string;
}

export type PublishedScope = "paper" | "report";

/** A paper whose bundled datasets the data step lists together. */
export interface DatasetCollection {
  id: string;
  name: string;
  venue?: string;
  description: string;
  /** A caveat that applies to all datasets of the paper. */
  note?: string;
  citation?: string;
  license?: string;
  source_url?: string;
}

/** Bundled input files for the logs or pnml source; sent as `bundled_id` without files. */
export interface SampleInput {
  id: string;
  name: string;
  description: string;
  source: "logs" | "pnml";
  files: string[];
  license?: string;
  citation?: string;
}

export interface FactorCatalog {
  kind: FactorKind;
  measures: FactorMeasure[];
  miners?: { key: string; name: string; slow?: boolean }[];
  groups?: { key: string; name: string; description: string; slow?: boolean }[];
  defaults: { measures: string[]; miners?: string[]; groups?: string[] };
  bundled: BundledDataset[];
  collections?: DatasetCollection[];
  samples?: SampleInput[];
  sources: DatasetSource[];
  limits?: UploadLimits;
}

export type DropReason = "non_numeric" | "constant" | "missing" | "duplicate";

export interface FactorDataset {
  id: string;
  kind: FactorKind;
  name: string;
  /** The server made the name up from the inputs, in English; see `datasetName`. */
  name_auto: boolean;
  source: string;
  status: "computing" | "ready" | "failed";
  /** For a bundled dataset, its id in the catalog, which names it in the UI language. */
  bundled_id?: string | null;
  job_id?: string;
  error?: string;
  progress?: number;
  n_observations: number;
  measures: string[];
  observations: string[];
  /** Row-major, the first `rows` rows only (at most 2000). */
  values: (number | null)[][];
  truncated: boolean;
  dropped: { measure: string; reason: DropReason; detail?: string; params?: Record<string, string | number> }[];
  dropped_rows: number;
  /** Inputs that gave no or incomplete values, e.g. a miner that failed on a log. */
  failures?: { input: string; error: string }[];
  created_at: string;
  inputs?: InputsSummary;
  /** The options of the last analysis, saved with the dataset; null before the first one. */
  options?: AnalyzeOptions | null;
  /** Of a ready dataset: the statistics of its measures; absent from older servers. */
  descriptives?: Descriptives | null;
  /** Of a dataset the tool computed from logs or nets: run times and input sizes, else null. */
  measurement?: Measurement | null;
  /**
   * Of a model dataset whose rows are "<log> / <miner>": per miner its rows and the measures that
   * vary within them; null for other datasets, absent from older servers.
   */
  miners?: MinerSummary[] | null;
}

/** The rows of one miner of a model dataset discovered with several miners. */
export interface MinerSummary {
  name: string;
  n_observations: number;
  /** The measures that vary within the rows of the miner. */
  n_measures: number;
  /** The measures without variance (or with a perfectly correlated twin) within them. */
  dropped: string[];
}

/** What a dataset was built from. */
export interface InputsSummary {
  /** Input files, uploaded or of a sample; 1 for a CSV, 0 for a bundled dataset. */
  files: number;
  miners?: string[];
  measures?: string[];
  groups?: string[];
  sample_id?: string;
}

/** A dataset of the session as listed by GET /factor-analysis/datasets. */
export interface DatasetSummary {
  id: string;
  kind: FactorKind;
  name: string;
  name_auto: boolean;
  source: DatasetSource;
  status: FactorDataset["status"];
  created_at: string;
  /** null while the dataset is computed or after it failed. */
  n_observations: number | null;
  n_measures: number | null;
  bundled_id: string | null;
  job_id: string | null;
  inputs: InputsSummary;
  has_options: boolean;
}

export interface CreateDatasetInput {
  kind: FactorKind;
  source: DatasetSource;
  bundledId?: string;
  measures?: string[];
  miners?: string[];
  groups?: string[];
  name?: string;
  files?: File[];
}

export type CreateDatasetResponse =
  /** `reused`: the session had a ready copy of the bundled dataset, and this is it. */
  | { dataset_id: string; status: "ready"; reused?: boolean }
  | { dataset_id: string; status: "computing"; job_id: string };

export interface AnalyzeOptions {
  excluded?: string[];
  auto_msa_filter?: boolean;
  msa_threshold?: number;
  bartlett_alpha?: number;
  /** null lets the backend use its suggestion. */
  n_factors?: number | null;
  rotation?: Rotation;
  /** null uses the default of the kind: 0.35 for model, 0.5 for log measures. */
  loading_threshold?: number | null;
  /** null uses the default of the kind: 0 for model, 0.5 for log measures. */
  communality_threshold?: number | null;
  /** Default "largest". */
  assignment_rule?: AssignmentRule;
  /** Of a model dataset discovered with several miners: the rows of this miner only. */
  miner?: string | null;
  /** Names of the factors, the first for factor 1; the exports use them, the analysis does not. */
  factor_names?: (string | null)[] | null;
}

/** Why a measure joined no factor. */
export type UnassignedReason = "low_loading" | "low_communality" | "cross_loading";

/** A measure whose loadings on several factors count under the assignment rule. */
export interface CrossLoading {
  measure: string;
  /** Counting from 0, like the columns of `loadings`. */
  factors: number[];
  /** One per factor in `factors`. */
  loadings: number[];
}

/** The factor counts the criteria suggest, on the eigenvalues of the scree plot. */
export interface FactorCount {
  /** Eigenvalues above 1. */
  kaiser: number;
  /** Horn's parallel analysis: eigenvalues above `percentile` of random normal data. */
  parallel_analysis: number;
  /** The percentile of the random eigenvalues, one per eigenvalue of the data. */
  eigenvalues_random: number[];
  seed: number;
  simulations: number;
  percentile: number;
}

/** A value of the analysis that differs from the published report. */
export interface PublishedDifference {
  /** What it belongs to: "bartlett", "kmo", "msa" or "loadings". */
  key: string;
  /** Names the value, e.g. "loading" or "msa_removed"; see factor.match.diff in the locales. */
  code?: string;
  /** The same in English, for a code this UI does not know. */
  what: string;
  measure?: string;
  /** Counting from 0. */
  factor?: number;
  /** Numbers, or lists and objects where a set of measures differs. */
  expected: unknown;
  actual: unknown;
}

/** How the paper's own tables relate to the report: "matches" prints the same numbers. */
export type PaperTables = "matches" | "msa_only" | "extra_dup_column" | "other_data" | "not_in_paper";

/** How the numbers compare with the report the dataset was published with. */
export interface PublishedMatch {
  status: "match" | "differs";
  /** What was compared, e.g. "bartlett", "kmo", "msa", "loadings". */
  compared: string[];
  differences: PublishedDifference[];
  tolerance: number;
  /** The report and its commit, in English. */
  source: string;
  /** The same in parts. */
  report?: { repository: string; commit: string; file: string };
  paper_tables?: PaperTables | string | null;
  /** The tables meant, e.g. "Tab. 10–11". */
  paper_tables_ref?: string | null;
  /** The same in English, for a key this UI does not know. */
  paper_tables_note?: string | null;
}

/** A message of the analysis; `code` and `params` select the translation. */
export interface AnalysisNotice {
  code: string;
  message: string;
  params: Record<string, string | number>;
}

export interface FactorAnalysis {
  n_observations: number;
  used_measures: string[];
  bartlett: {
    chi_square: number;
    df: number;
    p_value: number;
    alpha: number;
    passed: boolean;
    /** Eigenvalues near 0 were clamped, so chi-square reflects the floor more than the data. */
    regularised?: boolean;
  };
  kmo: { overall: number; per_measure: Record<string, number>; threshold: number; passed: boolean };
  msa_filter: { enabled: boolean; removed: { measure: string; msa: number; step: number }[] };
  eigenvalues: number[];
  suggested_n_factors: number;
  n_factors: number;
  rotation: string;
  loading_threshold: number;
  communality_threshold: number;
  /** Measure -> one loading per factor; the pattern matrix for oblique rotations. */
  loadings: Record<string, number[]>;
  /** Oblique rotations only: correlations between measures and factors. */
  structure_loadings: Record<string, number[]> | null;
  /** Oblique rotations only: correlations among the factors. */
  factor_correlations: number[][] | null;
  communalities: Record<string, number>;
  uniquenesses: Record<string, number>;
  variance: {
    ss_loadings: number[];
    /** null for oblique rotations, where the shares of correlated factors do not add up. */
    proportion: number[] | null;
    cumulative: number[] | null;
    /** Share of the total variance all factors explain together. */
    explained: number;
  };
  /** `index` counts from 0, like the columns of `loadings`. Under "multi" a measure can be in several. */
  factors: { index: number; measures: { measure: string; loading: number }[] }[];
  /** The measures without a factor; their reasons are in `unassigned_details`. */
  unassigned: string[];
  /** Why each measure of `unassigned` joined no factor; absent before the assignment rules. */
  unassigned_details?: { measure: string; reason: UnassignedReason }[];
  /** Absent before the assignment rules, which is "largest". */
  assignment_rule?: AssignmentRule;
  /** The rule as applied; absent before the assignment rules. */
  assignment?: {
    rule: AssignmentRule;
    loading_threshold: number;
    /** A loading counts if it exceeds the threshold, rather than reaches it ("multi", "hair"). */
    loading_strict: boolean;
    /** The communality an assigned measure needed: the threshold asked for or the rule's minimum. */
    communality_threshold: number;
    cross_loading_gap: number;
    cross_loaded: "largest" | "all" | "none";
  };
  cross_loadings?: CrossLoading[];
  factor_count?: FactorCount;
  /** Only when the dataset has published numbers and the analysis used the published settings. */
  published_match?: PublishedMatch | null;
  /** The rows of one miner the analysis ran on; null for every row, absent from older servers. */
  miner?: MinerSelection | null;
  /** Time the server took for the analysis. */
  elapsed_ms?: number;
  /** The time of each part of the analysis; absent from older servers. */
  timings?: AnalysisTimings;
  warnings: string[];
  warning_details?: AnalysisNotice[];
}

/** The rows of one miner an analysis ran on. */
export interface MinerSelection {
  name: string;
  n_observations: number;
  n_measures: number;
  /** Measures without variance within the miner, or with a perfectly correlated twin in it. */
  dropped: { measure: string; reason: DropReason | string; detail?: string; params?: Record<string, string | number> }[];
}

/**
 * Error with the HTTP status, so callers can tell a missing dataset from a bad request.
 * `code` and `params` come with errors the UI can translate, e.g. analysis errors.
 */
export class HttpError extends Error {
  status: number;
  code?: string;
  params?: Record<string, string | number>;

  constructor(message: string, status: number, code?: string, params?: Record<string, string | number>) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.params = params;
  }
}

/**
 * A newer analysis of the same dataset in the same session replaced this one before it ran
 * (409 "superseded"); its answer is the one that counts.
 */
export function isSuperseded(e: unknown): boolean {
  return e instanceof HttpError && e.status === 409 && (e.code === "superseded" || /superseded/i.test(e.message));
}

async function httpError(r: Response, fallback: string): Promise<HttpError> {
  try {
    const j = await r.json();
    const code = typeof j.code === "string" ? j.code : undefined;
    const params = j.params && typeof j.params === "object" ? j.params : undefined;
    if (typeof j.detail === "string") return new HttpError(j.detail, r.status, code, params);
    // FastAPI validation errors (422) come as a list of {loc, msg}.
    if (Array.isArray(j.detail)) {
      const text = j.detail
        .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg ?? ""}`)
        .join("; ");
      return new HttpError(text, r.status);
    }
    if (j.detail) return new HttpError(JSON.stringify(j.detail), r.status, code, params);
  } catch {}
  return new HttpError(`${fallback} (${r.status})`, r.status, r.status === 429 ? "rate_limited" : undefined);
}

export async function fetchFactorCatalog(kind: FactorKind, signal?: AbortSignal): Promise<FactorCatalog> {
  const r = await fetch(`${BASE}/factor-analysis/catalog?kind=${kind}`, { cache: "no-store", signal });
  if (!r.ok) throw await httpError(r, "Failed to load the catalog");
  return r.json();
}

export async function fetchUploadLimits(signal?: AbortSignal): Promise<UploadLimits> {
  const r = await fetch(`${BASE}/factor-analysis/limits`, { cache: "no-store", signal });
  if (!r.ok) throw await httpError(r, "Failed to load the upload limits");
  return r.json();
}

export async function createDataset(input: CreateDatasetInput): Promise<CreateDatasetResponse> {
  const form = new FormData();
  form.append("kind", input.kind);
  form.append("source", input.source);
  if (input.bundledId) form.append("bundled_id", input.bundledId);
  if (input.measures) form.append("measures", JSON.stringify(input.measures));
  if (input.miners) form.append("miners", JSON.stringify(input.miners));
  if (input.groups) form.append("groups", JSON.stringify(input.groups));
  if (input.name) form.append("name", input.name);
  for (const f of input.files ?? []) form.append("files", f);
  const r = await fetch(`${BASE}/factor-analysis/datasets`, { method: "POST", body: form });
  if (!r.ok) throw await httpError(r, "Could not create the dataset");
  return r.json();
}

export async function fetchDataset(id: string, signal?: AbortSignal, rows?: number): Promise<FactorDataset> {
  const query = rows === undefined ? "" : `?rows=${rows}`;
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}${query}`, {
    cache: "no-store",
    signal,
  });
  if (!r.ok) throw await httpError(r, "Failed to load the dataset");
  return r.json();
}

/** The datasets of the session, newest first; all kinds without `kind`. */
export async function listDatasets(kind?: FactorKind, signal?: AbortSignal): Promise<DatasetSummary[]> {
  const query = kind ? `?kind=${kind}` : "";
  const r = await fetch(`${BASE}/factor-analysis/datasets${query}`, { cache: "no-store", signal });
  if (!r.ok) throw await httpError(r, "Failed to load the datasets");
  return (await r.json()).datasets;
}

/** Remembers the options of an analysis with the dataset, so reopening it starts from them. */
export async function saveDatasetOptions(id: string, options: AnalyzeOptions): Promise<void> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/options`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    // Sent when the page is left, too.
    keepalive: true,
  });
  if (!r.ok) throw await httpError(r, "Could not save the options");
}

/** Deletes a dataset; a computing one has its job aborted and removed as well. */
export async function deleteDataset(id: string): Promise<void> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw await httpError(r, "Could not delete the dataset");
}

/** Deletes every dataset of the session, or those of one kind; returns how many. */
export async function deleteAllDatasets(kind?: FactorKind): Promise<number> {
  const query = kind ? `?kind=${kind}` : "";
  const r = await fetch(`${BASE}/factor-analysis/datasets${query}`, { method: "DELETE" });
  if (!r.ok) throw await httpError(r, "Could not delete the datasets");
  return (await r.json()).deleted;
}

export function datasetDownloadUrl(id: string): string {
  return `${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/download`;
}

/**
 * The analysis with these options. A newer analysis of the same dataset in the session replaces
 * this one (409 "superseded"), unless `latestWins` is false, e.g. for the print view, which must
 * not take the place of the analysis of the tab it was opened from.
 */
export async function analyzeDataset(
  id: string,
  options: AnalyzeOptions,
  signal?: AbortSignal,
  { latestWins = true }: { latestWins?: boolean } = {},
): Promise<FactorAnalysis> {
  const query = latestWins ? "" : "?latest_wins=false";
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/analyze${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal,
  });
  if (!r.ok) throw await httpError(r, "Analysis failed");
  return r.json();
}

/** One pair of measures whose correlation reaches the limit of the map. */
export interface CorrelationPair {
  a: string;
  b: string;
  r: number;
}

/** The correlations of the measures of a dataset (POST /datasets/{id}/correlations). */
export interface Correlations {
  n_observations: number;
  order: CorrelationOrder;
  /** The measures in the order asked for, as the rows and columns of `r`. */
  measures: string[];
  r: number[][];
  /** Under the order "factor": the dimensions with their measures, then those without one (factor null). */
  groups: { factor: number | null; measures: string[] }[] | null;
  /** The pairs with |r| of `threshold` or more, strongest first; `count` says how many there are. */
  high: { threshold: number; count: number; pairs: CorrelationPair[] };
  /** For each measure its five closest partners by |r|. */
  top: Record<string, { measure: string; r: number }[]>;
  miner: MinerSelection | null;
}

/**
 * The correlations of the measures of a dataset, or of the rows of the `miner` in `options`; the
 * measures the options exclude are left out. The map loads them when it is opened, and the fact
 * sheet of a measure takes its closest partners from them.
 */
export async function fetchCorrelations(
  id: string,
  options: AnalyzeOptions,
  order: CorrelationOrder = "cluster",
  signal?: AbortSignal,
): Promise<Correlations> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/correlations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, order }),
    signal,
  });
  if (!r.ok) throw await httpError(r, "The correlations could not be loaded");
  return r.json();
}

export async function exportLoadings(
  id: string,
  options: AnalyzeOptions,
  format: "csv" | "latex",
): Promise<{ blob: Blob; filename: string }> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, format }),
  });
  if (!r.ok) throw await httpError(r, "Export failed");
  return attachment(r, `loadings.${format === "csv" ? "csv" : "tex"}`);
}

/**
 * Downloads the whole analysis as a ZIP: the dataset, every result table, the interpretation
 * if one is stored for these options and language, and a manifest to reproduce it. The rows of
 * its loadings heatmap follow `order` and the measures of its correlation map `correlationOrder`,
 * as the figure menu draws them; its figures are English, as a paper is.
 */
export async function downloadAnalysisZip(
  id: string,
  options: AnalyzeOptions,
  language: InterpretationLanguage,
  {
    shortCodes = false,
    order = "factor",
    correlationOrder = "factor",
  }: { shortCodes?: boolean; order?: FigureOrder; correlationOrder?: CorrelationOrder } = {},
): Promise<void> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/export/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, language, short_codes: shortCodes, order, correlation_order: correlationOrder }),
  });
  if (!r.ok) throw await httpError(r, "Export failed");
  const { blob, filename } = await attachment(r, "factor-analysis.zip");
  downloadBlob(blob, filename);
}

/**
 * The analysis as a LaTeX report built like ComFy's; the factors are named after an
 * interpretation stored for these options in `language`, if there is one.
 */
export async function exportReport(
  id: string,
  options: AnalyzeOptions,
  language: InterpretationLanguage,
  shortCodes = false,
): Promise<{ blob: Blob; filename: string }> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/export/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, language, short_codes: shortCodes }),
  });
  if (!r.ok) throw await httpError(r, "Export failed");
  return attachment(r, "report.tex");
}

export type FigureName = "scree" | "loadings" | "correlations";
export type FigureFormat = "svg" | "png";
/** The rows of the loadings heatmap: grouped by factor as the UI shows them, or as in the dataset. */
export type FigureOrder = "factor" | "dataset";
/** The order of the measures of the correlation map: as in the dataset, clustered, or by dimension. */
export type CorrelationOrder = "dataset" | "cluster" | "factor";

/**
 * A figure of the analysis in the print style: SVG with its text as text, or PNG at 300 dpi, with
 * its labels in `language`. Like every export it runs the analysis it shows without replacing
 * the one on screen.
 */
export async function exportFigure(
  id: string,
  options: AnalyzeOptions,
  figure: FigureName,
  format: FigureFormat,
  {
    shortCodes = false,
    order = "factor",
    language = "en",
    correlationOrder = "factor",
  }: {
    shortCodes?: boolean;
    order?: FigureOrder;
    language?: InterpretationLanguage;
    correlationOrder?: CorrelationOrder;
  } = {},
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/export/figure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...options,
      figure,
      format,
      short_codes: shortCodes,
      order,
      language,
      correlation_order: correlationOrder,
    }),
    signal,
  });
  if (!r.ok) throw await httpError(r, "Export failed");
  return attachment(r, `${figure}.${format}`);
}

// ----------------------- Comparing factor structures -----------------------

/**
 * One column of a comparison: a bundled dataset with the settings of its paper or the standard, or a
 * dataset of the session with the settings saved with it or the standard, of one miner's rows.
 */
export interface CompareColumnRequest {
  bundled_id?: string;
  dataset_id?: string;
  miner?: string;
  settings?: "paper" | "standard" | "saved";
  /** Changes to those settings, e.g. another factor count; the rule is the comparison's. */
  options?: Partial<Omit<AnalyzeOptions, "assignment_rule">>;
  label?: string;
}

export interface CompareRequest {
  columns: CompareColumnRequest[];
  assignment_rule: AssignmentRule;
}

export type CompareExportFormat = "csv" | "latex" | "zip";

/** The header of a column; without `error` it has every field of an analysis. */
export interface CompareColumn {
  /** null for a dataset of the session. */
  bundled_id: string | null;
  /** A dataset of the session, and the miner whose rows the column has. */
  dataset_id?: string | null;
  miner?: string | null;
  label: string;
  name: string;
  collection?: string | null;
  settings: "paper" | "standard" | "saved";
  options: AnalyzeOptions;
  published_source: string | null;
  paper_tables: PaperTables | string | null;
  /** The measures of the dataset, before cleaning and the MSA filter. */
  n_measures: number;
  n_observations?: number;
  /** What the rule applied: its communality threshold is the higher of the parameter and the rule's minimum. */
  assignment?: NonNullable<FactorAnalysis["assignment"]>;
  used_measures?: string[];
  msa_removed?: string[];
  kmo?: number;
  n_factors?: number;
  rotation?: Rotation;
  /** Null for an oblique rotation, whose shares do not add up. */
  cumulative_variance?: number | null;
  explained_variance?: number;
  factor_count?: { kaiser: number; parallel_analysis: number };
  warnings?: AnalysisNotice[];
  timings?: AnalysisTimings;
  /** The dimension of each factor of the column, from 0. */
  factor_dimensions?: number[];
  /** How many measures each factor shares with its dimension in the columns before it. */
  shared_measures?: number[];
  /** Those measures, per factor, in the order of the data. */
  matched_by?: string[][];
  /** How alike each factor is to the factors before it in its dimension (Tucker's congruence, 0 to 1); null where there are none. */
  congruence?: (number | null)[];
  /** An earlier column with the same loadings, e.g. the Alpha Dollar miner of the Alpha miner. */
  same_as?: number | null;
  error?: AnalysisNotice;
}

/** What a column says about a measure. Dimensions count from 0. */
export type CompareCell =
  | {
      status: "assigned";
      factors: number[];
      dimensions: number[];
      loadings: number[];
      communality: number;
      cross_loading: boolean;
      cross_dimensions?: number[];
      cross_loadings?: number[];
    }
  | {
      status: "unassigned";
      reason: UnassignedReason | null;
      factor: number;
      dimension: number;
      loading: number;
      communality: number;
      cross_loading: boolean;
      cross_dimensions?: number[];
      cross_loadings?: number[];
    }
  | { status: "msa_removed"; msa: number; step: number }
  | { status: "dropped"; reason: DropReason | string }
  | { status: "excluded" | "absent" | "failed" };

export interface CompareRow {
  measure: string;
  short: string | null;
  /** The dimension most columns put the measure in; null if none does. */
  dimension: number | null;
  /** How many columns put it there. */
  agreement: number;
  cells: CompareCell[];
}

/** Square, symmetric matrices indexed by `measures` (the order of the rows of the comparison). */
export interface CoAssignment {
  measures: string[];
  /** The columns in which both measures are in one dimension. */
  together: number[][];
  /** The columns in which both are in some dimension. */
  both_assigned: number[][];
  /** The columns that analysed both, in a dimension or not. */
  both_analysed: number[][];
}

export interface Comparison {
  kind: FactorKind;
  assignment_rule: AssignmentRule;
  cross_loading_gap: number;
  alignment: { method: string; reference: number; description: string; dimensions: number };
  columns: CompareColumn[];
  /** Grouped by dimension, those in none last. */
  measures: CompareRow[];
  /** For every pair of measures, in how many columns both are in the same dimension. */
  co_assignment: CoAssignment;
  /** Per dimension and column: the factor of the column and its measures, in the order of the data. */
  dimensions: {
    index: number;
    columns: ({ factor: number | null; measures: { measure: string; loading: number }[] } | null)[];
  }[];
  /** Per column the measures in no dimension, or null for a column that failed. */
  unassigned: ({ measure: string; reason: UnassignedReason }[] | null)[];
  elapsed_ms?: number;
}

/**
 * The factor structures of 2 to 8 analyses side by side, like Tab. 17 of Important Factors: of
 * bundled datasets or of datasets of the session.
 */
export async function compareAnalyses(body: CompareRequest, signal?: AbortSignal): Promise<Comparison> {
  const r = await fetch(`${BASE}/factor-analysis/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok) throw await httpError(r, "Comparison failed");
  return r.json();
}

/**
 * The comparison as CSV (measures by analyses), as a LaTeX tabular like Tab. 17, or as a ZIP with
 * both, the full result and a manifest; the measures by their short codes or by their names.
 */
export async function exportComparison(
  body: CompareRequest,
  format: CompareExportFormat,
  shortCodes: boolean,
): Promise<{ blob: Blob; filename: string }> {
  const r = await fetch(`${BASE}/factor-analysis/compare/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, format, short_codes: shortCodes }),
  });
  if (!r.ok) throw await httpError(r, "Export failed");
  return attachment(r, `factor-structures.${format === "latex" ? "tex" : format}`);
}

async function attachment(r: Response, fallback: string): Promise<{ blob: Blob; filename: string }> {
  const disposition = r.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return { blob: await r.blob(), filename: match ? decodeURIComponent(match[1]) : fallback };
}

// ----------------------- Interpretation by Claude -----------------------

export interface InterpretationStatus {
  /** A key is configured on the server, so factors can be interpreted live. */
  available: boolean;
  model: string | null;
  /** No key, but precomputed interpretations of bundled datasets exist. */
  precomputed_only: boolean;
}

export type InterpretationLanguage = "en" | "de";

export interface FactorInterpretation {
  /** Counts from 1, as in "Factor 1"; `factors[].index` of the analysis counts from 0. */
  factors: {
    index: number;
    name: string;
    summary: string;
    driving_measures: string[];
    confidence: "low" | "medium" | "high";
  }[];
  overall: string;
  caveats: string[];
  /** The model that wrote it. */
  model: string;
  created_at: string;
  language: InterpretationLanguage;
  prompt_version: string;
  /** No model call was made for this request. */
  cached: boolean;
  precomputed: boolean;
}

export async function fetchInterpretationStatus(signal?: AbortSignal): Promise<InterpretationStatus> {
  const r = await fetch(`${BASE}/factor-analysis/interpretation/status`, { cache: "no-store", signal });
  if (!r.ok) throw await httpError(r, "Failed to check the interpretation");
  return r.json();
}

/**
 * Interpretation of the analysis with these options. With `cachedOnly` the server never calls
 * the model and the result is null when nothing is stored for these options yet.
 */
export async function interpretDataset(
  id: string,
  options: AnalyzeOptions,
  language: InterpretationLanguage,
  { cachedOnly = false, signal }: { cachedOnly?: boolean; signal?: AbortSignal } = {},
): Promise<FactorInterpretation | null> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/interpret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, language, cached_only: cachedOnly }),
    signal,
  });
  if (r.status === 204) return null;
  if (!r.ok) throw await httpError(r, "Interpretation failed");
  return r.json();
}
