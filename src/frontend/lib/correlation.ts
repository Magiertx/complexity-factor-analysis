// The correlation map of the suitability step: which measures it shows in which order, and the
// colour of a cell. The server sends the matrix once, in the order of a clustering; the order by
// factor is made here from the analysis on screen, as the loadings matrix does it, so a change of the
// number of factors or the rotation reorders the map without a request.

import type { Correlations, FactorAnalysis } from "./api";

/** The pairs with at least this |r| are outlined on the map (the server lists them the same way). */
export const HIGH_CORRELATION = 0.95;

/** The map is drawn as SVG up to this many measures, with every cell an element, and on a canvas above. */
export const SVG_LIMIT = 40;

/** What the map is ordered by: the dimensions of the analysis on screen or a clustering of the correlations. */
export type MapOrder = "factor" | "cluster";

/** A run of measures of the map: the dimension they belong to (null: none) and their rows `from` to `to` (exclusive). */
export interface MapBlock {
  factor: number | null;
  from: number;
  to: number;
}

export interface MapLayout {
  /** The measures shown, as the rows and the columns of the map. */
  measures: string[];
  /** The position of each of them in `Correlations.measures`, to read the matrix. */
  index: number[];
  /** Where the dimensions begin and end; null in the clustered order. */
  blocks: MapBlock[] | null;
}

/**
 * The measures by the dimensions of an analysis: each factor's measures, strongest loading first,
 * then the measures without a dimension: those the analysis kept but no factor has, then those the
 * MSA filter removed, then any other. A measure on several factors stands in the first. The same
 * groups as the server's `correlations.factor_groups`, so the figure and the screen agree.
 */
export function factorGroups(
  analysis: FactorAnalysis,
  measures: readonly string[],
): { factor: number | null; measures: string[] }[] {
  const available = new Set(measures);
  const seen = new Set<string>();
  const groups: { factor: number | null; measures: string[] }[] = [];
  for (const factor of analysis.factors) {
    const members: string[] = [];
    for (const entry of factor.measures) {
      if (available.has(entry.measure) && !seen.has(entry.measure)) {
        seen.add(entry.measure);
        members.push(entry.measure);
      }
    }
    if (members.length > 0) groups.push({ factor: factor.index, measures: members });
  }
  const rest: string[] = [];
  const add = (m: string) => {
    if (available.has(m) && !seen.has(m) && !rest.includes(m)) rest.push(m);
  };
  analysis.used_measures.forEach(add);
  analysis.msa_filter.removed.forEach((r) => add(r.measure));
  measures.forEach(add);
  if (rest.length > 0) groups.push({ factor: null, measures: rest });
  return groups;
}

/**
 * The measures of the map in the order chosen, without the `hidden` ones (those excluded by hand).
 * By factor needs the analysis; without it the map is clustered.
 */
export function mapLayout(
  data: Correlations,
  order: MapOrder,
  analysis: FactorAnalysis | null,
  hidden: ReadonlySet<string>,
): MapLayout {
  const position = new Map(data.measures.map((m, i) => [m, i]));
  const shown = data.measures.filter((m) => !hidden.has(m));
  if (order === "factor" && analysis) {
    const groups = factorGroups(analysis, shown);
    const measures = groups.flatMap((g) => g.measures);
    const blocks: MapBlock[] = [];
    let at = 0;
    for (const g of groups) {
      blocks.push({ factor: g.factor, from: at, to: at + g.measures.length });
      at += g.measures.length;
    }
    return { measures, index: measures.map((m) => position.get(m)!), blocks };
  }
  return { measures: shown, index: shown.map((m) => position.get(m)!), blocks: null };
}

/** The correlation of the measures at rows `i` and `j` of the layout. */
export function layoutValue(data: Correlations, layout: MapLayout, i: number, j: number): number {
  return data.r[layout.index[i]][layout.index[j]];
}

/** Whether the pair is one the map outlines: strongly correlated, and not a measure with itself. */
export function isHigh(r: number, i: number, j: number): boolean {
  return i !== j && Math.abs(r) >= HIGH_CORRELATION;
}

/** The strength of the colour of a cell, 0 to 0.9: the share of its |r|, so that 0 is the colour of the page. */
export function cellAlpha(r: number): number {
  return Math.min(1, Math.abs(r)) * 0.9;
}

/** A colour of the tokens of the theme: orange where r is negative, the accent where it is positive; `strength` fades it, e.g. for a table. */
export function cellColor(r: number, strength = 1): string {
  return `rgb(var(${r < 0 ? "--negative" : "--accent"}) / ${(cellAlpha(r) * strength).toFixed(3)})`;
}

/** The two tokens of a theme as numbers, for a canvas, which cannot use `var()`: "234 88 12" as [234, 88, 12]. */
export function parseToken(value: string): [number, number, number] {
  const parts = value.trim().split(/[\s,]+/).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

/** The colour of a cell for a canvas, from the parsed tokens. */
export function cellRgba(r: number, negative: [number, number, number], positive: [number, number, number]): string {
  const [red, green, blue] = r < 0 ? negative : positive;
  return `rgba(${red}, ${green}, ${blue}, ${cellAlpha(r).toFixed(3)})`;
}

/** The pair of measures at a point of the map, or null outside it. `cell` is the side of a cell in pixels. */
export function cellAt(x: number, y: number, cell: number, n: number): { i: number; j: number } | null {
  if (x < 0 || y < 0 || cell <= 0) return null;
  const j = Math.floor(x / cell);
  const i = Math.floor(y / cell);
  return i < n && j < n ? { i, j } : null;
}

/** The side of a cell in pixels for `n` measures in `width` pixels of room, between the limits. */
export function cellSize(n: number, width: number): number {
  const limit = n <= SVG_LIMIT ? { min: 12, max: 26 } : { min: 3, max: 12 };
  return Math.max(limit.min, Math.min(limit.max, Math.floor(width / Math.max(n, 1))));
}
