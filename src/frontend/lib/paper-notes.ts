// What the UI says about the published datasets beyond the catalog: the order of a paper's
// datasets, a short note on some of them, and how the paper's own tables relate to the report
// the numbers are checked against. Which dataset gets which note is set here; the wording lives
// in the locale files under factor.paper_notes, so both can be changed in one place.

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Keys the server sends as `published_match.paper_tables`, and the text each stands for. */
const PAPER_TABLES: Record<string, string> = {
  matches: "matches",
  extra_dup_column: "extra_dup",
  other_data: "other_data",
  not_in_paper: "not_in_paper",
};

/**
 * The sentence on the paper's own tables: for a known key in the UI language with the tables
 * the server names (`ref`, e.g. "Tab. 10–11"), else the server's English note, if any.
 */
export function paperTablesText(
  key: string | null | undefined,
  ref: string | null | undefined,
  note: string | null | undefined,
  t: Translate,
): string | null {
  const text = key ? PAPER_TABLES[key] : undefined;
  // "matches" needs the tables to say anything; the other texts name theirs.
  if (text && (text !== "matches" || ref)) return t(`factor.paper_notes.tables.${text}`, { tables: ref ?? "" });
  return note || null;
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
