// Helpers for the factor analysis view. Kept free of React so they stay easy to reuse.

import type { CSSProperties } from "react";
import type { FactorAnalysis, FactorKind, Job, Rotation } from "./api";

type Translate = (key: string, params?: Record<string, string | number>) => string;

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

/** Fewest measures the backend accepts for an analysis. */
export const MIN_MEASURES = 3;

/** Rows of a dataset the browser loads and shows as a preview. */
export const PREVIEW_ROWS = 8;

export const ORTHOGONAL: Rotation[] = ["varimax", "quartimax"];

/** Fixed digits with a typographic minus, so columns of signed values line up. */
export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "–";
  const s = value.toFixed(digits);
  return s.startsWith("-") ? `−${s.slice(1)}` : s;
}

export function formatPValue(p: number): string {
  if (!Number.isFinite(p)) return "–";
  if (p < 0.001) return "< 0.001";
  return p.toFixed(3);
}

export function formatPercent(share: number, digits = 1): string {
  return `${(share * 100).toFixed(digits)}%`;
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

/** The title of a job: the name of the dataset it computes, else the name of its algorithm. */
export function jobTitle(job: Job, t: Translate): string {
  const name = job.params?.dataset_name;
  return datasetJobKind(job) && typeof name === "string" && name ? name : jobDisplayName(job, t);
}

/** "1 log" or "4 logs": the text of `key`, or of `<key>_plural` for any other count. */
export function countText(t: Translate, key: string, n: number): string {
  return t(n === 1 ? key : `${key}_plural`, { n });
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

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 hours ago" in the given locale; an empty string for a date that cannot be read. */
export function relativeTime(iso: string, locale: string, now = Date.now()): string {
  const seconds = (new Date(iso).getTime() - now) / 1000;
  if (!Number.isFinite(seconds)) return "";
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, "second");
}
