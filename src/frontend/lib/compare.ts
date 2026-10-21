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

export interface CompareState {
  /** The bundled datasets of the columns, in their order; the first one keeps its factor numbers. */
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

export interface ParsedCompare {
  state: CompareState;
  /** Some part of the link could not be used; the rest, or Tab. 17, is shown instead. */
  invalid: boolean;
}

/**
 * The comparison a link asks for. Without `cols` it is Tab. 17. Ids `known` does not list, the
 * same id twice and columns beyond the most are left out; with fewer than two left, and for an
 * unknown rule, Tab. 17's are taken, and the link counts as invalid.
 */
export function parseCompareQuery(params: URLSearchParams, known: ReadonlySet<string> | null): ParsedCompare {
  const cols = params.get("cols");
  const ruleText = params.get("rule");
  let invalid = false;
  let columns = [...TABLE_17];
  if (cols !== null) {
    const asked = cols.split(",").map((c) => c.trim()).filter(Boolean);
    const usable = [...new Set(asked)].filter((c) => !known || known.has(c));
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

/** The request of a comparison: every column with the settings of its paper. */
export function compareRequest(state: CompareState): CompareRequest {
  return { columns: state.columns.map((id) => ({ bundled_id: id })), assignment_rule: state.rule };
}

export function sameState(a: CompareState, b: CompareState): boolean {
  return a.rule === b.rule && a.columns.length === b.columns.length && a.columns.every((c, i) => c === b.columns[i]);
}

/**
 * The columns with `id` switched on or off, in the order of `order` (the datasets as the page
 * lists them); ids `order` does not know keep their place at the end.
 */
export function toggleColumn(columns: string[], id: string, order: readonly string[]): string[] {
  const on = new Set(columns);
  if (on.has(id)) on.delete(id);
  else on.add(id);
  const rank = (c: string) => {
    const i = order.indexOf(c);
    return i < 0 ? order.length + columns.indexOf(c) : i;
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
