// Unit tests for analysis-link.ts.

import { describe, expect, it } from "vitest";
import { analysisLinkQuery, parseAnalysisLink, parsePrintLink, printHref } from "./analysis-link";
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
    expect(parse(`bundled=${id}&miner=`)?.invalid).toBe(true);
  });
});

describe("print view links", () => {
  const defaults = (kind: "model" | "log") => defaultOptions(kind);

  it("carry the dataset, every setting and the view, and read them back", () => {
    const own: AnalysisOptions = { ...paper, rotation: "oblimin", excluded: ["Density"] };
    const href = printHref("model", "abc", own, standard, { codes: true, order: "dataset" });
    expect(href).toBe("/print?kind=model&dataset=abc&k=4&rot=oblimin&msa=0.6&lt=0.35&h2=0.3&rule=multi&ex=Density&codes=1&order=dataset");
    const parsed = parsePrintLink(new URLSearchParams(href.split("?")[1]), defaults);
    expect(parsed).toEqual({ kind: "model", datasetId: "abc", options: own, view: { codes: true, order: "dataset" }, names: [] });
  });

  it("carry the miner and the names of the factors", () => {
    const own: AnalysisOptions = { ...standard, n_factors: 3, miner: "Inductive miner" };
    const href = printHref("model", "abc", own, standard, { codes: false, order: "factor" }, ["Größe", null, "a, b"]);
    expect(href).toContain("miner=Inductive+miner");
    const parsed = parsePrintLink(new URLSearchParams(href.split("?")[1]), defaults);
    expect(parsed?.options).toEqual(own);
    expect(parsed?.names).toEqual(["Größe", null, "a, b"]);
    // Names that cannot be read count for none.
    expect(parsePrintLink(new URLSearchParams("dataset=x&names=%5B1"), defaults)?.names).toEqual([]);
    expect(parsePrintLink(new URLSearchParams("dataset=x&names=%5B%22%20a%20%20b%20%22%5D"), defaults)?.names).toEqual(["a b"]);
  });

  it("start from the standard of the kind and need a dataset", () => {
    const log = parsePrintLink(new URLSearchParams("kind=log&dataset=x"), defaults);
    expect(log?.options).toEqual(defaultOptions("log"));
    expect(log?.view).toEqual({ codes: false, order: "factor" });
    expect(parsePrintLink(new URLSearchParams("kind=model"), defaults)).toBeNull();
    expect(parsePrintLink(new URLSearchParams("dataset=x&rot=spin"), defaults)).toBeNull();
  });
});
