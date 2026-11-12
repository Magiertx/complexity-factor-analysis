// The comparison of factor structures (/compare): which datasets are compared under which rule, as
// the link of the page carries them, what a cell of the matrix says, and the solutions pinned for
// a comparison. Kept free of React so it stays easy to test.

import {
  ASSIGNMENT_RULES,
  ROTATIONS,
  type AssignmentRule,
  type CompareCell,
  type CompareColumnRequest,
  type CompareRequest,
  type FactorKind,
  type Rotation,
} from "./api";

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
/** The assignment rule of Tab. 17. */
export const TABLE_17_RULE: AssignmentRule = "hair";

/**
 * A column is a bundled dataset, with the factor count of its paper or with one of its own, or a
 * dataset of the session (`own`), with the settings saved with it and optionally the rows of one
 * miner, a factor count and a rotation of its own. In the link and in the state it is a key: the
 * id of a bundled dataset, "comfy-paper-inductive-miner", with a factor count,
 * "comfy-paper-inductive-miner~k6", or the id of a dataset of the session with its miner, count
 * and rotation, "<uuid>~mInductive miner~k4~rvarimax".
 */
export interface ColumnChoice {
  id: string;
  /** The factor count the column asks for; null for the one of the paper or of the saved settings. */
  k: number | null;
  /** A dataset of the session rather than a bundled one; absent for a bundled one. */
  own?: true;
  /** Of a dataset of the session: the miner whose rows the column has, or null for all rows. */
  miner?: string | null;
  /** Of a dataset of the session: a rotation of its own, or null for the saved one. */
  rotation?: Rotation | null;
}

/** The most factors a link may ask for (the server says what a dataset allows). */
export const MAX_FACTORS = 99;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether an id names a dataset of the session (a UUID) rather than a bundled one. */
export function isOwnId(id: string): boolean {
  return UUID.test(id);
}

/** The key of a column of a bundled dataset, with `k` factors where it asks for a count. */
export function columnKey(id: string, k: number | null = null): string {
  return k === null ? id : `${id}~k${k}`;
}

/** The key of a column of a dataset of the session. */
export function ownColumnKey(
  datasetId: string,
  { miner = null, k = null, rotation = null }: { miner?: string | null; k?: number | null; rotation?: Rotation | null } = {},
): string {
  return [datasetId, miner !== null ? `m${miner}` : null, k !== null ? `k${k}` : null, rotation !== null ? `r${rotation}` : null]
    .filter((part): part is string => part !== null)
    .join("~");
}

/** The dataset and factor count of a key, or null for a key that is neither. */
export function parseColumnKey(key: string): ColumnChoice | null {
  const parts = key.split("~");
  if (isOwnId(parts[0])) return parseOwnKey(parts);
  const match = /^([^~]+)(?:~k([1-9]\d?))?$/.exec(key);
  if (!match) return null;
  const k = match[2] === undefined ? null : Number(match[2]);
  return k !== null && k > MAX_FACTORS ? null : { id: match[1], k };
}

/**
 * A key of a dataset of the session, split at "~": the id, then a miner, a count and a rotation,
 * each at most once and in this order.
 */
function parseOwnKey([id, ...rest]: string[]): ColumnChoice | null {
  const choice: ColumnChoice = { id: id.toLowerCase(), k: null, own: true, miner: null, rotation: null };
  let stage = 0;
  for (const part of rest) {
    const tag = part[0];
    const value = part.slice(1);
    if (tag === "m" && stage < 1 && value.trim() !== "" && value.length <= 200 && !value.includes(",")) {
      choice.miner = value;
      stage = 1;
    } else if (tag === "k" && stage < 2 && /^[1-9]\d?$/.test(value)) {
      choice.k = Number(value);
      stage = 2;
    } else if (tag === "r" && stage < 3 && (ROTATIONS as string[]).includes(value)) {
      choice.rotation = value as Rotation;
      stage = 3;
    } else {
      return null;
    }
  }
  return choice;
}

/** What a comparison is: its columns, the rule and the kind of measures. */
export interface CompareState {
  /** The columns as keys (`columnKey`), in their order; the first one keeps its factor numbers. */
  columns: string[];
  rule: AssignmentRule;
  /** Of which measures; absent for model measures, the only kind the papers compare. */
  kind?: FactorKind;
}

/** The comparison of Tab. 17, the page's default. */
export const TABLE_17_STATE: CompareState = { columns: [...TABLE_17], rule: TABLE_17_RULE };

/** The query of the link to a comparison, e.g. "cols=comfy-paper-alpha-miner,…&rule=hair". */
export function compareQuery(state: CompareState): string {
  // Commas stay readable in the link; no id of a bundled dataset and no miner has one.
  const kind = state.kind === "log" ? "kind=log&" : "";
  return `${kind}cols=${state.columns.map(encodeURIComponent).join(",")}&rule=${state.rule}`;
}

/** The page of a comparison. */
export function compareHref(state: CompareState): string {
  return `/compare?${compareQuery(state)}`;
}

/** The page of the comparison of Tab. 17, for the entries in the toolbar and in Get started. */
export const COMPARE_HREF = `/compare?${compareQuery(TABLE_17_STATE)}`;

/**
 * The Inductive miner with the factor count of its paper beside 6 factors, under multiple
 * membership, as section 6 of Important Factors does: only MM loads on the fifth factor.
 */
export const COMPARE_K4_K6_STATE: CompareState = {
  columns: [columnKey("comfy-paper-inductive-miner"), columnKey("comfy-paper-inductive-miner", 6)],
  rule: "multi",
};
/** The link to that comparison. */
export const COMPARE_K4_K6_HREF = `/compare?${compareQuery(COMPARE_K4_K6_STATE)}`;

/** A comparison link read back into its state. */
export interface ParsedCompare {
  state: CompareState;
  /** Some part of the link could not be used; the rest, or Tab. 17, is shown instead. */
  invalid: boolean;
}

/** The rule of a comparison of own data that names none: the tool standard. */
const DEFAULT_RULE: AssignmentRule = "largest";

/**
 * The comparison a link asks for. Without `cols` it is Tab. 17, for log measures (`kind=log`)
 * none. Keys that are not a dataset `known` lists (with or without a factor count) or, for a
 * dataset of the session, one `own` lists, the same column twice and columns beyond the most are
 * left out; with fewer than two left, and for an unknown rule, Tab. 17's are taken (none for log
 * measures), and the link counts as invalid. The same dataset may be there twice with other
 * factor counts. `known` or `own` null accepts any key, e.g. before the lists are loaded.
 */
export function parseCompareQuery(
  params: URLSearchParams,
  known: ReadonlySet<string> | null,
  own: ReadonlySet<string> | null = null,
): ParsedCompare {
  const kind: FactorKind = params.get("kind") === "log" ? "log" : "model";
  const cols = params.get("cols");
  const ruleText = params.get("rule");
  let invalid = false;
  let columns = kind === "log" ? [] : [...TABLE_17];
  if (cols !== null) {
    const asked = cols.split(",").map((c) => c.trim()).filter(Boolean);
    const usable: string[] = [];
    for (const key of asked) {
      const column = parseColumnKey(key);
      if (!column) continue;
      const list = column.own ? own : known;
      if (list && !list.has(column.id)) continue;
      if (!usable.includes(key)) usable.push(key);
    }
    if (usable.length !== asked.length || usable.length > MAX_COLUMNS) invalid = true;
    if (usable.length >= MIN_COLUMNS) columns = usable.slice(0, MAX_COLUMNS);
    else invalid = true;
  }
  let rule = kind === "log" ? DEFAULT_RULE : TABLE_17_RULE;
  if (ruleText !== null) {
    if ((ASSIGNMENT_RULES as string[]).includes(ruleText)) rule = ruleText as AssignmentRule;
    else invalid = true;
  }
  return { state: { columns, rule, ...(kind === "log" ? { kind } : {}) }, invalid };
}

/**
 * The request of a comparison: every column of a bundled dataset with the settings of its paper,
 * one with a factor count of its own with that count, titled by `title` so that two columns of one
 * dataset differ in the downloads as well; every column of a dataset of the session with the
 * settings saved with it, its miner, count and rotation, titled by `ownTitle`.
 */
export function compareRequest(
  state: CompareState,
  title?: (id: string, k: number) => string,
  ownTitle?: (column: ColumnChoice) => string,
): CompareRequest {
  return {
    columns: state.columns.map((key): CompareColumnRequest => {
      const column = parseColumnKey(key);
      if (!column) return { bundled_id: key };
      if (column.own) {
        const options = {
          ...(column.k !== null && { n_factors: column.k }),
          ...(column.rotation && { rotation: column.rotation }),
        };
        return {
          dataset_id: column.id,
          ...(column.miner && { miner: column.miner }),
          ...(Object.keys(options).length > 0 && { options }),
          ...(ownTitle && { label: ownTitle(column).slice(0, 80) }),
        };
      }
      if (column.k === null) return { bundled_id: column.id };
      return { bundled_id: column.id, options: { n_factors: column.k }, ...(title && { label: title(column.id, column.k) }) };
    }),
    assignment_rule: state.rule,
  };
}

/** Whether two comparisons have the same kind, rule and columns in the same order. */
export function sameState(a: CompareState, b: CompareState): boolean {
  return (
    (a.kind ?? "model") === (b.kind ?? "model") &&
    a.rule === b.rule &&
    a.columns.length === b.columns.length &&
    a.columns.every((c, i) => c === b.columns[i])
  );
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

// --- solutions pinned for a comparison -----------------------------------------------------------

/** The solutions pinned in the loadings step, per kind: the columns of a comparison to come. */
export interface Pins {
  columns: string[];
  /** The rule of the solution pinned last, which the comparison takes for every column. */
  rule: AssignmentRule;
}

const PINS_KEY = "app.compare-pins-";

/** No pins, with the default rule. */
export const NO_PINS: Pins = { columns: [], rule: DEFAULT_RULE };

/** The pins of a kind kept in the browser; none where it keeps nothing. */
export function loadPins(kind: FactorKind): Pins {
  try {
    const saved = JSON.parse(localStorage.getItem(PINS_KEY + kind) ?? "null");
    if (!saved || !Array.isArray(saved.columns)) return NO_PINS;
    const columns = (saved.columns as unknown[])
      .filter((c): c is string => typeof c === "string" && parseColumnKey(c) !== null)
      .slice(0, MAX_COLUMNS);
    const rule = (ASSIGNMENT_RULES as string[]).includes(saved.rule) ? (saved.rule as AssignmentRule) : DEFAULT_RULE;
    return { columns, rule };
  } catch {
    return NO_PINS;
  }
}

/** Keeps the pins of a kind in the browser; no pins removes the entry. */
export function savePins(kind: FactorKind, pins: Pins) {
  try {
    if (pins.columns.length === 0) localStorage.removeItem(PINS_KEY + kind);
    else localStorage.setItem(PINS_KEY + kind, JSON.stringify(pins));
  } catch {
    /* storage blocked: the pins last for the page */
  }
}

/**
 * The pins with `key` added, under the rule of its solution, or taken off if it is pinned; no
 * more than a comparison holds.
 */
export function togglePin(pins: Pins, key: string, rule: AssignmentRule): Pins {
  if (pins.columns.includes(key)) return { ...pins, columns: pins.columns.filter((c) => c !== key) };
  if (pins.columns.length >= MAX_COLUMNS) return pins;
  return { columns: [...pins.columns, key], rule };
}

/** The pins without those of datasets the session no longer has. */
export function keepPins(pins: Pins, datasets: ReadonlySet<string>): Pins {
  const columns = pins.columns.filter((key) => {
    const column = parseColumnKey(key);
    return !column?.own || datasets.has(column.id);
  });
  return columns.length === pins.columns.length ? pins : { ...pins, columns };
}

/** The comparison of the pinned solutions, or null with fewer than two. */
export function pinsHref(kind: FactorKind, pins: Pins): string | null {
  if (pins.columns.length < MIN_COLUMNS) return null;
  return compareHref({ columns: pins.columns, rule: pins.rule, ...(kind === "log" ? { kind } : {}) });
}
