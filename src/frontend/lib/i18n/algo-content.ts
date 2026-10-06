// Locale overlay for backend-provided algorithm content. The manifest
// (GET /algorithms) ships an English name, `description`, parameter labels and
// per-parameter `help` strings; this module returns the German translation when
// the UI locale is "de" and an entry exists, falling back to the English
// original otherwise. Option values (miner and measure names) are NOT translated
// (project translation policy: process-mining vocabulary stays English).

import type { Locale } from "./provider";
import { ALGO_CONTENT_DE, SAMPLE_LOGS_DE } from "./algo-content.de";

export interface AlgoContentOverride {
  /** German name of the algorithm. */
  name?: string;
  /** German translation of the manifest `description`. */
  description?: string;
  /** German translations of `ParameterSpec.help`, keyed by parameter `name`. */
  params?: Record<string, string>;
  /** German translations of `ParameterSpec.label`, keyed by parameter `name`. */
  labels?: Record<string, string>;
}

export type AlgoContentMap = Record<string, AlgoContentOverride>;

type Translate = (key: string, params?: Record<string, string | number>) => string;

export function localizedAlgoName(algo: { id: string; name: string }, locale: Locale): string {
  return (locale === "de" && ALGO_CONTENT_DE[algo.id]?.name) || algo.name;
}

export function localizedAlgoDescription(
  algo: { id: string; description?: string | null },
  locale: Locale,
): string {
  if (locale === "de") {
    const d = ALGO_CONTENT_DE[algo.id]?.description;
    if (d) return d;
  }
  return algo.description ?? "";
}

export function localizedParamLabel(
  algorithmId: string | undefined,
  spec: { name: string; label: string },
  locale: Locale,
): string {
  return (locale === "de" && algorithmId && ALGO_CONTENT_DE[algorithmId]?.labels?.[spec.name]) || spec.label;
}

export function localizedParamHelp(
  algorithmId: string | undefined,
  spec: { name: string; help?: string | null },
  locale: Locale,
): string | undefined {
  if (locale === "de" && algorithmId) {
    const h = ALGO_CONTENT_DE[algorithmId]?.params?.[spec.name];
    if (h) return h;
  }
  return spec.help ?? undefined;
}

/** A bundled example log of GET /sample-logs with its name and description in the UI language. */
export function localizedSampleLog<T extends { id: string; name: string; description: string }>(
  sample: T,
  locale: Locale,
): T {
  const de = locale === "de" ? SAMPLE_LOGS_DE[sample.id] : undefined;
  return de ? { ...sample, ...de } : sample;
}

// The English texts ComFy writes into its results and progress messages, matched as a whole
// and said again through the locale files (algo_text.*), with the parts in parentheses as
// parameters. Jobs stored before a wording changed simply keep their English text.
const TEXTS: [RegExp, string, string[]][] = [
  [/^(\d+) miner\(s\) × (\d+) measure\(s\) — (\d+) of (\d+) cells computed$/, "summary_partial", ["miners", "measures", "computed", "total"]],
  [/^(\d+) miner\(s\) × (\d+) measure\(s\)$/, "summary", ["miners", "measures"]],
  [/^Miners$/, "miners", []],
  [/^Measures$/, "measures", []],
  [/^Cells computed$/, "cells_computed", []],
  [/^Complexity scores$/, "complexity_scores", []],
  [/^Miner$/, "miner", []],
  [/^Notes$/, "notes", []],
  [/^Petri net \((.+)\)$/, "petri_net", ["miner"]],
  [/^Discovered by (.+)$/, "discovered_by", ["miner"]],
  [/^Download high-DPI PNG \((.+), 300 dpi\)$/, "hires_png", ["miner"]],
  [/^Starting analysis\.\.\.$/, "progress_starting", []],
  [/^Reading event log\.\.\.$/, "progress_reading", []],
  [/^Analyzing complexity for (.+) \((\d+)\/(\d+)\)\.\.\.$/, "progress_miner", ["miner", "i", "n"]],
  [/^Analysis complete!$/, "progress_done", []],
  [/^Aborted by user$/, "progress_aborted", []],
  [/^Pending\.\.\.$/, "progress_pending", []],
];

/** A text of a result or a progress message of the backend in the language of the UI. */
export function localizedAlgoText(text: string, t: Translate): string {
  for (const [pattern, key, names] of TEXTS) {
    const match = pattern.exec(text);
    if (match) return t(`algo_text.${key}`, Object.fromEntries(names.map((n, i) => [n, match[i + 1]])));
  }
  return text;
}
