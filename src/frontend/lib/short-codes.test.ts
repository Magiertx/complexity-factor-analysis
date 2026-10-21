import { describe, expect, it } from "vitest";
import { codeIndexes, codesOf, hasCodes, measureLabels } from "./short-codes";

const catalog = [
  { key: "Size", name: "Size", description: "Number of places and transitions.", short: "size" },
  { key: "Coefficient of network connectivity", name: "Coefficient of network connectivity", description: "Arcs per node.", short: "CNC" },
  { key: "n_events", name: "n_events", description: "Simple statistics (feeed).", short: "mag" },
  { key: "own", name: "own", description: "" },
];
const names = new Map(catalog.map((m) => [m.key, m.name]));
const descriptions = new Map(catalog.map((m) => [m.key, m.description || undefined]));
const codes = codesOf(catalog);

describe("short codes", () => {
  it("come from the catalog, for the measures that have one", () => {
    expect(codes.get("Coefficient of network connectivity")).toBe("CNC");
    expect(codes.has("own")).toBe(false);
    expect(hasCodes(codes, ["own", "Size"])).toBe(true);
    // A CSV of its own columns has none, so the switch has nothing to change.
    expect(hasCodes(codes, ["own", "x"])).toBe(false);
  });

  it("replace the name and keep it in the tooltip", () => {
    const on = measureLabels(names, descriptions, codes, true);
    expect(on.name("Coefficient of network connectivity")).toBe("CNC");
    expect(on.description("Coefficient of network connectivity")).toBe("Coefficient of network connectivity: Arcs per node.");
    // Without a code a measure keeps its name, and without a description the tooltip is the name.
    expect(on.name("own")).toBe("own");
    expect(on.description("own")).toBeUndefined();
    expect(measureLabels(names, new Map(), codes, true).description("Size")).toBe("Size");
  });

  it("are set as the papers set log codes: C with the code as index, and only then", () => {
    expect([...codeIndexes("log", codes, true).keys()]).toEqual(["size", "CNC", "mag"]);
    expect(codeIndexes("log", codes, true).get("mag")).toBe("mag");
    // Model codes are written plain, and nothing is set while the codes are off.
    expect(codeIndexes("model", codes, true).size).toBe(0);
    expect(codeIndexes("log", codes, false).size).toBe(0);
  });

  it("change nothing when off", () => {
    const off = measureLabels(names, descriptions, codes, false);
    expect(off.name("n_events")).toBe("n_events");
    expect(off.description("Size")).toBe("Number of places and transitions.");
    expect(off.name("unknown")).toBe("unknown");
  });
});
