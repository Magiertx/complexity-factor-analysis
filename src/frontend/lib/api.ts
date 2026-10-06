// Typed client for the AlgoService backend.
// Mirrors src/AlgoService/algorithms/base.py.

import { downloadBlob } from "./factor-analysis";

export type ParameterType = "int" | "float" | "bool" | "enum" | "multi_enum" | "string";
// Open string; the backend's `/algorithms` response carries the authoritative
// `categories` list (id + label), and the frontend renders whichever ids show
// up. Keeping this typed as a closed Literal would make every new category a
// frontend change. Known id today: "complexity". TOOL_TYPE_LABEL covers it;
// unknown ids fall back to the raw id at the call sites.
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
    try {
      const j = await r.json();
      if (j.detail) {
        if (typeof j.detail === "object" && j.detail !== null && j.detail.type === "validation_error") {
          throw new ValidationError(j.detail.message || "Please fix validation errors.", j.detail.errors || {});
        }
        msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
      }
    } catch (e) {
      if (e instanceof ValidationError) throw e;
    }
    throw new Error(msg);
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

// Fallback labels for tool_type ids the frontend ships with. The /algorithms
// response also carries a `categories` array with the authoritative labels;
// prefer that when available; this map only covers ids that aren't in the
// response (defensive) and gives a stable default at top-level.
export const TOOL_TYPE_LABEL: Record<string, string> = {
  complexity: "Complexity analysis",
};

// ----------------------- Factor analysis -----------------------
// Mirrors the /factor-analysis endpoints of the AlgoService.

export type FactorKind = "model" | "log";
export type DatasetSource = "bundled" | "csv" | "logs" | "pnml";
export type Rotation = "varimax" | "promax" | "oblimin" | "quartimax" | "none";
export const ROTATIONS: Rotation[] = ["varimax", "promax", "oblimin", "quartimax", "none"];

/** Upload limits per source, as enforced by the backend. */
export const MAX_DATASET_FILES: Partial<Record<DatasetSource, number>> = { logs: 50, pnml: 200 };
/** Budget over all files of one dataset request. */
export const MAX_DATASET_TOTAL_BYTES = 500 * 1024 * 1024;

export interface FactorMeasure {
  key: string;
  name: string;
  description: string;
  slow?: boolean;
  group?: string;
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
}

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
  | { dataset_id: string; status: "ready" }
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
  /** `index` counts from 0, like the columns of `loadings`. */
  factors: { index: number; measures: { measure: string; loading: number }[] }[];
  unassigned: string[];
  warnings: string[];
  warning_details?: AnalysisNotice[];
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

export async function analyzeDataset(
  id: string,
  options: AnalyzeOptions,
  signal?: AbortSignal,
): Promise<FactorAnalysis> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
    signal,
  });
  if (!r.ok) throw await httpError(r, "Analysis failed");
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
 * if one is stored for these options and language, and a manifest to reproduce it.
 */
export async function downloadAnalysisZip(
  id: string,
  options: AnalyzeOptions,
  language: InterpretationLanguage,
): Promise<void> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}/export/zip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...options, language }),
  });
  if (!r.ok) throw await httpError(r, "Export failed");
  const { blob, filename } = await attachment(r, "factor-analysis.zip");
  downloadBlob(blob, filename);
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
