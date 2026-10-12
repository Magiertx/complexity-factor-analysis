import { describe, expect, it } from "vitest";
import { orderCollection, paperTablesText, ruleNote, settingsSourceText } from "./paper-notes";

// Returns the key with its parameters, so the tests see which text was chosen and with what.
const t = (key: string, params?: Record<string, string | number>) => `${key} ${JSON.stringify(params ?? {})}`;

describe("paper notes", () => {
  it("word the paper tables of the server in the UI language, with the tables it names", () => {
    expect(paperTablesText("matches", "Tab. 10–11", "Tab. 10–11 of the paper print ...", t)).toBe(
      'factor.paper_notes.tables.matches {"tables":"Tab. 10–11"}',
    );
    expect(paperTablesText("msa_only", "Tab. 13", null, t)).toBe('factor.paper_notes.tables.msa_only {"tables":"Tab. 13"}');
    expect(paperTablesText("other_data", "Tab. 14–16", null, t)).toMatch(/^factor\.paper_notes\.tables\.other_data /);
    expect(paperTablesText("not_in_paper", null, null, t)).toMatch(/^factor\.paper_notes\.tables\.not_in_paper /);
  });

  it("give the numbers of Tab. 7 against the report in the UI language", () => {
    expect(paperTablesText("extra_dup_column", "Tab. 7–8", null, t, { locale: "de" })).toBe(
      "factor.paper_notes.tables.extra_dup " +
        JSON.stringify({
          tables: "Tab. 7–8",
          chi_paper: "10.965,18",
          chi_report: "8.244,33",
          kmo_paper: "0,81",
          kmo_report: "0,73",
          loading_gap: "0,06",
        }),
    );
  });

  it("name a value the paper prints off its rounding, for the dataset it belongs to only", () => {
    const text = paperTablesText("matches", "Tab. 10–11", null, t, { locale: "en", datasetId: "comfy-paper-inductive-miner" });
    expect(text).toBe(
      'factor.paper_notes.tables.matches {"tables":"Tab. 10–11"} ' +
        'factor.paper_notes.rounding {"measure":"Density","printed":"0.75","report":"0.7559"}',
    );
    expect(paperTablesText("matches", "Tab. 4–5", null, t, { datasetId: "comfy-paper-alpha-miner" })).toBe(
      'factor.paper_notes.tables.matches {"tables":"Tab. 4–5"}',
    );
  });

  it("fall back to the server's note for a key this UI does not know, and say nothing without one", () => {
    expect(paperTablesText("newer_key", "Tab. 3", "A note of a newer server.", t)).toBe("A note of a newer server.");
    expect(paperTablesText("matches", null, null, t)).toBeNull();
    expect(paperTablesText(null, null, null, t)).toBeNull();
  });

  it("say where settings come from: the paper as cited, or as only a report applies them", () => {
    expect(settingsSourceText("Important Factors, ATAED 2026, Tab. 10–12", "paper", t)).toBe(
      "Important Factors, ATAED 2026, Tab. 10–12",
    );
    // An older server sends no scope; its citation stands as it is.
    expect(settingsSourceText("Important Factors, ATAED 2026, Tab. 10–12", undefined, t)).toBe(
      "Important Factors, ATAED 2026, Tab. 10–12",
    );
    expect(settingsSourceText("Important Factors, ATAED 2026", "report", t)).toBe(
      'factor.paper_notes.source_report {"source":"Important Factors, ATAED 2026"}',
    );
    expect(settingsSourceText(undefined, "report", t)).toBeNull();
  });

  it("note where a dimension table of the paper differs from the rule it states", () => {
    expect(ruleNote("comfy-paper-inductive-miner", "multi", t)).toMatch(/^factor\.paper_notes\.rules\.inductive_multi /);
    expect(ruleNote("comfy-paper-alpha-miner", "hair", t, "de")).toBe(
      'factor.paper_notes.rules.alpha_hair {"h2_hair":"0,5"}',
    );
    expect(ruleNote("comfy-paper-inductive-miner", "largest", t)).toBeNull();
    expect(ruleNote("comfy-paper-directly-follows-miner", "multi", t)).toBeNull();
    expect(ruleNote(null, "multi", t)).toBeNull();
  });

  it("put the miners of Tab. 17 first", () => {
    const ids = ["comfy-paper-alpha-plus-miner", "comfy-paper-inductive-miner", "other", "comfy-paper-alpha-miner"];
    expect(orderCollection("comfy-paper", ids.map((id) => ({ id }))).map((d) => d.id)).toEqual([
      "comfy-paper-alpha-miner",
      "comfy-paper-inductive-miner",
      "comfy-paper-alpha-plus-miner",
      "other",
    ]);
  });
});
