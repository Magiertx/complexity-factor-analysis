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

export interface BatchRunResponse {
  job_id: string;
  algorithm: string;
  log_count: number;
  status: string;
}

export async function runBatch(
  algorithmId: string,
  params: Record<string, unknown>,
  files: File[],
  sampleLogIds: string[],
  recentLogIds: string[],
  signal?: AbortSignal,
): Promise<BatchRunResponse> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (sampleLogIds.length > 0) form.append("sample_log_ids", JSON.stringify(sampleLogIds));
  if (recentLogIds.length > 0) form.append("recent_log_ids", JSON.stringify(recentLogIds));
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) form.append(k, String(item));
    } else {
      form.append(k, typeof v === "boolean" ? String(v) : (v as string));
    }
  }
  const r = await fetch(`${BASE}/algorithms/${algorithmId}/batch`, {
    method: "POST",
    body: form,
    signal,
  });
  if (!r.ok) {
    let msg = `Batch failed (${r.status})`;
    try {
      const j = await r.json();
      if (j.detail) {
        if (typeof j.detail === "object" && j.detail !== null && j.detail.type === "validation_error") {
          throw new ValidationError("Please fix parameter errors.", j.detail.errors || {});
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
