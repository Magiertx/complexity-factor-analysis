// Helpers for the factor analysis view. Kept free of React so they stay easy to reuse.

import type { CSSProperties } from "react";
import {
  ASSIGNMENT_RULES,
  type AnalysisNotice,
  type AnalyzeOptions,
  type AssignmentRule,
  type BundledDataset,
  type CrossLoading,
  type FactorAnalysis,
  type FactorCatalog,
  type FactorInterpretation,
  type CreateDatasetInput,
  type FactorKind,
  type InputsSummary,
  type Job,
  type MinerSummary,
  type Rotation,
  type UnassignedReason,
} from "./api";

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
  assignment_rule: AssignmentRule;
  /** Of a model dataset discovered with several miners: the rows of this miner; null for all rows. */
  miner: string | null;
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
    assignment_rule: "largest",
    miner: null,
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
    // Saved before the rules existed, or by a newer server with a rule this UI does not know.
    assignment_rule:
      saved.assignment_rule && ASSIGNMENT_RULES.includes(saved.assignment_rule)
        ? saved.assignment_rule
        : defaults.assignment_rule,
    miner: saved.miner ?? null,
  };
}

/**
 * The settings a paper analysed a bundled dataset with ("Paper settings"), completed with the
 * defaults like saved options; null for a dataset without them.
 */
export function publishedOptions(kind: FactorKind, bundled: BundledDataset | null | undefined): AnalysisOptions | null {
  const published = bundled?.published_options;
  return published ? optionsFromSaved(kind, published) : null;
}

/** The settings in which two sets of options differ; excluded measures compare as a set. */
export function differingOptions(a: AnalysisOptions, b: AnalysisOptions): Set<keyof AnalysisOptions> {
  const out = new Set<keyof AnalysisOptions>();
  for (const key of Object.keys(a) as (keyof AnalysisOptions)[]) {
    if (key === "excluded") {
      const other = new Set(b.excluded);
      if (a.excluded.length !== other.size || a.excluded.some((m) => !other.has(m))) out.add(key);
    } else if (a[key] !== b[key]) {
      out.add(key);
    }
  }
  return out;
}

export function sameOptions(a: AnalysisOptions, b: AnalysisOptions): boolean {
  return differingOptions(a, b).size === 0;
}

/**
 * Limits of the assignment rules other than the thresholds of the options, as the server
 * applies them; only for the texts that explain the rules.
 */
export const RULE_LIMITS = {
  /** A loading at most this far below the largest one of a measure counts as well. */
  gap: 0.15,
  /** Least communality of an assigned measure under "multi" and "hair". */
  multi_communality: 0.3,
  hair_communality: 0.5,
};

/** The least communality the rule itself asks for of an assigned measure. */
export function ruleCommunality(rule: AssignmentRule): number {
  if (rule === "multi") return RULE_LIMITS.multi_communality;
  if (rule === "hair") return RULE_LIMITS.hair_communality;
  return 0;
}

/**
 * Whether a loading must exceed the threshold rather than reach it under a rule, as the server
 * applies it (`assignment.loading_strict`): Important Factors asks for |λ| > 0.35.
 */
export function ruleStrict(rule: AssignmentRule): boolean {
  return rule !== "largest";
}

/**
 * The cells of the loadings table by which the rule put a measure on a factor, as
 * "measure:factor". Under "multi" and "hair" these, not every loading above the threshold,
 * are the ones that count, as the dimension tables of Important Factors show them.
 */
export function assignedCells(analysis: FactorAnalysis): Set<string> {
  const out = new Set<string>();
  for (const f of analysis.factors) for (const m of f.measures) out.add(`${m.measure}:${f.index}`);
  return out;
}

/**
 * The communality an assigned measure needs: the threshold of the options or the rule's own
 * minimum, whichever is higher, as the server applies it.
 */
export function effectiveCommunality(options: Pick<AnalysisOptions, "communality_threshold" | "assignment_rule">): number {
  return Math.max(options.communality_threshold, ruleCommunality(options.assignment_rule));
}

export interface UnassignedMeasure {
  measure: string;
  /** null from a server before the assignment rules, which named no reason. */
  reason: UnassignedReason | null;
}

/** The measures without a factor, with the reason where the server gives one. */
export function unassignedMeasures(analysis: FactorAnalysis): UnassignedMeasure[] {
  const reasons = new Map((analysis.unassigned_details ?? []).map((u) => [u.measure, u.reason]));
  return analysis.unassigned.map((measure) => ({ measure, reason: reasons.get(measure) ?? null }));
}

/** The factor a measure loads on most, counting from 0. */
export function primaryFactor(loadings: number[]): number {
  let best = 0;
  for (let i = 1; i < loadings.length; i++) if (Math.abs(loadings[i]) > Math.abs(loadings[best])) best = i;
  return best;
}

/** The cross-loadings of an analysis by measure. */
export function crossLoadingsByMeasure(analysis: FactorAnalysis): Map<string, CrossLoading> {
  return new Map((analysis.cross_loadings ?? []).map((c) => [c.measure, c]));
}

/** The measures of the loadings worth a look: those that load on several factors, and those on none. */
export function notableLoadingMeasures(analysis: FactorAnalysis): Set<string> {
  return new Set([...crossLoadingsByMeasure(analysis).keys(), ...analysis.unassigned]);
}

/**
 * The cells of the loadings table that hold a further loading of a cross-loaded measure, as
 * "measure:factor"; the measure's largest loading is not one of them.
 */
export function secondaryCells(analysis: FactorAnalysis): Set<string> {
  const out = new Set<string>();
  for (const c of analysis.cross_loadings ?? []) {
    const row = analysis.loadings[c.measure];
    const primary = row ? primaryFactor(row) : null;
    for (const f of c.factors) if (f !== primary) out.add(`${c.measure}:${f}`);
  }
  return out;
}

/** Factors that have at least one measure: the dimensions of the solution. */
export function dimensionCount(analysis: FactorAnalysis): number {
  return analysis.factors.filter((f) => f.measures.length > 0).length;
}

/**
 * The options a dataset opens with: those saved with it, else the defaults. Exclusions of
 * measures the dataset no longer has are dropped, and a miner it has not.
 */
export function initialOptions(
  kind: FactorKind,
  saved: AnalyzeOptions | null | undefined,
  measures: string[],
  miners?: MinerSummary[] | null,
): AnalysisOptions {
  if (!saved) return defaultOptions(kind);
  const options = optionsFromSaved(kind, saved);
  const miner = options.miner !== null && (miners ?? []).some((m) => m.name === options.miner) ? options.miner : null;
  return { ...options, excluded: options.excluded.filter((m) => measures.includes(m)), miner };
}

/** Observations per measure recommended; below, the analysis warns (the server's small_sample). */
export const OBSERVATIONS_PER_MEASURE = 5;

/** What the rows of one miner, or of all together, allow for an analysis. */
export interface RowsChoice {
  /** Observations. */
  n: number;
  /** Measures left for the analysis: those that vary within the rows, less the excluded ones. */
  p: number;
  /** No more observations than measures: the analysis cannot run (the server needs n > p). */
  blocked: boolean;
  /** Fewer than 5 observations per measure: it runs, with a warning. */
  few: boolean;
}

/**
 * What the rows of `miner` (all rows for null) allow, with the measures excluded by hand: `p`
 * counts the measures that vary within the rows and are not excluded.
 */
export function rowsChoice(
  dataset: { n_observations: number; measures: string[] },
  miner: MinerSummary | null,
  excluded: string[],
): RowsChoice {
  const out = new Set(excluded);
  const without = new Set(miner?.dropped ?? []);
  const n = miner ? miner.n_observations : dataset.n_observations;
  const p = dataset.measures.filter((m) => !out.has(m) && !without.has(m)).length;
  const blocked = n <= p;
  return { n, p, blocked, few: !blocked && n < OBSERVATIONS_PER_MEASURE * p };
}

/** The most characters of a factor's name; the server says the same. */
export const FACTOR_NAME_MAX = 40;

/** The names of the factors, the first for factor 1; null or "" where a factor has none. */
export type FactorNames = (string | null)[];

/** A name as typed, in one line without spaces at either end, cut to the longest allowed. */
export function cleanFactorName(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ").slice(0, FACTOR_NAME_MAX);
}

/** The name of factor `i` (from 0), or null for one without. */
export function factorName(names: FactorNames | null | undefined, i: number): string | null {
  const name = names?.[i];
  return name ? name : null;
}

/** The names with that of factor `i` set, or cleared by an empty text. */
export function withFactorName(names: FactorNames, i: number, text: string): FactorNames {
  const out = [...names];
  while (out.length <= i) out.push(null);
  out[i] = cleanFactorName(text) || null;
  return trimNames(out);
}

/** The names without the empty ones at the end; [] when there are none. */
export function trimNames(names: FactorNames): FactorNames {
  const out = names.map((n) => (n ? n : null));
  while (out.length > 0 && out[out.length - 1] === null) out.pop();
  return out;
}

/** The names as the API takes them, for a solution of `k` factors; null when none is named. */
export function namesForApi(names: FactorNames | null | undefined, k: number): FactorNames | null {
  const out = trimNames((names ?? []).slice(0, k));
  return out.length > 0 ? out : null;
}

/** Whether any factor has a name. */
export function hasNames(names: FactorNames | null | undefined): boolean {
  return !!names && names.some((n) => !!n);
}

/**
 * The solution names belong to: the factor count, the rotation, the assignment rule and the
 * miner whose rows were analysed. A change of any of them clears the names, as they would name
 * other factors.
 */
export function solutionKey(
  k: number,
  options: Pick<AnalysisOptions, "rotation" | "assignment_rule" | "miner">,
): string {
  return `${k}|${options.rotation}|${options.assignment_rule}|${options.miner ?? ""}`;
}

/** The names an interpretation suggests, by factor, cut to the longest name allowed. */
export function suggestedNames(interpretation: FactorInterpretation, k: number): FactorNames {
  const out: FactorNames = Array.from({ length: k }, () => null);
  for (const f of interpretation.factors) {
    if (f.index >= 1 && f.index <= k) out[f.index - 1] = cleanFactorName(f.name) || null;
  }
  return trimNames(out);
}

/** One part of the settings row above steps 3 to 5, e.g. "MSA ≥ 0.6". */
export interface SettingChip {
  id: "miner" | "measures" | "msa" | "alpha" | "factors" | "rotation" | "loading" | "communality" | "rule";
  text: string;
  /** Differs from the tool standard. */
  differs: boolean;
}

/**
 * The settings of an analysis in short, e.g. "10 of 12 measures · MSA ≥ 0.6 · 4 factors
 * (Kaiser 2) · varimax · |λ| ≥ 0.35 · h² ≥ 0.3 · multiple membership". The counts come from the
 * analysis on screen where there is one. The significance level shows only when it is not the
 * standard: it changes no number of the analysis, only whether Bartlett's test passes.
 */
export function settingsSummary(
  options: AnalysisOptions,
  standard: AnalysisOptions,
  analysis: FactorAnalysis | null,
  measureCount: number,
  t: Translate,
  paperFactors: number | null = null,
): SettingChip[] {
  const changed = differingOptions(options, standard);
  const used = analysis?.used_measures.length ?? measureCount - options.excluded.length;
  const kaiser = analysis?.factor_count?.kaiser ?? analysis?.suggested_n_factors ?? null;
  // Following Kaiser, the count is Kaiser's even while the analysis on screen still has another
  // count, e.g. that of the paper settings just left.
  const n = options.n_factors ?? kaiser;
  const chips: SettingChip[] = [
    // The rows of one miner, first: everything after it is of these rows.
    ...(options.miner !== null ? [{ id: "miner" as const, text: options.miner, differs: true }] : []),
    {
      id: "measures",
      text: t("factor.settings.measures", { used, total: measureCount }),
      differs: changed.has("excluded"),
    },
    {
      id: "msa",
      text: options.auto_msa_filter
        ? t("factor.settings.msa", { value: options.msa_threshold })
        : t("factor.settings.msa_off"),
      differs: changed.has("auto_msa_filter") || (options.auto_msa_filter && changed.has("msa_threshold")),
    },
  ];
  if (changed.has("bartlett_alpha")) {
    chips.push({ id: "alpha", text: t("factor.settings.alpha", { value: options.bartlett_alpha }), differs: true });
  }
  if (n !== null) {
    // "4 factors (Kaiser 2)" for a count of one's own, "4 factors (paper; Kaiser 2)" when it is the
    // paper's a priori count, "2 factors (Kaiser)" when following Kaiser.
    const own = options.n_factors !== null && kaiser !== null;
    const key = !own ? "factors_kaiser" : n === paperFactors ? "factors_paper" : "factors";
    chips.push({
      id: "factors",
      text: countText(t, `factor.settings.${key}`, n, own ? { kaiser } : {}),
      differs: changed.has("n_factors"),
    });
  }
  chips.push(
    { id: "rotation", text: t(`factor.settings.rotation.${options.rotation}`), differs: changed.has("rotation") },
    {
      id: "loading",
      // "multiple membership" and "Hair" count a loading above the threshold, not at it.
      text: t(ruleStrict(options.assignment_rule) ? "factor.settings.loading_strict" : "factor.settings.loading", {
        value: options.loading_threshold,
      }),
      differs: changed.has("loading_threshold"),
    },
    {
      id: "communality",
      // What applies: "multiple membership" with a threshold of 0 still asks for h² ≥ 0.3, which
      // differs from the standard's 0 as much as a threshold set by hand.
      text: t("factor.settings.communality", { value: effectiveCommunality(options) }),
      differs: effectiveCommunality(options) !== effectiveCommunality(standard),
    },
    { id: "rule", text: t(`factor.settings.rule.${options.assignment_rule}`), differs: changed.has("assignment_rule") },
  );
  return chips;
}

/** localStorage keys of the factor analysis tabs, cleared with the datasets in the settings. */
export const STORAGE_PREFIXES = ["app.factor-dataset-", "app.factor-options-", "app.compare-pins-"];

/** Fewest measures the backend accepts for an analysis. */
export const MIN_MEASURES = 3;

/** The fewest observations a factor analysis runs with: one more than the fewest measures. */
export const MIN_OBSERVATIONS = MIN_MEASURES + 1;

/**
 * Which text says that there are too few observations: "any" where no choice of measures helps,
 * since even the fewest measures need more observations, else "some", where fewer measures do.
 */
export function tooFewKind(rows: number): "any" | "some" {
  return rows < MIN_OBSERVATIONS ? "any" : "some";
}

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

/**
 * A notice in the UI language where its code is known, else the English message. With
 * `measureName`, the measures a notice names (the Heywood case lists them, joined by ", ") are
 * written as the lists show them, e.g. by their short codes.
 */
export function noticeText(
  notice: AnalysisNotice,
  tMaybe: TranslateMaybe,
  measureName?: (key: string) => string,
): string {
  const params = noticeParams(notice.params);
  if (measureName && typeof params.measures === "string" && notice.code === "heywood") {
    params.measures = params.measures.split(", ").map(measureName).join(", ");
  }
  return (notice.code && tMaybe(`factor.warnings.${notice.code}`, params)) || notice.message;
}

// Notices on the factor solution rather than the data: step 4 shows them next to the factor
// count and the rotation, which they ask to change, instead of step 3 with the tests.
const SOLUTION_NOTICES = ["not_identified", "heywood", "fit_not_converged", "single_factor_no_rotation"];
// Only says what happened; the solution itself is fine.
const INFO_NOTICES = ["single_factor_no_rotation"];

export function isSolutionNotice(notice: AnalysisNotice): boolean {
  return SOLUTION_NOTICES.includes(notice.code);
}

/** A notice that only says what happened, e.g. that a single factor is not rotated. */
export function isInfoNotice(notice: AnalysisNotice): boolean {
  return INFO_NOTICES.includes(notice.code);
}

/**
 * The notices on the factor solution that need attention, e.g. a possible Heywood case or too many
 * factors for the measures. A factor count of one's own or of a paper is none: it is a choice.
 */
export function solutionProblems(analysis: FactorAnalysis): AnalysisNotice[] {
  return analysisNotices(analysis).filter((n) => isSolutionNotice(n) && !isInfoNotice(n));
}

/** The factor solution needs attention, e.g. too many factors for the measures. */
export function solutionNeedsAttention(analysis: FactorAnalysis): boolean {
  return solutionProblems(analysis).length > 0;
}

export type KmoGrade =
  | "marvelous"
  | "meritorious"
  | "middling"
  | "mediocre"
  | "miserable"
  | "unacceptable";

/**
 * Kaiser's (1974) verbal scale for KMO and MSA values. Graded with the two decimals the UI
 * shows, so 0.698, shown as 0.70, is middling like the scale says.
 */
export function kmoGrade(value: number): KmoGrade {
  const shown = Math.round(value * 100) / 100;
  if (shown >= 0.9) return "marvelous";
  if (shown >= 0.8) return "meritorious";
  if (shown >= 0.7) return "middling";
  if (shown >= 0.6) return "mediocre";
  if (shown >= 0.5) return "miserable";
  return "unacceptable";
}

// Colour carries one meaning in the loadings: orange for a negative sign (the token in
// globals.css). A positive loading is neutral, a shade of the text colour; the surface itself is
// the midpoint, and the shade grows with the magnitude.

/** Background of a loading cell: orange for a negative loading, neutral for a positive one. */
export function loadingStyle(value: number): CSSProperties {
  const m = Math.min(Math.abs(value), 1);
  return {
    backgroundColor: value >= 0 ? `rgb(var(--fg) / ${(m * 0.16).toFixed(3)})` : `rgb(var(--negative) / ${(m * 0.45).toFixed(3)})`,
  };
}

/** The colour of a bar for a value: orange when negative, else neutral. */
export function signColor(value: number): string {
  return value >= 0 ? "rgb(var(--muted))" : "rgb(var(--negative))";
}

/** Text in the colour of a value's sign, dark enough for small text on a tile. */
export function signInk(value: number): string {
  return value >= 0 ? "rgb(var(--fg))" : "rgb(var(--negative-ink))";
}

/** The height in inches of the loadings heatmap of the server for this many measures (figures.py: 0.17 per row, 0.75 around them). */
export function heatmapHeightIn(measures: number): number {
  return 0.75 + 0.17 * measures;
}

/** The height of an A4 page of the print view, 14 mm of margin above and 16 mm below, in inches. */
export const PRINT_PAGE_HEIGHT_IN = (297 - 14 - 16) / 25.4;

/**
 * The most measures whose loadings are printed as the heatmap of the server. The figure cannot
 * break across pages, so it has to fit one: 50 rows are 9.25 in of the 10.5 in of a page, 60 would
 * not. With more measures the print view sets the loadings as a table that breaks between its
 * rows and repeats its header on every page.
 */
export const PRINT_HEATMAP_MAX_MEASURES = 50;

/** Whether a loading counts under the threshold: reaches it, or exceeds it for the rules that ask so. */
export function loadingCounts(value: number, threshold: number, strict: boolean): boolean {
  return strict ? Math.abs(value) > threshold : Math.abs(value) >= threshold;
}

/**
 * Measures in display order. "factor" groups them by assigned factor, strongest loading
 * first, with unassigned measures at the end; "original" keeps the dataset order. For display
 * only: the analysis always runs on the stored order, on which the KMO of singular data depends.
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

/** The loadings table as CSV or LaTeX, the whole analysis as a ZIP, or its LaTeX report. */
export type ExportFormat = "csv" | "latex" | "zip" | "report" | "methods" | "bibtex";

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

/** Why a job failed: in the UI language where the server names a known cause, else its message. */
export function jobErrorText(job: Pick<Job, "error" | "error_code">, tMaybe: TranslateMaybe): string | undefined {
  return (job.error_code && tMaybe(`errors.${job.error_code}`)) || job.error || undefined;
}

/**
 * A failure of the API for the UI: the sentence of its code in the UI language, with the
 * technical text kept for an (i) "Details". A code without a sentence gets the generic text and
 * the technical text as details, so library wording is never the main message.
 */
export function plainFailure(
  tMaybe: TranslateMaybe,
  failure: { code?: string | null; params?: Record<string, string | number> | null; message?: string | null },
  generic: string,
): { text: string; details: string | null } {
  const params = failure.params ?? undefined;
  const text = failure.code
    ? (tMaybe(`factor.errors.${failure.code}`, params) ?? tMaybe(`errors.${failure.code}`, params))
    : undefined;
  const message = failure.message?.trim() || null;
  if (text) return { text, details: message && message !== text ? message : null };
  return { text: generic, details: message };
}

/** The MSA filter took out more than half of the measures it was given: a thin result is left. */
export function mostlyFiltered(left: number, removed: number): boolean {
  return removed * 2 > left + removed;
}

/** A dataset that was stopped or failed: there is no data to open. */
export function datasetEnded(dataset: { status: string }): boolean {
  return dataset.status === "failed" || dataset.status === "aborted";
}

/**
 * What an analysis of this many observations and measures is known to run into before it is
 * asked for: more measures than observations leave it nothing to estimate (core._check_size).
 * null where it can run, or where the server has another reason to say no.
 */
export function knownTooFew(rows: number, measures: number): { n: number; measures: number; needed: number } | null {
  if (measures < MIN_MEASURES) return null;
  return rows < measures + 1 ? { n: rows, measures, needed: measures + 1 } : null;
}

/** The input to compute an aborted dataset again, if what it was made from is still there: a bundled sample. */
export function retryInput(dataset: {
  kind: FactorKind;
  source: string;
  name: string;
  name_auto: boolean;
  inputs?: { sample_id?: string; measures?: string[]; miners?: string[]; groups?: string[] };
}): CreateDatasetInput | null {
  const inputs = dataset.inputs;
  if (!inputs?.sample_id || (dataset.source !== "logs" && dataset.source !== "pnml")) return null;
  return {
    kind: dataset.kind,
    source: dataset.source,
    bundledId: inputs.sample_id,
    measures: inputs.measures,
    miners: inputs.miners,
    groups: inputs.groups,
    name: dataset.name_auto ? undefined : dataset.name,
  };
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
  // A name the person gave wins over the sample's; one stored before the sample was named apart
  // carries its English name.
  if (typeof name === "string" && name && !SAMPLE_BY_NAME.has(name)) return name;
  const sample = sampleName(t, job.params?.sample_id) ?? sampleName(t, SAMPLE_BY_NAME.get(name as string));
  if (sample) return sample;
  if (typeof name === "string" && name) return name;
  // The backend names the input of a dataset job "<n> log(s)" or "<n> net(s)".
  const n = parseInt(job.filename, 10);
  return Number.isFinite(n) ? inputsName(t, job.params?.source === "pnml", n) : jobDisplayName(job, t);
}

/** "1 log" or "4 logs": the text of `key`, or of `<key>_plural` for any other count. */
export function countText(t: Translate, key: string, n: number, params?: Record<string, string | number>): string {
  return t(n === 1 ? key : `${key}_plural`, { ...params, n });
}

/** "Dataset from 3 logs"; a text of its own per noun, since German declines it. */
function inputsName(t: Translate, nets: boolean, n: number): string {
  return countText(t, `factor.data.auto_name.${nets ? "nets" : "logs"}`, n);
}

/** The bundled samples of logs and nets: the text of their name, and the server's English one. */
const SAMPLES: Record<string, { key: string; en: string }> = {
  "pdc-sample-logs": { key: "factor.data.sample_name.pdc_sample_logs", en: "Four PDC training logs" },
  "pdc-sample-models": { key: "factor.data.sample_name.pdc_sample_models", en: "Petri nets of the four PDC logs" },
};
const SAMPLE_BY_NAME = new Map(Object.entries(SAMPLES).map(([id, s]) => [s.en, id]));

/** The name of a bundled sample in the UI language; null for an id the UI does not know. */
function sampleName(t: Translate, id: unknown): string | null {
  const sample = typeof id === "string" ? SAMPLES[id] : undefined;
  return sample ? t(sample.key) : null;
}

/**
 * The name of a dataset in the UI language where the server's is English: one it made up from
 * the sample or the inputs, or that of a bundled dataset, which the (localized) catalog has.
 */
export function datasetName(
  dataset: { name: string; name_auto?: boolean; source: string; inputs?: InputsSummary; bundled_id?: string | null },
  t: Translate,
  catalog?: FactorCatalog | null,
): string {
  const sampleId = dataset.inputs?.sample_id;
  // Called after its sample: made up by the server, or stored before that counted as made up.
  if (sampleId && (dataset.name_auto || SAMPLES[sampleId]?.en === dataset.name)) {
    const sample = sampleName(t, sampleId);
    if (sample) return sample;
  }
  if (dataset.name_auto) return inputsName(t, dataset.source === "pnml", dataset.inputs?.files ?? 0);
  // The server names a bundled dataset after its catalog entry; the UI gives it no other name.
  const bundled = dataset.bundled_id ? catalog?.bundled.find((b) => b.id === dataset.bundled_id) : undefined;
  return bundled?.name ?? dataset.name;
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
