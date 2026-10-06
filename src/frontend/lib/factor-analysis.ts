// Helpers for the factor analysis view. Kept free of React so they stay easy to reuse.

import type { CSSProperties } from "react";
import type { AnalysisNotice, AnalyzeOptions, FactorAnalysis, FactorKind, InputsSummary, Job, Rotation } from "./api";

type Translate = (key: string, params?: Record<string, string | number>) => string;
type TranslateMaybe = (key: string, params?: Record<string, string | number>) => string | undefined;

export interface AnalysisOptions {
  excluded: string[];
  auto_msa_filter: boolean;
  msa_threshold: number;
  bartlett_alpha: number;
  /** null follows the suggestion of the backend (Kaiser criterion). */
  n_factors: number | null;
  rotation: Rotation;
  loading_threshold: number;
  /** Measures below this communality stay unassigned. */
  communality_threshold: number;
}

/** Same defaults as the backend: ComFy for model, ComFy for log measures for log measures. */
export function defaultOptions(kind: FactorKind): AnalysisOptions {
  return {
    excluded: [],
    auto_msa_filter: true,
    msa_threshold: 0.6,
    bartlett_alpha: 0.05,
    n_factors: null,
    rotation: "varimax",
    loading_threshold: kind === "log" ? 0.5 : 0.35,
    communality_threshold: kind === "log" ? 0.5 : 0,
  };
}

/**
 * Options saved with a dataset, completed with the defaults. Same key order as the defaults,
 * so options compare equal as JSON however they were made.
 */
export function optionsFromSaved(kind: FactorKind, saved: AnalyzeOptions): AnalysisOptions {
  const defaults = defaultOptions(kind);
  return {
    excluded: saved.excluded ?? [],
    auto_msa_filter: saved.auto_msa_filter ?? defaults.auto_msa_filter,
    msa_threshold: saved.msa_threshold ?? defaults.msa_threshold,
    bartlett_alpha: saved.bartlett_alpha ?? defaults.bartlett_alpha,
    n_factors: saved.n_factors ?? null,
    rotation: saved.rotation ?? defaults.rotation,
    loading_threshold: saved.loading_threshold ?? defaults.loading_threshold,
    communality_threshold: saved.communality_threshold ?? defaults.communality_threshold,
  };
}

/**
 * The options a dataset opens with: those saved with it, else the defaults. Exclusions of
 * measures the dataset no longer has are dropped.
 */
export function initialOptions(
  kind: FactorKind,
  saved: AnalyzeOptions | null | undefined,
  measures: string[],
): AnalysisOptions {
  if (!saved) return defaultOptions(kind);
  const options = optionsFromSaved(kind, saved);
  return { ...options, excluded: options.excluded.filter((m) => measures.includes(m)) };
}

/** localStorage keys of the factor analysis tabs, cleared with the datasets in the settings. */
export const STORAGE_PREFIXES = ["app.factor-dataset-", "app.factor-options-"];

/** Fewest measures the backend accepts for an analysis. */
export const MIN_MEASURES = 3;

/** Rows of a dataset the browser loads and shows as a preview. */
export const PREVIEW_ROWS = 8;

export const ORTHOGONAL: Rotation[] = ["varimax", "quartimax"];

// Params of analysis notices that the backend sends as text with digits of its choosing.
const NUMERIC_TEXT_PARAMS = ["overall", "p"];

/** The params of an analysis notice with its numbers as numbers, so the text shows them in the UI language. */
function noticeParams(params: Record<string, string | number>): Record<string, string | number> {
  const out = { ...params };
  for (const key of NUMERIC_TEXT_PARAMS) {
    const v = out[key];
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) out[key] = Number(v);
  }
  return out;
}

/** The notices of an analysis; older results carry only the English messages. */
export function analysisNotices(analysis: FactorAnalysis): AnalysisNotice[] {
  return analysis.warning_details ?? analysis.warnings.map((message) => ({ code: "", message, params: {} }));
}

/** A notice in the UI language where its code is known, else the English message. */
export function noticeText(notice: AnalysisNotice, tMaybe: TranslateMaybe): string {
  return (notice.code && tMaybe(`factor.warnings.${notice.code}`, noticeParams(notice.params))) || notice.message;
}

// Notices on the factor solution rather than the data: step 4 shows them next to the factor
// count and the rotation, which they ask to change, instead of step 3 with the tests.
const SOLUTION_NOTICES = ["not_identified", "heywood", "fit_not_converged", "single_factor_no_rotation"];
// Only says what happened; the solution itself is fine.
const INFO_NOTICES = ["single_factor_no_rotation"];

export function isSolutionNotice(notice: AnalysisNotice): boolean {
  return SOLUTION_NOTICES.includes(notice.code);
}

/** The factor solution needs attention, e.g. too many factors for the measures. */
export function solutionNeedsAttention(analysis: FactorAnalysis): boolean {
  return analysisNotices(analysis).some((n) => isSolutionNotice(n) && !INFO_NOTICES.includes(n.code));
}

export type KmoGrade =
  | "marvelous"
  | "meritorious"
  | "middling"
  | "mediocre"
  | "miserable"
  | "unacceptable";

/** Kaiser's (1974) verbal scale for KMO and MSA values. */
export function kmoGrade(value: number): KmoGrade {
  if (value >= 0.9) return "marvelous";
  if (value >= 0.8) return "meritorious";
  if (value >= 0.7) return "middling";
  if (value >= 0.6) return "mediocre";
  if (value >= 0.5) return "miserable";
  return "unacceptable";
}

// Diverging blue/red pair over the surface colour; the surface itself is the neutral midpoint.
const POSITIVE = "37 99 235";
const NEGATIVE = "220 38 38";

/** Background of a loading cell: hue by sign, opacity by magnitude. */
export function loadingStyle(value: number): CSSProperties {
  const alpha = Math.min(Math.abs(value), 1) * 0.55;
  const rgb = value >= 0 ? POSITIVE : NEGATIVE;
  return { backgroundColor: `rgb(${rgb} / ${alpha.toFixed(3)})` };
}

export function signColor(value: number): string {
  return `rgb(${value >= 0 ? POSITIVE : NEGATIVE})`;
}

/**
 * Measures in display order. "factor" groups them by assigned factor, strongest loading
 * first, with unassigned measures at the end; "original" keeps the dataset order.
 */
export function orderMeasures(analysis: FactorAnalysis, order: "factor" | "original"): string[] {
  if (order === "original") return analysis.used_measures;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const factor of analysis.factors) {
    for (const m of factor.measures) {
      if (!seen.has(m.measure)) {
        seen.add(m.measure);
        out.push(m.measure);
      }
    }
  }
  for (const m of analysis.used_measures) {
    if (!seen.has(m)) out.push(m);
  }
  return out;
}

/** Progress of a computing dataset, in percent like the job percentage, or null if unknown. */
export function progressPercent(progress: number | undefined): number | null {
  if (progress === undefined || progress === null || !Number.isFinite(progress)) return null;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

/** The loadings table as CSV or LaTeX, or the whole analysis as a ZIP. */
export type ExportFormat = "csv" | "latex" | "zip";

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Dataset jobs are stored as "_dataset:<kind>"; null for every other job. */
function datasetJobKind(job: Job): FactorKind | null {
  if (!job.algorithm_id.startsWith("_dataset:")) return null;
  return job.algorithm_id.slice("_dataset:".length) === "log" ? "log" : "model";
}

/** The name of a job's algorithm in the UI language; the backend names dataset jobs in English. */
export function jobDisplayName(job: Job, t: Translate): string {
  const kind = datasetJobKind(job);
  return kind ? t(`jobs.dataset_name.${kind}`) : job.algorithm_name;
}

/**
 * The title of a job: the name of the dataset it computes, else the name of its algorithm. A
 * dataset job without a name is called after its inputs, like its dataset.
 */
export function jobTitle(job: Job, t: Translate): string {
  const kind = datasetJobKind(job);
  const name = job.params?.dataset_name;
  if (!kind) return jobDisplayName(job, t);
  if (typeof name === "string" && name) return name;
  // The backend names the input of a dataset job "<n> log(s)" or "<n> net(s)".
  const n = parseInt(job.filename, 10);
  return Number.isFinite(n) ? inputsName(t, job.params?.source === "pnml", n) : jobDisplayName(job, t);
}

/** "1 log" or "4 logs": the text of `key`, or of `<key>_plural` for any other count. */
export function countText(t: Translate, key: string, n: number): string {
  return t(n === 1 ? key : `${key}_plural`, { n });
}

/** "Dataset from 3 logs"; a text of its own per noun, since German declines it. */
function inputsName(t: Translate, nets: boolean, n: number): string {
  return countText(t, `factor.data.auto_name.${nets ? "nets" : "logs"}`, n);
}

/** The name of a dataset; one the server made up from the inputs is said in the UI language. */
export function datasetName(
  dataset: { name: string; name_auto?: boolean; source: string; inputs?: InputsSummary },
  t: Translate,
): string {
  return dataset.name_auto ? inputsName(t, dataset.source === "pnml", dataset.inputs?.files ?? 0) : dataset.name;
}

/** What a dataset job computes, e.g. "Model complexity · 4 logs × 2 miners"; null for other jobs. */
export function datasetJobSubtitle(job: Job, t: Translate): string | null {
  const kind = datasetJobKind(job);
  if (!kind) return null;
  const params = job.params ?? {};
  const count = (key: string, v: unknown) => (Array.isArray(v) ? countText(t, `factor.inputs.${key}`, v.length) : null);
  const nets = params.source === "pnml";
  // The backend names the input of a dataset job "<n> log(s)" or "<n> net(s)".
  const n = parseInt(job.filename, 10);
  const files = Number.isFinite(n) ? countText(t, nets ? "factor.inputs.nets" : "factor.inputs.logs", n) : null;
  const miners = count("miners", params.miners);
  // Every log is mined with every miner, hence the product.
  const inputs =
    kind === "log"
      ? [files, count("groups", params.groups)]
      : !nets && files && miners
        ? [`${files} × ${miners}`]
        : [files, count("measures", params.measures)];
  return [t(`mode_bar.${kind}_label`), ...inputs].filter(Boolean).join(" · ");
}

/** The tab that shows the dataset of a dataset job, with a link to it; null for other jobs. */
export function datasetJobHref(job: Job): string | null {
  const kind = datasetJobKind(job);
  if (!kind) return null;
  const tab = kind === "log" ? "/log" : "/";
  const id = job.params?.dataset_id;
  return typeof id === "string" ? `${tab}?dataset=${encodeURIComponent(id)}` : tab;
}
