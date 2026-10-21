// Links to an analysis of a bundled dataset, e.g. /?bundled=comfy-paper-inductive-miner&preset=published.
// Only bundled datasets get links: everyone has them, while uploaded data stays in its session.

import { ASSIGNMENT_RULES, ROTATIONS, type AssignmentRule, type Rotation } from "./api";
import { sameOptions, type AnalysisOptions } from "./factor-analysis";

export type LinkPreset = "published" | "standard";

/** The parameters a link may carry besides `bundled`; any other one is left alone. */
const OPTION_PARAMS = ["k", "rot", "msa", "alpha", "lt", "h2", "rule", "ex"];

/**
 * The query of a link to these settings: a preset where they are the standard or the paper's,
 * else every setting spelled out, so the link opens the same analysis later even if a default
 * changes. Excluded measures are joined by commas; no measure of a bundled dataset has one.
 */
export function analysisLinkQuery(
  bundledId: string,
  options: AnalysisOptions,
  standard: AnalysisOptions,
  published: AnalysisOptions | null,
): string {
  const q = new URLSearchParams({ bundled: bundledId });
  if (published && sameOptions(options, published)) {
    q.set("preset", "published");
  } else if (sameOptions(options, standard)) {
    q.set("preset", "standard");
  } else {
    writeOptions(q, options, standard);
  }
  return q.toString();
}

/** Every setting spelled out in `q`, as a link to an analysis writes them. */
function writeOptions(q: URLSearchParams, options: AnalysisOptions, standard: AnalysisOptions) {
  q.set("k", options.n_factors === null ? "kaiser" : String(options.n_factors));
  q.set("rot", options.rotation);
  q.set("msa", options.auto_msa_filter ? String(options.msa_threshold) : "off");
  // Changes only whether Bartlett's test passes, so it is spelled out only when it is not the standard.
  if (options.bartlett_alpha !== standard.bartlett_alpha) q.set("alpha", String(options.bartlett_alpha));
  q.set("lt", String(options.loading_threshold));
  q.set("h2", String(options.communality_threshold));
  q.set("rule", options.assignment_rule);
  if (options.excluded.length > 0) q.set("ex", options.excluded.join(","));
}

export interface ParsedLink {
  bundledId: string;
  /** A preset to apply, or null when `options` spells the settings out. */
  preset: LinkPreset | null;
  options: AnalysisOptions;
  /** Some parameter could not be read; the link then opens with the standard. */
  invalid: boolean;
}

/** A number in [min, max] as a link writes it, or null. */
function number(text: string, min: number, max: number, open = false): number | null {
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(text)) return null;
  const v = Number(text);
  return v >= min && v <= max && !(open && (v === min || v === max)) ? v : null;
}

/**
 * The analysis a link asks for, or null if it names no bundled dataset. Any parameter that
 * cannot be read makes the whole link fall back to the standard, rather than to a mix nobody
 * asked for. `measures` are the measures that may be excluded.
 */
export function parseAnalysisLink(
  params: URLSearchParams,
  standard: AnalysisOptions,
  measures: Set<string>,
): ParsedLink | null {
  const bundledId = params.get("bundled");
  if (!bundledId) return null;
  const fallback = { bundledId, preset: "standard" as const, options: standard, invalid: true };
  const preset = params.get("preset");
  if (preset !== null) {
    return preset === "published" || preset === "standard"
      ? { bundledId, preset, options: standard, invalid: false }
      : fallback;
  }
  if (!OPTION_PARAMS.some((p) => params.has(p))) {
    return { bundledId, preset: "standard", options: standard, invalid: false };
  }
  const options = readOptions(params, standard, measures);
  return options ? { bundledId, preset: null, options, invalid: false } : fallback;
}

/**
 * The settings of a query as `writeOptions` writes them, the standard where it leaves one out;
 * null if any of them cannot be read. `measures` are the measures that may be excluded, or null
 * to accept any name, e.g. before the dataset is loaded.
 */
function readOptions(params: URLSearchParams, standard: AnalysisOptions, measures: Set<string> | null): AnalysisOptions | null {
  const options: AnalysisOptions = { ...standard, excluded: [] };
  const get = (name: string) => params.get(name);

  const k = get("k");
  if (k !== null) {
    if (k === "kaiser") options.n_factors = null;
    else if (/^[1-9]\d{0,2}$/.test(k)) options.n_factors = Number(k);
    else return null;
  }
  const rot = get("rot");
  if (rot !== null) {
    if (!ROTATIONS.includes(rot as Rotation)) return null;
    options.rotation = rot as Rotation;
  }
  const msa = get("msa");
  if (msa !== null) {
    if (msa === "off") options.auto_msa_filter = false;
    else {
      const v = number(msa, 0, 1);
      if (v === null) return null;
      options.auto_msa_filter = true;
      options.msa_threshold = v;
    }
  }
  for (const [name, key, open] of [
    ["alpha", "bartlett_alpha", true],
    ["lt", "loading_threshold", false],
    ["h2", "communality_threshold", false],
  ] as const) {
    const raw = get(name);
    if (raw === null) continue;
    const v = number(raw, 0, 1, open);
    if (v === null) return null;
    options[key] = v;
  }
  const rule = get("rule");
  if (rule !== null) {
    if (!ASSIGNMENT_RULES.includes(rule as AssignmentRule)) return null;
    options.assignment_rule = rule as AssignmentRule;
  }
  const ex = get("ex");
  if (ex) {
    const excluded = ex.split(",");
    if (measures && excluded.some((m) => !measures.has(m))) return null;
    options.excluded = [...new Set(excluded)];
  }
  return options;
}

/** How the print view shows an analysis besides its settings. */
export interface PrintView {
  /** Measures by the short codes of the papers. */
  codes: boolean;
  /** The rows of the loadings: by factor or as in the dataset. */
  order: "factor" | "dataset";
}

/**
 * The address of the print view of an analysis of a dataset of the session: the dataset, every
 * setting spelled out, and how it is shown. The print view runs the analysis itself.
 */
export function printHref(kind: "model" | "log", datasetId: string, options: AnalysisOptions, standard: AnalysisOptions, view: PrintView): string {
  const q = new URLSearchParams({ kind, dataset: datasetId });
  writeOptions(q, options, standard);
  if (view.codes) q.set("codes", "1");
  if (view.order !== "factor") q.set("order", view.order);
  return `/print?${q.toString()}`;
}

/** What the print view's address asks for, or null if it names no dataset or a setting is unreadable. */
export function parsePrintLink(
  params: URLSearchParams,
  defaults: (kind: "model" | "log") => AnalysisOptions,
): { kind: "model" | "log"; datasetId: string; options: AnalysisOptions; view: PrintView } | null {
  const kind = params.get("kind") === "log" ? "log" : "model";
  const datasetId = params.get("dataset");
  if (!datasetId) return null;
  const options = readOptions(params, defaults(kind), null);
  if (!options) return null;
  return {
    kind,
    datasetId,
    options,
    view: { codes: params.get("codes") === "1", order: params.get("order") === "dataset" ? "dataset" : "factor" },
  };
}
