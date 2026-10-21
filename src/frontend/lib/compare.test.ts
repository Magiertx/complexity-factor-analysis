import { describe, expect, it } from "vitest";
import {
  COMPARE_HREF,
  MAX_COLUMNS,
  NO_PINS,
  TABLE_17,
  cellInRow,
  columnKey,
  compareQuery,
  compareRequest,
  dimensionLabel,
  groupRows,
  isOwnId,
  keepPins,
  ownColumnKey,
  pairTint,
  parseColumnKey,
  parseCompareQuery,
  pinsHref,
  sameState,
  toggleColumn,
  togglePin,
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

describe("the tint of a pair", () => {
  it("is none for a pair never in one dimension or never analysed, and darker the more often", () => {
    expect(pairTint(0, 3)).toBe(0);
    expect(pairTint(2, 0)).toBe(0);
    expect(pairTint(1, 4)).toBeGreaterThan(0);
    expect(pairTint(2, 4)).toBeGreaterThan(pairTint(1, 4));
    expect(pairTint(4, 4)).toBeGreaterThan(pairTint(2, 4));
    expect(pairTint(9, 4)).toBe(pairTint(4, 4));
    expect(pairTint(4, 4)).toBeLessThanOrEqual(0.3);
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

describe("columns of datasets of the session", () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const OTHER = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

  it("name the dataset, the miner, the factor count and the rotation", () => {
    expect(isOwnId(ID)).toBe(true);
    expect(isOwnId("comfy-paper-alpha-miner")).toBe(false);
    const key = ownColumnKey(ID, { miner: "Inductive miner", k: 4, rotation: "promax" });
    expect(key).toBe(`${ID}~mInductive miner~k4~rpromax`);
    expect(parseColumnKey(key)).toEqual({ id: ID, k: 4, own: true, miner: "Inductive miner", rotation: "promax" });
    expect(parseColumnKey(ID)).toEqual({ id: ID, k: null, own: true, miner: null, rotation: null });
    expect(parseColumnKey(ownColumnKey(ID, { k: 6 }))).toEqual({ id: ID, k: 6, own: true, miner: null, rotation: null });
    // Each part once, in its order, and readable.
    for (const bad of [`${ID}~k4~mAlpha miner`, `${ID}~k4~k5`, `${ID}~rspin`, `${ID}~m`, `${ID}~x1`, `${ID}~k0`]) {
      expect(parseColumnKey(bad), bad).toBeNull();
    }
  });

  it("travel in the link and are checked against the datasets of the session", () => {
    const a = ownColumnKey(ID, { miner: "Alpha miner" });
    const b = ownColumnKey(ID, { miner: "Inductive miner" });
    const state = { columns: [a, b], rule: "largest" as const };
    const query = compareQuery(state);
    expect(query).toBe(`cols=${ID}~mAlpha%20miner,${ID}~mInductive%20miner&rule=largest`);
    expect(parseCompareQuery(new URLSearchParams(query), KNOWN, new Set([ID]))).toEqual({ state, invalid: false });
    // A dataset the session no longer has is left out.
    const gone = parseCompareQuery(new URLSearchParams(`cols=${a},${b},${OTHER}`), KNOWN, new Set([ID]));
    expect(gone.state.columns).toEqual([a, b]);
    expect(gone.invalid).toBe(true);
    // Mixed with a bundled dataset.
    const mixed = parseCompareQuery(new URLSearchParams(`cols=comfy-paper-alpha-miner,${a}`), KNOWN, null);
    expect(mixed.state.columns).toEqual(["comfy-paper-alpha-miner", a]);
  });

  it("of log measures say their kind and fall back to nothing", () => {
    const a = ownColumnKey(ID);
    const b = ownColumnKey(OTHER);
    const state = { columns: [a, b], rule: "multi" as const, kind: "log" as const };
    expect(compareQuery(state)).toBe(`kind=log&cols=${a},${b}&rule=multi`);
    expect(parseCompareQuery(new URLSearchParams(compareQuery(state)), null)).toEqual({ state, invalid: false });
    expect(parseCompareQuery(new URLSearchParams("kind=log"), null)).toEqual({
      state: { columns: [], rule: "largest", kind: "log" },
      invalid: false,
    });
    expect(sameState(state, { ...state, kind: undefined })).toBe(false);
  });

  it("ask for the saved settings with the miner, count and rotation of the column", () => {
    const state = {
      columns: [ownColumnKey(ID, { miner: "Alpha miner", k: 4, rotation: "varimax" }), ownColumnKey(OTHER), "comfy-paper-alpha-miner"],
      rule: "hair" as const,
    };
    const request = compareRequest(state, undefined, (c) => `${c.id.slice(0, 4)} ${c.miner ?? "all"}`);
    expect(request.columns).toEqual([
      { dataset_id: ID, miner: "Alpha miner", options: { n_factors: 4, rotation: "varimax" }, label: "0f8f Alpha miner" },
      { dataset_id: OTHER, label: "7c9e all" },
      { bundled_id: "comfy-paper-alpha-miner" },
    ]);
  });
});

describe("pinned solutions", () => {
  const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const four = ownColumnKey(ID, { k: 4, rotation: "varimax" });
  const six = ownColumnKey(ID, { k: 6, rotation: "varimax" });

  it("are added and taken off, with the rule of the last one", () => {
    const one = togglePin(NO_PINS, four, "multi");
    expect(one).toEqual({ columns: [four], rule: "multi" });
    const two = togglePin(one, six, "hair");
    expect(two).toEqual({ columns: [four, six], rule: "hair" });
    expect(togglePin(two, four, "largest")).toEqual({ columns: [six], rule: "hair" });
    // No more than a comparison holds.
    let full = NO_PINS;
    for (let k = 1; k <= MAX_COLUMNS + 2; k++) full = togglePin(full, ownColumnKey(ID, { k }), "largest");
    expect(full.columns).toHaveLength(MAX_COLUMNS);
  });

  it("open a comparison from two on, and go with their dataset", () => {
    expect(pinsHref("model", togglePin(NO_PINS, four, "multi"))).toBeNull();
    const pins = { columns: [four, six], rule: "multi" as const };
    expect(pinsHref("model", pins)).toBe(`/compare?cols=${four},${six}&rule=multi`);
    expect(pinsHref("log", pins)).toBe(`/compare?kind=log&cols=${four},${six}&rule=multi`);
    expect(keepPins(pins, new Set([ID]))).toBe(pins);
    expect(keepPins({ ...pins, columns: [...pins.columns, "comfy-paper-alpha-miner"] }, new Set()).columns).toEqual([
      "comfy-paper-alpha-miner",
    ]);
  });
});
