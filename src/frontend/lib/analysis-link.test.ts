import { describe, expect, it } from "vitest";
import { analysisLinkQuery, parseAnalysisLink } from "./analysis-link";
import { defaultOptions, type AnalysisOptions } from "./factor-analysis";

const standard = defaultOptions("model");
const paper: AnalysisOptions = { ...standard, n_factors: 4, communality_threshold: 0.3, assignment_rule: "multi" };
const measures = new Set(["Size", "Density", "Token split"]);
const id = "comfy-paper-inductive-miner";

const parse = (query: string) => parseAnalysisLink(new URLSearchParams(query), standard, measures);

describe("analysis links", () => {
  it("name a preset for the standard and the paper settings", () => {
    expect(analysisLinkQuery(id, paper, standard, paper)).toBe(`bundled=${id}&preset=published`);
    expect(analysisLinkQuery(id, { ...standard }, standard, paper)).toBe(`bundled=${id}&preset=standard`);
    expect(parse(`bundled=${id}&preset=published`)).toEqual({ bundledId: id, preset: "published", options: standard, invalid: false });
  });

  it("spell other settings out and read them back the same", () => {
    const own: AnalysisOptions = {
      ...paper,
      rotation: "promax",
      excluded: ["Density", "Token split"],
      bartlett_alpha: 0.01,
      loading_threshold: 0.4,
    };
    const query = analysisLinkQuery(id, own, standard, paper);
    expect(query).toBe(
      `bundled=${id}&k=4&rot=promax&msa=0.6&alpha=0.01&lt=0.4&h2=0.3&rule=multi&ex=Density%2CToken+split`,
    );
    expect(parse(query)).toEqual({ bundledId: id, preset: null, options: own, invalid: false });

    const off = { ...standard, auto_msa_filter: false, assignment_rule: "hair" as const };
    expect(parse(analysisLinkQuery(id, off, standard, null))?.options).toEqual(off);
  });

  it("follow Kaiser with k=kaiser and fill in what a link leaves out", () => {
    expect(parse(`bundled=${id}&k=kaiser&rot=oblimin`)?.options).toEqual({ ...standard, rotation: "oblimin" });
    expect(parse(`bundled=${id}`)).toEqual({ bundledId: id, preset: "standard", options: standard, invalid: false });
    expect(parse("k=4")).toBeNull();
  });

  it("fall back to the standard as a whole when a parameter cannot be read", () => {
    for (const bad of ["k=0", "k=two", "rot=spin", "msa=1.5", "alpha=0", "lt=-1", "h2=abc", "rule=lieben", "ex=Nope", "preset=paper"]) {
      expect(parse(`bundled=${id}&${bad}`), bad).toEqual({
        bundledId: id,
        preset: "standard",
        options: standard,
        invalid: true,
      });
    }
    // Readable parameters next to a bad one count for nothing.
    expect(parse(`bundled=${id}&rule=multi&k=0`)?.options).toEqual(standard);
  });
});
