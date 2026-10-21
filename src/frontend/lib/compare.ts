// The comparison of factor structures (/compare): which bundled datasets are compared under which
// rule, as the link of the page carries them, and what a cell of the matrix says. Kept free of
// React so it stays easy to test.

import { ASSIGNMENT_RULES, type AssignmentRule, type CompareCell, type CompareRequest } from "./api";

/** As many columns as the server compares at once (factor_analysis/compare.py). */
export const MIN_COLUMNS = 2;
export const MAX_COLUMNS = 8;

/** The miners Important Factors compares in Tab. 17, in its order, and the rule of that table. */
export const TABLE_17: readonly string[] = [
  "comfy-paper-alpha-miner",
  "comfy-paper-directly-follows-miner",
  "comfy-paper-inductive-miner",
  "comfy-paper-hybrid-ilp-miner",
];
export const TABLE_17_RULE: AssignmentRule = "hair";

/**
 * A column is a bundled dataset, with the factor count of its paper or with one of its own. In
 * the link and in the state it is a key: the id of the dataset, "comfy-paper-inductive-miner", or
 * the id with a factor count, "comfy-paper-inductive-miner~k6".
 */
export interface ColumnChoice {
  id: string;
  /** The factor count the column asks for; null for the one of the paper. */
  k: number | null;
}

/** The most factors a link may ask for (the server says what a dataset allows). */
export const MAX_FACTORS = 99;

export function columnKey(id: string, k: number | null = null): string {
  return k === null ? id : `${id}~k${k}`;
}

/** The dataset and factor count of a key, or null for a key that is neither. */
export function parseColumnKey(key: string): ColumnChoice | null {
  const match = /^([^~]+)(?:~k([1-9]\d?))?$/.exec(key);
  if (!match) return null;
  const k = match[2] === undefined ? null : Number(match[2]);
  return k !== null && k > MAX_FACTORS ? null : { id: match[1], k };
}

export interface CompareState {
  /** The columns as keys (`columnKey`), in their order; the first one keeps its factor numbers. */
  columns: string[];
  rule: AssignmentRule;
}

export const TABLE_17_STATE: CompareState = { columns: [...TABLE_17], rule: TABLE_17_RULE };

/** The query of the link to a comparison, e.g. "cols=comfy-paper-alpha-miner,…&rule=hair". */
export function compareQuery(state: CompareState): string {
  // Commas stay readable in the link; no id of a bundled dataset has one.
  return `cols=${state.columns.map(encodeURIComponent).join(",")}&rule=${state.rule}`;
}

/** The page of the comparison of Tab. 17, for the entries in the toolbar and in Start here. */
export const COMPARE_HREF = `/compare?${compareQuery(TABLE_17_STATE)}`;

/**
 * The Inductive miner with the factor count of its paper beside 6 factors, under multiple
 * membership, as section 6 of Important Factors does: only MM loads on the fifth factor.
 */
export const COMPARE_K4_K6_STATE: CompareState = {
  columns: [columnKey("comfy-paper-inductive-miner"), columnKey("comfy-paper-inductive-miner", 6)],
  rule: "multi",
};
export const COMPARE_K4_K6_HREF = `/compare?${compareQuery(COMPARE_K4_K6_STATE)}`;

export interface ParsedCompare {
  state: CompareState;
  /** Some part of the link could not be used; the rest, or Tab. 17, is shown instead. */
  invalid: boolean;
}

/**
 * The comparison a link asks for. Without `cols` it is Tab. 17. Keys that are not a dataset
 * `known` lists (with or without a factor count), the same column twice and columns beyond the
 * most are left out; with fewer than two left, and for an unknown rule, Tab. 17's are taken, and
 * the link counts as invalid. The same dataset may be there twice with other factor counts.
 */
export function parseCompareQuery(params: URLSearchParams, known: ReadonlySet<string> | null): ParsedCompare {
  const cols = params.get("cols");
  const ruleText = params.get("rule");
  let invalid = false;
  let columns = [...TABLE_17];
  if (cols !== null) {
    const asked = cols.split(",").map((c) => c.trim()).filter(Boolean);
    const usable: string[] = [];
    for (const key of asked) {
      const column = parseColumnKey(key);
      if (!column || (known && !known.has(column.id))) continue;
      if (!usable.includes(key)) usable.push(key);
    }
    if (usable.length !== asked.length || usable.length > MAX_COLUMNS) invalid = true;
    if (usable.length >= MIN_COLUMNS) columns = usable.slice(0, MAX_COLUMNS);
    else invalid = true;
  }
  let rule = TABLE_17_RULE;
  if (ruleText !== null) {
    if ((ASSIGNMENT_RULES as string[]).includes(ruleText)) rule = ruleText as AssignmentRule;
    else invalid = true;
  }
  return { state: { columns, rule }, invalid };
}

/**
 * The request of a comparison: every column with the settings of its paper, and a column with a
 * factor count of its own with that count, titled by `title` so that two columns of one dataset
 * differ in the downloads as well.
 */
export function compareRequest(state: CompareState, title?: (id: string, k: number) => string): CompareRequest {
  return {
    columns: state.columns.map((key) => {
      const column = parseColumnKey(key);
      if (!column) return { bundled_id: key };
      if (column.k === null) return { bundled_id: column.id };
      return { bundled_id: column.id, options: { n_factors: column.k }, ...(title && { label: title(column.id, column.k) }) };
    }),
    assignment_rule: state.rule,
  };
}

export function sameState(a: CompareState, b: CompareState): boolean {
  return a.rule === b.rule && a.columns.length === b.columns.length && a.columns.every((c, i) => c === b.columns[i]);
}

/**
 * The columns with `key` switched on or off, in the order of `order` (the datasets as the page
 * lists them), a dataset with a factor count of its own after the one of its paper; datasets
 * `order` does not know keep their place at the end.
 */
export function toggleColumn(columns: string[], key: string, order: readonly string[]): string[] {
  const on = new Set(columns);
  if (on.has(key)) on.delete(key);
  else on.add(key);
  const rank = (c: string) => {
    const column = parseColumnKey(c);
    const i = order.indexOf(column?.id ?? c);
    return (i < 0 ? order.length + columns.indexOf(c) : i) * 100 + (column?.k ?? 0);
  };
  return [...on].sort((a, b) => rank(a) - rank(b));
}

/** The name of a dimension, counted from 1: "D1". */
export function dimensionLabel(index: number): string {
  return `D${index + 1}`;
}

/** The dimensions of a cell, largest loading first, or none. */
export function cellDimensions(cell: CompareCell): number[] {
  return cell.status === "assigned" ? cell.dimensions : [];
}

/** Whether a column puts the measure of a row into the row's dimension, first. */
export function cellInRow(cell: CompareCell, rowDimension: number | null): boolean {
  return cell.status === "assigned" && rowDimension !== null && cell.dimensions[0] === rowDimension;
}

/** The rows of the matrix by their dimension, in order, those in none last. */
export function groupRows<T extends { dimension: number | null }>(rows: T[]): { dimension: number | null; rows: T[] }[] {
  const groups: { dimension: number | null; rows: T[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.dimension === row.dimension) last.rows.push(row);
    else groups.push({ dimension: row.dimension, rows: [row] });
  }
  return groups;
}

/**
 * The tint of a pair in the matrix of pairs, as the opacity of the text colour: nothing where the
 * two are never in one dimension, up to a quarter where they always are.
 */
export function pairTint(together: number, analysed: number): number {
  if (analysed <= 0 || together <= 0) return 0;
  return 0.05 + 0.2 * Math.min(1, together / analysed);
}
