import { describe, expect, it } from "vitest";
import {
  COMPARE_HREF,
  MAX_COLUMNS,
  TABLE_17,
  cellInRow,
  columnKey,
  compareQuery,
  compareRequest,
  dimensionLabel,
  groupRows,
  parseColumnKey,
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

describe("a factor count per column", () => {
  const INDUCTIVE = "comfy-paper-inductive-miner";
  const six = `${INDUCTIVE}~k6`;

  it("names a column by its dataset and its factor count", () => {
    expect(columnKey(INDUCTIVE)).toBe(INDUCTIVE);
    expect(columnKey(INDUCTIVE, 6)).toBe(six);
    expect(parseColumnKey(INDUCTIVE)).toEqual({ id: INDUCTIVE, k: null });
    expect(parseColumnKey(six)).toEqual({ id: INDUCTIVE, k: 6 });
    expect(parseColumnKey(`${INDUCTIVE}~k12`)).toEqual({ id: INDUCTIVE, k: 12 });
    for (const bad of ["", "~k6", `${INDUCTIVE}~k0`, `${INDUCTIVE}~k100`, `${INDUCTIVE}~kx`, `${INDUCTIVE}~6`, `${INDUCTIVE}~k6~k7`]) {
      expect(parseColumnKey(bad), bad).toBeNull();
    }
  });

  it("opens the same dataset twice when the factor counts differ", () => {
    const q = new URLSearchParams(`cols=${INDUCTIVE},${six}&rule=multi`);
    const { state, invalid } = parseCompareQuery(q, KNOWN);
    expect(state).toEqual({ columns: [INDUCTIVE, six], rule: "multi" });
    expect(invalid).toBe(false);
    // ... and writes the link as it read it.
    expect(compareQuery(state)).toBe(`cols=${INDUCTIVE},${INDUCTIVE}~k6&rule=multi`);
  });

  it("leaves out a repeated column, an unknown dataset and a count it cannot read", () => {
    const q = new URLSearchParams(`cols=${INDUCTIVE}~k06,${six},${INDUCTIVE}~kx,nope~k4,comfy-paper-alpha-miner&rule=hair`);
    const { state, invalid } = parseCompareQuery(q, KNOWN);
    // "~k06" is no count either, and "~k6" stands once.
    expect(state.columns).toEqual([six, "comfy-paper-alpha-miner"]);
    expect(invalid).toBe(true);
    expect(parseCompareQuery(new URLSearchParams(`cols=${six},${six}`), KNOWN).invalid).toBe(true);
  });

  it("asks for a count with the title of its column", () => {
    const state = { columns: [INDUCTIVE, six], rule: "multi" as const };
    expect(compareRequest(state).columns).toEqual([{ bundled_id: INDUCTIVE }, { bundled_id: INDUCTIVE, options: { n_factors: 6 } }]);
    expect(compareRequest(state, (id, k) => `${id}, k = ${k}`).columns[1]).toEqual({
      bundled_id: INDUCTIVE,
      options: { n_factors: 6 },
      label: `${INDUCTIVE}, k = 6`,
    });
    // A column of the paper has no title of its own.
    expect(compareRequest(state, () => "x").columns[0]).toEqual({ bundled_id: INDUCTIVE });
  });

  it("puts a count after the dataset's own column when columns are switched", () => {
    const order = ["a", "b", "c"];
    expect(toggleColumn(["a", "c"], "b~k6", order)).toEqual(["a", "b~k6", "c"]);
    expect(toggleColumn(["a", "a~k6", "c"], "a", order)).toEqual(["a~k6", "c"]);
    expect(toggleColumn(["a~k6", "c"], "a", order)).toEqual(["a", "a~k6", "c"]);
    expect(toggleColumn(["a", "a~k8"], "a~k6", order)).toEqual(["a", "a~k6", "a~k8"]);
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
