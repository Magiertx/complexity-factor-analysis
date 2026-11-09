import { describe, expect, it } from "vitest";
import type { Correlations, FactorAnalysis } from "./api";
import {
  HIGH_CORRELATION,
  SVG_LIMIT,
  cellAlpha,
  cellAt,
  cellColor,
  cellRgba,
  cellSize,
  factorGroups,
  isHigh,
  layoutValue,
  mapLayout,
  parseToken,
} from "./correlation";

// Five measures in the order of a clustering (as the server sends them): a and b move together,
// c is removed by the MSA filter, d and e load on the second factor, e also on the first.
const MEASURES = ["b", "a", "e", "c", "d"];
const R = [
  [1, 0.97, 0.2, -0.1, 0.3],
  [0.97, 1, 0.25, -0.05, 0.35],
  [0.2, 0.25, 1, 0.1, 0.6],
  [-0.1, -0.05, 0.1, 1, -0.4],
  [0.3, 0.35, 0.6, -0.4, 1],
];

const data: Correlations = {
  n_observations: 50,
  order: "cluster",
  measures: MEASURES,
  r: R,
  groups: null,
  high: { threshold: HIGH_CORRELATION, count: 1, pairs: [{ a: "a", b: "b", r: 0.97 }] },
  top: {},
  miner: null,
};

function analysis(): FactorAnalysis {
  return {
    used_measures: ["a", "b", "d", "e"],
    msa_filter: { enabled: true, removed: [{ measure: "c", msa: 0.4, step: 1 }] },
    factors: [
      { index: 0, measures: [{ measure: "a", loading: 0.9 }, { measure: "b", loading: 0.8 }, { measure: "e", loading: 0.5 }] },
      { index: 1, measures: [{ measure: "e", loading: 0.7 }, { measure: "d", loading: 0.6 }] },
    ],
  } as unknown as FactorAnalysis;
}

describe("the order by factor", () => {
  it("groups each factor's measures strongest first, then those without a dimension", () => {
    const groups = factorGroups(analysis(), ["a", "b", "c", "d", "e"]);
    expect(groups).toEqual([
      { factor: 0, measures: ["a", "b", "e"] },
      { factor: 1, measures: ["d"] },
      { factor: null, measures: ["c"] },
    ]);
  });

  it("puts the measures the analysis kept but no factor has before those the MSA filter removed", () => {
    const a = analysis();
    a.used_measures = ["a", "b", "x", "d", "e"];
    const groups = factorGroups(a, ["a", "b", "c", "d", "e", "x", "y"]);
    // x is used without a factor, c was removed by the filter, y the analysis does not know.
    expect(groups.at(-1)).toEqual({ factor: null, measures: ["x", "c", "y"] });
  });

  it("leaves out a factor none of the shown measures loads on", () => {
    const groups = factorGroups(analysis(), ["d", "c"]);
    expect(groups).toEqual([{ factor: 1, measures: ["d"] }, { factor: null, measures: ["c"] }]);
  });
});

describe("the layout of the map", () => {
  it("keeps the order of the clustering and reads the matrix at the measures' places", () => {
    const layout = mapLayout(data, "cluster", analysis(), new Set());
    expect(layout.measures).toEqual(MEASURES);
    expect(layout.blocks).toBeNull();
    expect(layoutValue(data, layout, 0, 1)).toBe(0.97);
  });

  it("orders by factor with the blocks of the dimensions, and the cell of a pair is the same", () => {
    const layout = mapLayout(data, "factor", analysis(), new Set());
    expect(layout.measures).toEqual(["a", "b", "e", "d", "c"]);
    expect(layout.blocks).toEqual([
      { factor: 0, from: 0, to: 3 },
      { factor: 1, from: 3, to: 4 },
      { factor: null, from: 4, to: 5 },
    ]);
    // r of d and e is 0.6 wherever they stand.
    const d = layout.measures.indexOf("d");
    const e = layout.measures.indexOf("e");
    expect(layoutValue(data, layout, d, e)).toBe(0.6);
    expect(layoutValue(data, layout, e, d)).toBe(0.6);
    expect(layoutValue(data, layout, 0, 1)).toBe(0.97);
  });

  it("leaves the measures excluded by hand out of either order", () => {
    const hidden = new Set(["a", "d"]);
    expect(mapLayout(data, "cluster", analysis(), hidden).measures).toEqual(["b", "e", "c"]);
    const byFactor = mapLayout(data, "factor", analysis(), hidden);
    expect(byFactor.measures).toEqual(["b", "e", "c"]);
    expect(byFactor.blocks).toEqual([
      { factor: 0, from: 0, to: 2 },
      { factor: null, from: 2, to: 3 },
    ]);
  });

  it("is clustered without an analysis", () => {
    expect(mapLayout(data, "factor", null, new Set()).blocks).toBeNull();
  });
});

describe("the cells", () => {
  it("outlines strongly correlated pairs of different measures, never a measure with itself", () => {
    expect(isHigh(0.95, 0, 1)).toBe(true);
    expect(isHigh(-0.99, 0, 1)).toBe(true);
    expect(isHigh(0.949, 0, 1)).toBe(false);
    expect(isHigh(1, 2, 2)).toBe(false);
  });

  it("colours negative values slate and positive ones with the data colour, stronger the larger |r|", () => {
    expect(cellColor(-0.5)).toBe("rgb(var(--negative) / 0.450)");
    expect(cellColor(0.5)).toBe("rgb(var(--data) / 0.450)");
    expect(cellAlpha(0)).toBe(0);
    expect(cellAlpha(-1)).toBeCloseTo(0.9);
    expect(cellAlpha(1.2)).toBeCloseTo(0.9);
    // Fainter for a table, where the numbers must stay readable.
    expect(cellColor(-0.5, 0.5)).toBe("rgb(var(--negative) / 0.225)");
  });

  it("reads the tokens of the theme as numbers for the canvas", () => {
    expect(parseToken(" 71 85 105 ")).toEqual([71, 85, 105]);
    expect(parseToken("")).toEqual([0, 0, 0]);
    expect(cellRgba(-1, [234, 88, 12], [225, 29, 72])).toBe("rgba(234, 88, 12, 0.900)");
    expect(cellRgba(0, [234, 88, 12], [225, 29, 72])).toBe("rgba(225, 29, 72, 0.000)");
  });

  it("finds the cell at a point, and none outside the map", () => {
    expect(cellAt(0, 0, 10, 4)).toEqual({ i: 0, j: 0 });
    expect(cellAt(25, 31, 10, 4)).toEqual({ i: 3, j: 2 });
    expect(cellAt(40, 5, 10, 4)).toBeNull();
    expect(cellAt(-1, 5, 10, 4)).toBeNull();
    expect(cellAt(5, 5, 0, 4)).toBeNull();
  });

  it("sizes the cells to the room, between a readable and a handy limit", () => {
    expect(cellSize(10, 1000)).toBe(26);
    expect(cellSize(SVG_LIMIT, 300)).toBe(12);
    // Over the limit of the SVG the cells may be small.
    expect(cellSize(123, 900)).toBe(7);
    expect(cellSize(123, 200)).toBe(3);
    expect(cellSize(60, 3000)).toBe(12);
  });
});
