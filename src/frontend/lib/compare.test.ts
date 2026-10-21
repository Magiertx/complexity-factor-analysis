import { describe, expect, it } from "vitest";
import {
  COMPARE_HREF,
  MAX_COLUMNS,
  TABLE_17,
  cellInRow,
  compareQuery,
  compareRequest,
  dimensionLabel,
  groupRows,
  parseCompareQuery,
  sameState,
  toggleColumn,
} from "./compare";

const KNOWN = new Set([...TABLE_17, "comfy-paper-heuristics-miner", "comfy-paper-alpha-plus-miner", "comfy-paper-alpha-dollar-miner"]);

describe("the link of a comparison", () => {
  it("opens Tab. 17 without parameters", () => {
    const { state, invalid } = parseCompareQuery(new URLSearchParams(""), KNOWN);
    expect(state).toEqual({ columns: [...TABLE_17], rule: "hair" });
    expect(invalid).toBe(false);
  });

  it("reads back what it writes", () => {
    const state = { columns: ["comfy-paper-inductive-miner", "comfy-paper-alpha-miner"], rule: "multi" as const };
    const parsed = parseCompareQuery(new URLSearchParams(compareQuery(state)), KNOWN);
    expect(parsed).toEqual({ state, invalid: false });
    expect(compareQuery(state)).toBe("cols=comfy-paper-inductive-miner,comfy-paper-alpha-miner&rule=multi");
    expect(COMPARE_HREF).toBe(`/compare?cols=${TABLE_17.join(",")}&rule=hair`);
  });

  it("leaves out unknown and repeated ids and says so", () => {
    const q = new URLSearchParams("cols=comfy-paper-alpha-miner,nope,comfy-paper-alpha-miner,comfy-paper-inductive-miner&rule=largest");
    const { state, invalid } = parseCompareQuery(q, KNOWN);
    expect(state).toEqual({ columns: ["comfy-paper-alpha-miner", "comfy-paper-inductive-miner"], rule: "largest" });
    expect(invalid).toBe(true);
  });

  it("falls back to Tab. 17 with fewer than two columns or an unknown rule", () => {
    expect(parseCompareQuery(new URLSearchParams("cols=comfy-paper-alpha-miner"), KNOWN)).toEqual({
      state: { columns: [...TABLE_17], rule: "hair" },
      invalid: true,
    });
    const rule = parseCompareQuery(new URLSearchParams("cols=comfy-paper-alpha-miner,comfy-paper-inductive-miner&rule=lieben"), KNOWN);
    expect(rule.state.rule).toBe("hair");
    expect(rule.invalid).toBe(true);
  });

  it("takes at most eight columns", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `d${i}`);
    const { state, invalid } = parseCompareQuery(new URLSearchParams(`cols=${ids.join(",")}`), null);
    expect(state.columns).toHaveLength(MAX_COLUMNS);
    expect(invalid).toBe(true);
  });

  it("asks for every column with its paper settings", () => {
    expect(compareRequest({ columns: ["a", "b"], rule: "hair" })).toEqual({
      columns: [{ bundled_id: "a" }, { bundled_id: "b" }],
      assignment_rule: "hair",
    });
    expect(sameState({ columns: ["a", "b"], rule: "hair" }, { columns: ["a", "b"], rule: "hair" })).toBe(true);
    expect(sameState({ columns: ["a", "b"], rule: "hair" }, { columns: ["b", "a"], rule: "hair" })).toBe(false);
  });
});

describe("the columns and cells", () => {
  it("switches a column on in the order of the list", () => {
    const order = ["a", "b", "c", "d"];
    expect(toggleColumn(["a", "c"], "b", order)).toEqual(["a", "b", "c"]);
    expect(toggleColumn(["a", "b", "c"], "b", order)).toEqual(["a", "c"]);
    // An id the list does not know stays at the end.
    expect(toggleColumn(["x", "c"], "a", order)).toEqual(["a", "c", "x"]);
  });

  it("names dimensions from 1 and groups the rows by them", () => {
    expect(dimensionLabel(0)).toBe("D1");
    const rows = [{ dimension: 0 }, { dimension: 0 }, { dimension: 2 }, { dimension: null }];
    expect(groupRows(rows).map((g) => [g.dimension, g.rows.length])).toEqual([
      [0, 2],
      [2, 1],
      [null, 1],
    ]);
  });

  it("knows whether a cell is in the dimension of its row", () => {
    const cell = {
      status: "assigned" as const,
      factors: [2, 0],
      dimensions: [1, 0],
      loadings: [0.6, 0.5],
      communality: 0.7,
      cross_loading: true,
    };
    expect(cellInRow(cell, 1)).toBe(true);
    expect(cellInRow(cell, 0)).toBe(false);
    expect(cellInRow({ status: "absent" }, 0)).toBe(false);
  });
});
