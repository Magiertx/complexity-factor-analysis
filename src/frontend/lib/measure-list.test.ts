import { describe, expect, it } from "vitest";
import type { FactorAnalysis } from "./api";
import { defaultOptions } from "./factor-analysis";
import { arrangeMeasures, dependentGroups, matchesQuery, measureInfo, toggleExcluded, type ArrangeInput } from "./measure-list";

const MEASURES = ["n_variants", "trace_len_min", "structure", "eventropy_trace", "n_edges_dfg", "cyclomatic_number_dfg"];
const NAMES: Record<string, string> = Object.fromEntries(MEASURES.map((m) => [m, m]));
const GROUPS: Record<string, string> = {
  n_variants: "variants",
  trace_len_min: "trace_length",
  structure: "graph",
  eventropy_trace: "entropy",
  n_edges_dfg: "graph",
  cyclomatic_number_dfg: "graph",
};

function analysis(): FactorAnalysis {
  return {
    n_observations: 100,
    used_measures: ["n_variants", "trace_len_min", "eventropy_trace", "n_edges_dfg", "cyclomatic_number_dfg"],
    bartlett: { chi_square: 120, df: 6, p_value: 0, alpha: 0.05, passed: true },
    kmo: {
      overall: 0.8,
      per_measure: { n_variants: 0.95, trace_len_min: 0.55, eventropy_trace: 0.9, n_edges_dfg: 0.7, cyclomatic_number_dfg: 0.72 },
      threshold: 0.6,
      passed: true,
    },
    msa_filter: { enabled: true, removed: [{ measure: "structure", msa: 0.28, step: 1 }] },
    eigenvalues: [2.5, 1.1, 0.3, 0.1, 0.05],
    suggested_n_factors: 2,
    n_factors: 2,
    rotation: "varimax",
    loading_threshold: 0.5,
    communality_threshold: 0.5,
    loadings: {},
    structure_loadings: null,
    factor_correlations: null,
    communalities: {},
    uniquenesses: {},
    variance: { ss_loadings: [], proportion: [], cumulative: [], explained: 0.8 },
    factors: [],
    unassigned: [],
    warnings: [],
    warning_details: [
      { code: "singular", message: "", params: { groups: "n_edges_dfg, cyclomatic_number_dfg" } },
    ],
  };
}

function input(overrides: Partial<ArrangeInput> = {}): ArrangeInput {
  const info = measureInfo(MEASURES, analysis(), { excluded: [], msa_threshold: 0.6 });
  return {
    measures: MEASURES,
    info,
    name: (m) => NAMES[m],
    group: (m) => GROUPS[m] ?? null,
    groupOrder: ["variants", "trace_length", "graph", "entropy"],
    sort: "dataset",
    grouping: "none",
    query: "",
    onlyNotable: false,
    notable: new Set(["structure", "n_edges_dfg", "cyclomatic_number_dfg", "trace_len_min"]),
    ...overrides,
  };
}

describe("what became of each measure", () => {
  it("reads the linearly dependent groups of the notice", () => {
    expect(dependentGroups(analysis())).toEqual([["n_edges_dfg", "cyclomatic_number_dfg"]]);
    expect(dependentGroups(null)).toEqual([]);
  });

  it("tells removed, dependent, below the threshold, excluded and used apart", () => {
    const info = measureInfo(MEASURES, analysis(), { excluded: ["eventropy_trace"], msa_threshold: 0.6 });
    expect(info.get("structure")).toEqual({ status: "removed", msa: 0.28, round: 1 });
    expect(info.get("n_edges_dfg")).toMatchObject({ status: "dependent", partners: ["cyclomatic_number_dfg"] });
    expect(info.get("trace_len_min")).toMatchObject({ status: "below", msa: 0.55 });
    expect(info.get("eventropy_trace")).toEqual({ status: "excluded", msa: null });
    expect(info.get("n_variants")).toMatchObject({ status: "used", msa: 0.95 });
  });
});

describe("the list of measures", () => {
  it("shows the notable measures first and the others below, each in dataset order", () => {
    expect(arrangeMeasures(input())).toEqual([
      { id: "notable", rows: ["trace_len_min", "structure", "n_edges_dfg", "cyclomatic_number_dfg"] },
      { id: "other", rows: ["n_variants", "eventropy_trace"] },
    ]);
  });

  it("sorts by name or by MSA, lowest first", () => {
    const byMsa = arrangeMeasures(input({ sort: "msa", notable: new Set() }));
    expect(byMsa[0].rows).toEqual([
      "structure",
      "trace_len_min",
      "n_edges_dfg",
      "cyclomatic_number_dfg",
      "eventropy_trace",
      "n_variants",
    ]);
    const byName = arrangeMeasures(input({ sort: "name", notable: new Set() }));
    expect(byName[0].rows).toEqual([...MEASURES].sort());
  });

  it("groups by feature group, in the order of the groups", () => {
    const sections = arrangeMeasures(input({ grouping: "group" }));
    expect(sections.map((s) => [s.group, s.rows])).toEqual([
      ["variants", ["n_variants"]],
      ["trace_length", ["trace_len_min"]],
      ["graph", ["structure", "n_edges_dfg", "cyclomatic_number_dfg"]],
      ["entropy", ["eventropy_trace"]],
    ]);
  });

  it("searches names and keys, and shows only the notable ones on request", () => {
    expect(arrangeMeasures(input({ query: "DFG" }))[0].rows).toEqual(["n_edges_dfg", "cyclomatic_number_dfg"]);
    expect(arrangeMeasures(input({ onlyNotable: true }))).toEqual([
      { id: "notable", rows: ["trace_len_min", "structure", "n_edges_dfg", "cyclomatic_number_dfg"] },
    ]);
  });

  it("matches a search by every word, in the name or the key, in any case", () => {
    expect(matchesQuery("", "Edges of the DFG", "n_edges_dfg")).toBe(true);
    expect(matchesQuery("  ", "Edges of the DFG", "n_edges_dfg")).toBe(true);
    expect(matchesQuery("EDGES dfg", "Edges of the DFG", "n_edges_dfg")).toBe(true);
    expect(matchesQuery("n_edges", "Edges of the DFG", "n_edges_dfg")).toBe(true);
    expect(matchesQuery("edges entropy", "Edges of the DFG", "n_edges_dfg")).toBe(false);
  });

  it("only changes the display, never the column order or the measures excluded", () => {
    const measures = [...MEASURES];
    const options = { ...defaultOptions("log"), excluded: ["structure", "n_variants"] };
    // The body of the analysis request is the options as JSON.
    const before = JSON.stringify(options);
    for (const sort of ["dataset", "name", "msa"] as const) {
      for (const grouping of ["none", "group"] as const) {
        arrangeMeasures(input({ measures, sort, grouping, query: "a", onlyNotable: grouping === "group" }));
      }
    }
    expect(measures).toEqual(MEASURES);
    expect(options.excluded).toEqual(["structure", "n_variants"]);
    expect(JSON.stringify(options)).toBe(before);
    // Ticking a measure in a sorted list adds it at the end; the others keep their order.
    expect(toggleExcluded(options.excluded, "trace_len_min")).toEqual(["structure", "n_variants", "trace_len_min"]);
    expect(toggleExcluded(options.excluded, "structure")).toEqual(["n_variants"]);
    expect(options.excluded).toEqual(["structure", "n_variants"]);
  });
});
