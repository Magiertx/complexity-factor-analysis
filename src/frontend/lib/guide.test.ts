import { describe, expect, it } from "vitest";
import de from "./i18n/locales/de.json";
import en from "./i18n/locales/en.json";
import { sentence, splitTerm } from "./guide";

describe("splitTerm", () => {
  it("splits an item at its term", () => {
    expect(splitTerm("Dataset: what cleaning left out and why.")).toEqual({
      term: "Dataset",
      body: "what cleaning left out and why.",
    });
    expect(splitTerm("Event logs (.xes, .xes.gz): every log is mined.")?.term).toBe("Event logs (.xes, .xes.gz)");
  });

  it("leaves a sentence alone, whether or not it has a colon", () => {
    expect(splitTerm("Open Model complexity or Log complexity.")).toBeNull();
    expect(splitTerm("In Data, choose a dataset of a paper, for example Important Factors: Inductive miner.")).toBeNull();
    expect(splitTerm("Choose a dataset. Then Data: load it.")).toBeNull();
  });
});

describe("sentence", () => {
  it("capitalises a plain word and keeps a file name", () => {
    expect(sentence("what cleaning left out")).toBe("What cleaning left out");
    expect(sentence("press, or Enter on, the name")).toBe("Press, or Enter on, the name");
    expect(sentence("report.tex built like the report")).toBe("report.tex built like the report");
    expect(sentence("Für Modellmaße")).toBe("Für Modellmaße");
  });
});

// Every item of the guide that is set apart by a term has one: in its text or under terms.<item>.
describe.each([
  ["en", en],
  ["de", de],
])("the guide in %s", (_, locale) => {
  const guide = locale.guide as unknown as Record<string, { items?: Record<string, string>; terms?: Record<string, string> }>;
  const sections = Object.entries(guide).filter(([, s]) => s && typeof s === "object" && "items" in s);

  it("gives every item a term, short and not a sentence", () => {
    for (const [id, section] of sections) {
      for (const [item, text] of Object.entries(section.items ?? {})) {
        const term = section.terms?.[item] ?? splitTerm(text)?.term;
        expect(term, `${id}.${item}`).toBeTruthy();
        expect(term!.length, `${id}.${item}`).toBeLessThanOrEqual(40);
      }
    }
  });

  it("has no term for an item it does not have", () => {
    for (const [id, section] of sections) {
      for (const item of Object.keys(section.terms ?? {})) expect(section.items, `${id}.${item}`).toHaveProperty(item);
    }
  });
});
