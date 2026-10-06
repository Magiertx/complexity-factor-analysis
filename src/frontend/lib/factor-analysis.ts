// Helpers for the factor analysis view. Kept free of React so they stay easy to reuse.

import type { CSSProperties } from "react";
import type { FactorAnalysis, FactorKind, Job, Rotation } from "./api";

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

/** The name of a job in the UI language; the backend names dataset jobs in English. */
export function jobDisplayName(job: Job, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (!job.algorithm_id.startsWith("_dataset:")) return job.algorithm_name;
  const kind = job.algorithm_id.slice("_dataset:".length) === "log" ? "log" : "model";
  return t(`jobs.dataset_name.${kind}`);
}

/** Dataset jobs are stored as "_dataset:<kind>"; this is the tab that shows their dataset. */
export function datasetJobHref(job: Job): string | null {
  if (!job.algorithm_id.startsWith("_dataset:")) return null;
  const tab = job.algorithm_id.slice("_dataset:".length) === "log" ? "/log" : "/";
  const id = job.params?.dataset_id;
  return typeof id === "string" ? `${tab}?dataset=${encodeURIComponent(id)}` : tab;
}
