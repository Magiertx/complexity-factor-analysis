// What the UI says about the published datasets beyond the catalog: the order of a paper's
// datasets, a short note on some of them, how the paper's own tables relate to the report the
// numbers are checked against, and where they differ from the assignment rules the paper
// states. Which dataset gets which note, and the numbers in them, are set here; the wording
// lives in the locale files under factor.paper_notes, so both can be changed in one place.

import type { AssignmentRule } from "./api";
import { RULE_LIMITS } from "./factor-analysis";
import { formatNumber } from "./format";

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Keys the server sends as `published_match.paper_tables`, and the text each stands for. */
const PAPER_TABLES: Record<string, string> = {
  matches: "matches",
  msa_only: "msa_only",
  extra_dup_column: "extra_dup",
  other_data: "other_data",
  not_in_paper: "not_in_paper",
};

/**
 * The numbers the note on the Directly Follows miner compares: Tab. 7 of Important Factors
 * against the ComFy report, whose data lack dup without τ.
 */
const EXTRA_DUP = { chi_paper: 10965.18, chi_report: 8244.33, kmo_paper: 0.81, kmo_report: 0.73, loading_gap: 0.06 };

/**
 * Values the paper prints one hundredth lower than rounding the report's gives, by dataset:
 * the MSA of a measure in Tab. 10 (Inductive) and Tab. 13 (Heuristics).
 */
const PRINTED_LOWER: Record<string, { measure: string; printed: number; report: number }> = {
  "comfy-paper-inductive-miner": { measure: "Density", printed: 0.75, report: 0.7559 },
  "comfy-paper-heuristics-miner": { measure: "Number of duplicate tasks", printed: 0.59, report: 0.5965 },
};

/**
 * The sentence on the paper's own tables: for a known key in the UI language with the tables
 * the server names (`ref`, e.g. "Tab. 10–11"), else the server's English note, if any. With
 * the `locale` and the `datasetId`, a value the paper prints off its rounding is named too.
 */
export function paperTablesText(
  key: string | null | undefined,
  ref: string | null | undefined,
  note: string | null | undefined,
  t: Translate,
  { locale = "en", datasetId }: { locale?: string; datasetId?: string } = {},
): string | null {
  const text = key ? PAPER_TABLES[key] : undefined;
  // "matches" and "msa_only" need the tables to say anything; the other texts name theirs.
  if (!text || ((text === "matches" || text === "msa_only") && !ref)) return note || null;
  const number = (value: number) => formatNumber(value, locale);
  const params: Record<string, string | number> = { tables: ref ?? "" };
  if (text === "extra_dup") {
    for (const [name, value] of Object.entries(EXTRA_DUP)) params[name] = number(value);
  }
  const sentence = t(`factor.paper_notes.tables.${text}`, params);
  const lower = datasetId && (text === "matches" || text === "msa_only") ? PRINTED_LOWER[datasetId] : undefined;
  if (!lower) return sentence;
  const rounding = t("factor.paper_notes.rounding", {
    measure: lower.measure,
    printed: formatNumber(lower.printed, locale, 2),
    report: formatNumber(lower.report, locale, 4),
  });
  return `${sentence} ${rounding}`;
}

/**
 * Where the published settings of a bundled dataset come from, in the UI language: the
 * citation the server sends, or for a dataset only the reports of the ComFy repository analyse
 * (`scope` "report"), the paper's settings as such a report applies them.
 */
export function settingsSourceText(source: string | undefined, scope: string | undefined, t: Translate): string | null {
  if (!source) return null;
  return scope === "report" ? t("factor.paper_notes.source_report", { source }) : source;
}

/**
 * Where the paper's dimension tables differ from the assignment rule it states, by dataset and
 * rule. Each holds for the paper settings with that rule, under which the tables were made.
 */
const RULE_NOTES: Record<string, Partial<Record<AssignmentRule, string>>> = {
  "comfy-paper-alpha-miner": { multi: "alpha_multi", hair: "alpha_hair" },
  "comfy-paper-inductive-miner": { multi: "inductive_multi" },
};

/** The note for a bundled dataset under a rule, or null; the text is under factor.paper_notes.rules. */
export function ruleNote(
  datasetId: string | null | undefined,
  rule: AssignmentRule,
  t: Translate,
  locale = "en",
): string | null {
  const key = datasetId ? RULE_NOTES[datasetId]?.[rule] : undefined;
  return key ? t(`factor.paper_notes.rules.${key}`, { h2_hair: formatNumber(RULE_LIMITS.hair_communality, locale, 1) }) : null;
}

/**
 * The order of the datasets of a collection. Important Factors compares four miners in Tab. 17
 * (Alpha, Directly Follows, Inductive, Hybrid ILP); they come first, the others after them.
 */
const COLLECTION_ORDER: Record<string, string[]> = {
  "comfy-paper": [
    "comfy-paper-alpha-miner",
    "comfy-paper-directly-follows-miner",
    "comfy-paper-inductive-miner",
    "comfy-paper-hybrid-ilp-miner",
    "comfy-paper-heuristics-miner",
    "comfy-paper-alpha-plus-miner",
    "comfy-paper-alpha-dollar-miner",
  ],
};

/** The datasets of a collection in its order; ids the order does not know keep theirs, at the end. */
export function orderCollection<T extends { id: string }>(collection: string, items: T[]): T[] {
  const order = COLLECTION_ORDER[collection];
  if (!order) return items;
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}

/** A short, factual note on a bundled dataset; the text is under factor.paper_notes.datasets. */
const DATASET_NOTES: Record<string, string> = {
  "comfy-paper-directly-follows-miner": "directly_follows",
  "comfy-paper-hybrid-ilp-miner": "hybrid_ilp",
  "comfy-paper-heuristics-miner": "heuristics",
  "comfy-paper-alpha-plus-miner": "alpha_plus",
  "comfy-paper-alpha-dollar-miner": "alpha_dollar",
};

export function datasetNote(id: string, t: Translate): string | null {
  const key = DATASET_NOTES[id];
  return key ? t(`factor.paper_notes.datasets.${key}`) : null;
}
