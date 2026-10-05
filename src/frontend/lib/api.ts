// Typed client for the AlgoService backend.
// Mirrors src/AlgoService/algorithms/base.py.

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

export async function abortTask(taskId: string): Promise<void> {
  try {
    await fetch(`${BASE}/progress/${taskId}/abort`, { method: "POST" });
  } catch {
    // Ignore error
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
  miners?: { key: string; name: string }[];
  groups?: { key: string; name: string; description: string }[];
  defaults: { measures: string[]; miners?: string[]; groups?: string[] };
  bundled: BundledDataset[];
  samples?: SampleInput[];
  sources: DatasetSource[];
}

export type DropReason = "non_numeric" | "constant" | "missing" | "duplicate";

export interface FactorDataset {
  id: string;
  kind: FactorKind;
  name: string;
  source: string;
  status: "computing" | "ready" | "failed";
  job_id?: string;
  error?: string;
  progress?: number;
  n_observations: number;
  measures: string[];
  observations: string[];
  /** Row-major, first 2000 rows only. */
  values: (number | null)[][];
  truncated: boolean;
  dropped: { measure: string; reason: DropReason; detail?: string }[];
  dropped_rows: number;
  created_at: string;
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
  loading_threshold?: number;
}

export interface FactorAnalysis {
  n_observations: number;
  used_measures: string[];
  bartlett: { chi_square: number; df: number; p_value: number; alpha: number; passed: boolean };
  kmo: { overall: number; per_measure: Record<string, number>; threshold: number; passed: boolean };
  msa_filter: { enabled: boolean; removed: { measure: string; msa: number; step: number }[] };
  eigenvalues: number[];
  suggested_n_factors: number;
  n_factors: number;
  rotation: string;
  /** Measure -> one loading per factor. */
  loadings: Record<string, number[]>;
  communalities: Record<string, number>;
  uniquenesses: Record<string, number>;
  variance: { ss_loadings: number[]; proportion: number[]; cumulative: number[] };
  factors: { index: number; measures: { measure: string; loading: number }[] }[];
  unassigned: string[];
  warnings: string[];
}

async function errorMessage(r: Response, fallback: string): Promise<string> {
  try {
    const j = await r.json();
    if (typeof j.detail === "string") return j.detail;
    // FastAPI validation errors (422) come as a list of {loc, msg}.
    if (Array.isArray(j.detail)) {
      return j.detail
        .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg ?? ""}`)
        .join("; ");
    }
    if (j.detail) return JSON.stringify(j.detail);
  } catch {}
  return `${fallback} (${r.status})`;
}

/** Error with the HTTP status, so callers can tell a missing dataset from a bad request. */
export class HttpError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function fetchFactorCatalog(kind: FactorKind, signal?: AbortSignal): Promise<FactorCatalog> {
  const r = await fetch(`${BASE}/factor-analysis/catalog?kind=${kind}`, { cache: "no-store", signal });
  if (!r.ok) throw new HttpError(await errorMessage(r, "Failed to load the catalog"), r.status);
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
  if (!r.ok) throw new HttpError(await errorMessage(r, "Could not create the dataset"), r.status);
  return r.json();
}

export async function fetchDataset(id: string, signal?: AbortSignal): Promise<FactorDataset> {
  const r = await fetch(`${BASE}/factor-analysis/datasets/${encodeURIComponent(id)}`, {
    cache: "no-store",
    signal,
  });
  if (!r.ok) throw new HttpError(await errorMessage(r, "Failed to load the dataset"), r.status);
  return r.json();
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
  if (!r.ok) throw new HttpError(await errorMessage(r, "Analysis failed"), r.status);
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
  if (!r.ok) throw new HttpError(await errorMessage(r, "Export failed"), r.status);
  const disposition = r.headers.get("Content-Disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : `loadings.${format === "csv" ? "csv" : "tex"}`;
  return { blob: await r.blob(), filename };
}
