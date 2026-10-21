import { describe, expect, it } from "vitest";
import { inspectHref, logOfRow, recentName } from "./log-link";

const MINERS = ["Alpha miner", "Inductive miner"];

describe("the log of a row", () => {
  it("takes the miner from a row of nets and keeps the log", () => {
    expect(logOfRow("pdc2025.xes / Inductive miner", "model", MINERS)).toEqual({ log: "pdc2025.xes", miner: "Inductive miner" });
  });

  it("is the whole row for log measures, which have a row for each log", () => {
    expect(logOfRow("pdc2025.xes", "log", MINERS)).toEqual({ log: "pdc2025.xes", miner: null });
    // A log of a log dataset is not split, even where its name has a separator.
    expect(logOfRow("a / Alpha miner", "log", MINERS)).toEqual({ log: "a / Alpha miner", miner: null });
  });

  it("does not take a part for a miner unless the dataset has that miner", () => {
    expect(logOfRow("a.xes / Heuristics miner", "model", MINERS)).toEqual({ log: "a.xes / Heuristics miner", miner: null });
    expect(logOfRow("a.xes / Alpha miner", "model", null)).toEqual({ log: "a.xes / Alpha miner", miner: null });
  });

  it("names a packed log as the server keeps it, without .gz", () => {
    expect(recentName("a.xes.gz")).toBe("a.xes");
    expect(recentName("A.XES.GZ")).toBe("A.XES");
    expect(recentName("a.xes")).toBe("a.xes");
    expect(logOfRow("a.xes.gz / Alpha miner", "model", MINERS).log).toBe("a.xes");
  });
});

describe("the address of the page of a single log", () => {
  it("names the log, and the miner for a row of nets", () => {
    expect(inspectHref({ log: "pdc2025.xes", miner: null })).toBe("/inspect?log=pdc2025.xes");
    expect(inspectHref({ log: "pdc2025.xes", miner: "Inductive miner" })).toBe("/inspect?log=pdc2025.xes&miner=Inductive+miner");
  });

  it("escapes what an address cannot hold", () => {
    expect(inspectHref({ log: "a&b #1.xes", miner: null })).toBe("/inspect?log=a%26b+%231.xes");
  });
});
