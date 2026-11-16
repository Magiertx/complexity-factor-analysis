// Unit tests for the texts of the backend that algo-content.ts says again in the language of the UI.

import { describe, expect, it } from "vitest";
import { localizedAlgoText } from "./algo-content";
import de from "./locales/de.json";
import en from "./locales/en.json";

/** `t` of a language over its dictionary, the parameters filled in. */
function translator(dict: unknown) {
  return (key: string, params?: Record<string, string | number>) => {
    let cur = dict;
    for (const part of key.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[part];
    if (typeof cur !== "string") return key;
    return cur.replace(/\{(\w+)\}/g, (m, name: string) => (params && name in params ? String(params[name]) : m));
  };
}

describe("localizedAlgoText", () => {
  // As algorithms/comfy.py reports a wait of algorithms/_prom4py.py: "<miner>: <what>".
  const waits = [
    "Inductive miner: waiting for ProM, another job is using it",
    "Inductive miner: waiting for ProM to restart",
    "Inductive miner: waiting for ProM to start",
  ];

  it("says the waits for ProM in German, with the miner", () => {
    const t = translator(de);
    const texts = waits.map((w) => localizedAlgoText(w, t));
    expect(texts).toEqual([
      "Inductive miner: wartet auf ProM, ein anderer Run nutzt es gerade…",
      "Inductive miner: wartet, bis ProM neu gestartet ist…",
      "Inductive miner: wartet, bis ProM bereit ist…",
    ]);
  });

  it("keeps them readable in English", () => {
    const t = translator(en);
    for (const w of waits) expect(localizedAlgoText(w, t)).toMatch(/^Inductive miner: waiting for ProM/);
  });

  it("leaves a text it does not know as it is", () => {
    expect(localizedAlgoText("Something else", translator(de))).toBe("Something else");
  });
});
