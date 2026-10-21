import { describe, expect, it } from "vitest";
import { neighbours, parseStep, stepFromHash, stepHref } from "./steps";

describe("the steps in the address", () => {
  it("reads a step and nothing else", () => {
    expect(parseStep("loadings")).toBe("loadings");
    expect(parseStep("Loadings")).toBeNull();
    expect(parseStep("results")).toBeNull();
    expect(parseStep(null)).toBeNull();
  });

  it("reads the anchors of the one-page layout", () => {
    expect(stepFromHash("#fa-step-suitability")).toBe("suitability");
    expect(stepFromHash("#fa-step-nothing")).toBeNull();
    expect(stepFromHash("#fa-msa-table")).toBeNull();
    expect(stepFromHash("")).toBeNull();
  });

  it("keeps the other parameters and leaves the data step without one", () => {
    expect(stepHref("/log", "", "factors")).toBe("/log?step=factors");
    expect(stepHref("/", "?step=factors", "data")).toBe("/");
    expect(stepHref("/", "?bundled=x&preset=published", "loadings")).toBe("/?bundled=x&preset=published&step=loadings");
    expect(stepHref("/", "?step=dataset&k=4", "suitability")).toBe("/?step=suitability&k=4");
  });

  it("knows the step before and after", () => {
    expect(neighbours("data")).toEqual({ previous: null, next: "dataset" });
    expect(neighbours("loadings")).toEqual({ previous: "factors", next: "interpretation" });
    expect(neighbours("interpretation")).toEqual({ previous: "loadings", next: null });
  });
});
