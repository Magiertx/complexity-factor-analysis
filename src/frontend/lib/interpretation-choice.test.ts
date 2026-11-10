import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHOICE_KEY,
  choiceKey,
  defaultChoice,
  effortOptions,
  isStored,
  modelLabel,
  modelOptions,
  readChoice,
  resolveChoice,
  saveChoice,
  withModel,
  type ChoiceStatus,
  type StoredVariant,
} from "./interpretation-choice";

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

const withKey: ChoiceStatus = {
  available: true,
  model: OPUS,
  effort: "medium",
  models: [OPUS, SONNET],
  efforts: ["low", "medium", "high", "xhigh"],
};
const noKey: ChoiceStatus = { ...withKey, available: false, model: null };

const stored = (model: string, effort: string): StoredVariant => ({ model, effort, precomputed: true });

describe("the options of the choice", () => {
  it("offers what the server offers when it has a key, in order of effort", () => {
    expect(modelOptions(withKey, [])).toEqual([OPUS, SONNET]);
    expect(effortOptions({ ...withKey, efforts: ["xhigh", "low", "high"] }, [], OPUS)).toEqual(["low", "high", "xhigh"]);
  });

  it("adds what is stored outside the lists when the server has a key", () => {
    const variants = [stored("claude-old", "max"), stored(OPUS, "max"), stored(SONNET, "high")];
    expect(modelOptions(withKey, variants)).toEqual([OPUS, SONNET, "claude-old"]);
    // A listed model: its offered efforts and its stored ones.
    expect(effortOptions(withKey, variants, OPUS)).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effortOptions(withKey, variants, SONNET)).toEqual(["low", "medium", "high", "xhigh"]);
    // An unlisted model cannot be called, so only its stored efforts are offered.
    expect(effortOptions(withKey, variants, "claude-old")).toEqual(["max"]);
  });

  it("offers only the stored variants without a key", () => {
    const variants = [stored(OPUS, "high"), stored(OPUS, "medium"), stored(SONNET, "low")];
    expect(modelOptions(noKey, variants)).toEqual([OPUS, SONNET]);
    expect(effortOptions(noKey, variants, OPUS)).toEqual(["medium", "high"]);
    expect(effortOptions(noKey, variants, SONNET)).toEqual(["low"]);
    expect(modelOptions(noKey, [])).toEqual([]);
  });

  it("marks what is stored", () => {
    const variants = [stored(OPUS, "high")];
    expect(isStored(variants, { model: OPUS, effort: "high" })).toBe(true);
    expect(isStored(variants, { model: OPUS, effort: "medium" })).toBe(false);
    expect(isStored(variants, { model: SONNET, effort: "high" })).toBe(false);
  });

  it("names known models and keeps the id of others", () => {
    expect(modelLabel(OPUS)).toBe("Opus 5.5");
    expect(modelLabel("claude-new")).toBe("claude-new");
    expect(choiceKey({ model: OPUS, effort: "low" })).toBe(`${OPUS}|low`);
    expect(choiceKey(null)).toBe("");
  });
});

describe("the choice in force", () => {
  it("is the default of the server until something else is chosen", () => {
    expect(resolveChoice(withKey, [], null)).toEqual({ model: OPUS, effort: "medium" });
    expect(defaultChoice(noKey)).toEqual({ model: OPUS, effort: "medium" });
  });

  it("keeps a wanted choice the server offers, and drops one it does not", () => {
    expect(resolveChoice(withKey, [], { model: SONNET, effort: "high" })).toEqual({ model: SONNET, effort: "high" });
    expect(resolveChoice(withKey, [], { model: "claude-old", effort: "high" })).toEqual({ model: OPUS, effort: "medium" });
    expect(resolveChoice(withKey, [], { model: SONNET, effort: "max" })).toEqual({ model: OPUS, effort: "medium" });
  });

  it("keeps a stored choice outside the lists, and drops it once it is no longer stored", () => {
    const wanted = { model: "claude-old", effort: "max" };
    expect(resolveChoice(withKey, [stored("claude-old", "max")], wanted)).toEqual(wanted);
    expect(resolveChoice(withKey, [], wanted)).toEqual({ model: OPUS, effort: "medium" });
    expect(resolveChoice(withKey, [stored(OPUS, "max")], { model: OPUS, effort: "max" })).toEqual({
      model: OPUS,
      effort: "max",
    });
  });

  it("needs the status", () => {
    expect(resolveChoice(null, [], { model: OPUS, effort: "low" })).toBeNull();
  });

  it("is limited to the stored variants without a key", () => {
    const variants = [stored(OPUS, "high"), stored(SONNET, "low")];
    expect(resolveChoice(noKey, variants, { model: SONNET, effort: "low" })).toEqual({ model: SONNET, effort: "low" });
    // Not stored: the first stored one, since the default is not stored either.
    expect(resolveChoice(noKey, variants, { model: SONNET, effort: "high" })).toEqual({ model: OPUS, effort: "high" });
    // The default is used when it is stored.
    expect(resolveChoice(noKey, [stored(SONNET, "low"), stored(OPUS, "medium")], null)).toEqual({
      model: OPUS,
      effort: "medium",
    });
    expect(resolveChoice(noKey, [], { model: OPUS, effort: "high" })).toBeNull();
  });

  it("falls back to the first model of the list when a keyless server hides its default", () => {
    expect(defaultChoice({ ...noKey, models: [SONNET, OPUS] })).toEqual({ model: SONNET, effort: "medium" });
  });

  it("keeps the effort when the model offers it, else takes the default effort or the first", () => {
    const variants = [stored(OPUS, "high"), stored(OPUS, "medium"), stored(SONNET, "low"), stored(SONNET, "medium")];
    expect(withModel(withKey, [], { model: OPUS, effort: "xhigh" }, SONNET)).toEqual({ model: SONNET, effort: "xhigh" });
    expect(withModel(noKey, variants, { model: OPUS, effort: "high" }, SONNET)).toEqual({ model: SONNET, effort: "medium" });
    expect(withModel(noKey, [stored(SONNET, "low")], { model: OPUS, effort: "high" }, SONNET)).toEqual({
      model: SONNET,
      effort: "low",
    });
  });
});

describe("the remembered choice", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is read back", () => {
    expect(readChoice()).toBeNull();
    saveChoice({ model: SONNET, effort: "high" });
    expect(readChoice()).toEqual({ model: SONNET, effort: "high" });
  });

  it("ignores what is not a choice", () => {
    store.set(CHOICE_KEY, "not json");
    expect(readChoice()).toBeNull();
    store.set(CHOICE_KEY, JSON.stringify({ model: 3 }));
    expect(readChoice()).toBeNull();
  });

  it("is checked against the options by resolveChoice", () => {
    saveChoice({ model: "claude-retired", effort: "max" });
    expect(resolveChoice(withKey, [], readChoice())).toEqual({ model: OPUS, effort: "medium" });
  });

  it("survives blocked storage", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(readChoice()).toBeNull();
    expect(() => saveChoice({ model: OPUS, effort: "low" })).not.toThrow();
  });
});
