import { describe, expect, it } from "vitest";
import { orderCollection, paperTablesText } from "./paper-notes";

// Returns the key with its parameters, so the tests see which text was chosen and with what.
const t = (key: string, params?: Record<string, string | number>) => `${key} ${JSON.stringify(params ?? {})}`;

describe("paper notes", () => {
  it("word the paper tables of the server in the UI language, with the tables it names", () => {
    expect(paperTablesText("matches", "Tab. 10–11", "Tab. 10–11 of the paper print ...", t)).toBe(
      'factor.paper_notes.tables.matches {"tables":"Tab. 10–11"}',
    );
    expect(paperTablesText("extra_dup_column", "Tab. 7–8", null, t)).toMatch(/^factor\.paper_notes\.tables\.extra_dup /);
    expect(paperTablesText("other_data", "Tab. 14–16", null, t)).toMatch(/^factor\.paper_notes\.tables\.other_data /);
    expect(paperTablesText("not_in_paper", null, null, t)).toMatch(/^factor\.paper_notes\.tables\.not_in_paper /);
  });

  it("fall back to the server's note for a key this UI does not know, and say nothing without one", () => {
    expect(paperTablesText("newer_key", "Tab. 3", "A note of a newer server.", t)).toBe("A note of a newer server.");
    expect(paperTablesText("matches", null, null, t)).toBeNull();
    expect(paperTablesText(null, null, null, t)).toBeNull();
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
