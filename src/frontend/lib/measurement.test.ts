import { describe, expect, it } from "vitest";
import type { Measurement } from "./api";
import { measurementRows, measurementTotals } from "./measurement";

const model: Measurement = {
  kind: "model",
  source: "logs",
  unit: "seconds",
  total_s: 9.5,
  inputs: [
    { input: "a.xes", read_s: 0.5, events: 100, traces: 10, variants: 4, activities: 6 },
    { input: "broken.xes", read_s: 0.1, error: "XMLSyntaxError: ..." },
  ],
  observations: [
    { observation: "a.xes / Inductive miner", input: "a.xes", miner: "Inductive miner", discovery_s: 2, discovery_run_s: 1.5, net: { places: 8, transitions: 9, arcs: 20 }, stages: { Size: 0.1 }, measures_s: 0.1 },
    { observation: "a.xes / Alpha miner", input: "a.xes", miner: "Alpha miner", discovery_s: 3, error: "discovery failed: ProMTimeout" },
  ],
};

describe("measurement", () => {
  it("gives a row per observation with the size of its input", () => {
    const rows = measurementRows(model);
    expect(rows.map((r) => r.observation)).toEqual(["a.xes / Inductive miner", "a.xes / Alpha miner", "broken.xes"]);
    expect(rows[0]).toMatchObject({ traces: 10, events: 100, read_s: 0.5, discovery_s: 2, compute_s: 0.1, net: { arcs: 20 } });
    // A log is read once for all its miners, so both rows show the same reading.
    expect(rows[1].read_s).toBe(0.5);
    expect(rows[1].error).toMatch(/ProMTimeout/);
    // An input that could not be read gets a row of its own.
    expect(rows[2]).toMatchObject({ input: "broken.xes", error: "XMLSyntaxError: ..." });
  });

  it("sums each stage, reading each log once", () => {
    expect(measurementTotals(model)).toEqual({ read_s: 0.6, discovery_s: 5, compute_s: 0.1, total_s: 9.5 });
  });

  it("takes the feature groups of a log dataset as its computation", () => {
    const log: Measurement = {
      kind: "log", source: "logs", unit: "seconds", total_s: 1,
      inputs: [{ input: "l.xes", read_s: 0.2, events: 50, traces: 5 }],
      observations: [{ observation: "l.xes", input: "l.xes", stages: { simple_stats: 0.1, trace_length: 0.3 }, features_s: 0.4 }],
    };
    expect(measurementRows(log)[0]).toMatchObject({ compute_s: 0.4, read_s: 0.2, traces: 5 });
  });
});
