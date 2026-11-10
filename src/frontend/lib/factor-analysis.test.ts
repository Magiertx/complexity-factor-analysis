import { describe, expect, it } from "vitest";
import type { FactorAnalysis, Job, Stability } from "./api";
import {
  PRINT_HEATMAP_MAX_MEASURES,
  PRINT_PAGE_HEIGHT_IN,
  analysisNotices,
  countText,
  datasetJobHref,
  datasetJobSubtitle,
  datasetName,
  defaultOptions,
  heatmapHeightIn,
  initialOptions,
  isSolutionNotice,
  jobErrorText,
  jobTitle,
  MIN_OBSERVATIONS,
  tooFewKind,
  kmoGrade,
  noticeText,
  optionsFromSaved,
  orderMeasures,
  progressPercent,
  stableWithoutFactor,
  publishedOptions,
  differingOptions,
  secondaryCells,
  settingsSummary,
  solutionNeedsAttention,
  unassignedMeasures,
  FACTOR_NAME_MAX,
  cleanFactorName,
  factorName,
  hasNames,
  namesForApi,
  rowsChoice,
  solutionKey,
  suggestedNames,
  withFactorName,
  knownTooFew,
  mostlyFiltered,
  plainFailure,
  retryInput,
} from "./factor-analysis";
import { formatNumber } from "./format";
import de from "./i18n/locales/de.json";
import en from "./i18n/locales/en.json";

type Params = Record<string, string | number>;

/** The texts of a language as the UI's t and tMaybe give them, numbers formatted alike. */
function translator(locale: "en" | "de") {
  const dicts = { en, de } as Record<string, unknown>;
  const lookup = (dict: unknown, key: string) => {
    let cur = dict;
    for (const part of key.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[part];
    return typeof cur === "string" ? cur : undefined;
  };
  const tMaybe = (key: string, params?: Params) => {
    const text = lookup(dicts[locale], key) ?? lookup(dicts.en, key);
    return text?.replace(/\{(\w+)\}/g, (m, name: string) => {
      if (!params || !(name in params)) return m;
      const value = params[name];
      return typeof value === "number" ? formatNumber(value, locale) : String(value);
    });
  };
  const t = (key: string, params?: Params) => tMaybe(key, params) ?? key;
  return { t, tMaybe };
}

const { t, tMaybe } = translator("en");

function analysis(overrides: Partial<FactorAnalysis> = {}): FactorAnalysis {
  return {
    n_observations: 100,
    used_measures: ["a", "b", "c", "d"],
    bartlett: { chi_square: 120, df: 6, p_value: 0, alpha: 0.05, passed: true },
    kmo: { overall: 0.7, per_measure: {}, threshold: 0.6, passed: true },
    msa_filter: { enabled: true, removed: [] },
    eigenvalues: [2.5, 1.1, 0.3, 0.1],
    suggested_n_factors: 2,
    n_factors: 2,
    rotation: "varimax",
    loading_threshold: 0.35,
    communality_threshold: 0,
    loadings: {},
    structure_loadings: null,
    factor_correlations: null,
    communalities: {},
    uniquenesses: {},
    variance: { ss_loadings: [], proportion: [], cumulative: [], explained: 0.8 },
    factors: [
      { index: 0, measures: [{ measure: "c", loading: 0.9 }, { measure: "a", loading: -0.6 }] },
      { index: 1, measures: [{ measure: "b", loading: 0.7 }] },
    ],
    unassigned: ["d"],
    warnings: [],
    ...overrides,
  };
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: "1",
    algorithm_id: "_dataset:model",
    algorithm_name: "Factor analysis dataset (model measures)",
    filename: "4 log(s)",
    params: { source: "logs", miners: ["Inductive miner", "Alpha miner"], dataset_id: "d 1" },
    status: "completed",
    percentage: 100,
    progress_status: "",
    created_at: 0,
    ...overrides,
  };
}

describe("options", () => {
  it("default to ComFy for model measures and ComFy for log measures for log measures", () => {
    expect(defaultOptions("model")).toMatchObject({ loading_threshold: 0.35, communality_threshold: 0, n_factors: null });
    expect(defaultOptions("log")).toMatchObject({ loading_threshold: 0.5, communality_threshold: 0.5, rotation: "varimax" });
  });

  it("saved with a dataset are completed with the defaults, in the order of the defaults", () => {
    const options = optionsFromSaved("log", { rotation: "promax", excluded: ["x"], loading_threshold: null });
    expect(options).toEqual({ ...defaultOptions("log"), rotation: "promax", excluded: ["x"] });
    expect(Object.keys(options)).toEqual(Object.keys(defaultOptions("log")));
    expect(JSON.stringify(optionsFromSaved("model", { n_factors: 3, excluded: [] }))).toBe(
      JSON.stringify({ ...defaultOptions("model"), n_factors: 3 }),
    );
  });

  it("drop exclusions of measures the dataset no longer has", () => {
    expect(initialOptions("model", null, ["a"])).toEqual(defaultOptions("model"));
    expect(initialOptions("model", { excluded: ["a", "gone"] }, ["a", "b"]).excluded).toEqual(["a"]);
  });
});

describe("kmoGrade", () => {
  it("follows Kaiser's scale on the two decimals the UI shows", () => {
    expect(kmoGrade(0.95)).toBe("marvelous");
    expect(kmoGrade(0.8)).toBe("meritorious");
    // 0.698 is shown as 0.70.
    expect(kmoGrade(0.698)).toBe("middling");
    expect(kmoGrade(0.694)).toBe("mediocre");
    expect(kmoGrade(0.55)).toBe("miserable");
    expect(kmoGrade(0.3)).toBe("unacceptable");
  });
});

describe("orderMeasures", () => {
  it("keeps the dataset order, or groups by factor with the unassigned last", () => {
    expect(orderMeasures(analysis(), "original")).toEqual(["a", "b", "c", "d"]);
    expect(orderMeasures(analysis(), "factor")).toEqual(["c", "a", "b", "d"]);
  });

  it("lists a measure only once", () => {
    const twice = analysis({
      factors: [
        { index: 0, measures: [{ measure: "a", loading: 0.8 }] },
        { index: 1, measures: [{ measure: "a", loading: 0.7 }, { measure: "b", loading: 0.6 }] },
      ],
    });
    expect(orderMeasures(twice, "factor")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("print", () => {
  it("draws the heatmap only while it fits an A4 page", () => {
    expect(heatmapHeightIn(PRINT_HEATMAP_MAX_MEASURES)).toBeLessThan(PRINT_PAGE_HEIGHT_IN - 1);
    // One more row than the page holds is not allowed to be the limit; 60 rows would be cut.
    expect(heatmapHeightIn(60)).toBeGreaterThan(PRINT_PAGE_HEIGHT_IN);
    expect(heatmapHeightIn(123)).toBeGreaterThan(2 * PRINT_PAGE_HEIGHT_IN);
  });
});

describe("notices", () => {
  it("fall back to the English messages of older results", () => {
    expect(analysisNotices(analysis({ warnings: ["Old warning."] }))).toEqual([
      { code: "", message: "Old warning.", params: {} },
    ]);
  });

  it("are said in the UI language where the code is known, with its numbers formatted", () => {
    const notice = { code: "kmo_low", message: "The overall MSA 0.512 is below 0.6.", params: { overall: "0.512", threshold: 0.6 } };
    expect(noticeText(notice, translator("de").tMaybe)).toContain("0,512");
    expect(noticeText({ ...notice, code: "something_new" }, tMaybe)).toBe(notice.message);
  });

  it("name the measures as the lists do, e.g. by their short codes", () => {
    const heywood = { code: "heywood", message: "English", params: { measures: "n_events, n_variants, own" } };
    const codes: Record<string, string> = { n_events: "mag", n_variants: "DT-#" };
    expect(noticeText(heywood, tMaybe, (m) => codes[m] ?? m)).toContain("mag, DT-#, own");
    expect(noticeText(heywood, tMaybe)).toContain("n_events, n_variants, own");
  });

  it("on the factor solution belong to step 4; only some need attention", () => {
    const heywood = { code: "heywood", message: "", params: {} };
    const single = { code: "single_factor_no_rotation", message: "", params: {} };
    expect(isSolutionNotice(heywood) && isSolutionNotice(single)).toBe(true);
    expect(isSolutionNotice({ code: "kmo_low", message: "", params: {} })).toBe(false);
    expect(solutionNeedsAttention(analysis({ warning_details: [single] }))).toBe(false);
    expect(solutionNeedsAttention(analysis({ warning_details: [single, heywood] }))).toBe(true);
  });
});

describe("texts", () => {
  it("count with a plural form", () => {
    expect(countText(t, "factor.inputs.logs", 1)).toBe(t("factor.inputs.logs", { n: 1 }));
    expect(countText(t, "factor.inputs.logs", 4)).toBe(t("factor.inputs.logs_plural", { n: 4 }));
  });

  it("show a percentage of progress or nothing", () => {
    expect(progressPercent(37.6)).toBe(38);
    expect(progressPercent(140)).toBe(100);
    expect(progressPercent(undefined)).toBeNull();
    expect(progressPercent(Number.NaN)).toBeNull();
  });
});

describe("jobs", () => {
  it("name a dataset job after its dataset or its inputs", () => {
    expect(jobTitle(job({ params: { dataset_name: "BPI logs" } }), t)).toBe("BPI logs");
    expect(jobTitle(job(), t)).toBe(countText(t, "factor.data.auto_name.logs", 4));
    expect(jobTitle(job({ algorithm_id: "comfy", algorithm_name: "ComFy" }), t)).toBe("ComFy");
  });

  it("describe what a dataset job computes", () => {
    expect(datasetJobSubtitle(job(), t)).toBe(
      `${t("mode_bar.model_label")} · ${countText(t, "factor.inputs.logs", 4)} × ${countText(t, "factor.inputs.miners", 2)}`,
    );
    expect(datasetJobSubtitle(job({ algorithm_id: "comfy" }), t)).toBeNull();
  });

  it("link to the tab of their dataset", () => {
    expect(datasetJobHref(job())).toBe("/?dataset=d%201");
    expect(datasetJobHref(job({ algorithm_id: "_dataset:log", params: {} }))).toBe("/log");
    expect(datasetJobHref(job({ algorithm_id: "comfy" }))).toBeNull();
  });

  it("say why they failed in the UI language where the server names the cause", () => {
    const failed = job({ status: "failed", error: "ProM4Py could not be reached ...", error_code: "prom_unavailable" });
    expect(jobErrorText(failed, tMaybe)).toBe(en.errors.prom_unavailable);
    expect(jobErrorText(failed, translator("de").tMaybe)).toBe(de.errors.prom_unavailable);
    expect(jobErrorText({ ...failed, error_code: "not_a_known_code" }, tMaybe)).toBe("ProM4Py could not be reached ...");
    expect(jobErrorText({ error: null, error_code: null }, tMaybe)).toBeUndefined();
    const few = { error: "Only 1 measure", error_code: "dataset_too_few_measures" };
    expect(jobErrorText(few, tMaybe, { have: 1, need: 2 })).toBe(
      en.errors.dataset_too_few_measures.replace("{have}", "1").replace("{need}", "2"),
    );
  });
});

describe("datasetName", () => {
  it("names a dataset after its inputs when the server made the name up", () => {
    const made = { name: "4 log(s)", name_auto: true, source: "logs", inputs: { files: 4 } };
    expect(datasetName(made, t)).toBe(countText(t, "factor.data.auto_name.logs", 4));
    expect(datasetName({ ...made, source: "pnml", inputs: { files: 1 } }, t)).toBe(
      countText(t, "factor.data.auto_name.nets", 1),
    );
    expect(datasetName({ name: "mine.csv", source: "csv" }, t)).toBe("mine.csv");
  });

  it("names a dataset of a sample after the sample, in the UI language", () => {
    const sample = { name: "Four PDC training logs", name_auto: true, source: "logs", inputs: { files: 4, sample_id: "pdc-sample-logs" } };
    const tDe = translator("de").t;
    expect(datasetName(sample, tDe)).toBe(de.factor.data.sample_name.pdc_sample_logs);
    expect(datasetName(sample, t)).toBe(en.factor.data.sample_name.pdc_sample_logs);
    // Stored before the name of a sample counted as made up.
    expect(datasetName({ ...sample, name_auto: false }, tDe)).toBe(de.factor.data.sample_name.pdc_sample_logs);
    // A name of one's own stays.
    expect(datasetName({ ...sample, name: "My logs", name_auto: false }, tDe)).toBe("My logs");
    // A sample the UI does not know is named after its inputs.
    expect(datasetName({ ...sample, inputs: { files: 4, sample_id: "new-sample" } }, tDe)).toBe(
      countText(tDe, "factor.data.auto_name.logs", 4),
    );
  });

  it("names the job of a sample after the sample", () => {
    const tDe = translator("de").t;
    expect(jobTitle(job({ params: { sample_id: "pdc-sample-models" } }), tDe)).toBe(de.factor.data.sample_name.pdc_sample_models);
    expect(jobTitle(job({ params: { dataset_name: "Four PDC training logs" } }), tDe)).toBe(de.factor.data.sample_name.pdc_sample_logs);
  });

  it("keeps the name a person gave a sample", () => {
    const tDe = translator("de").t;
    expect(jobTitle(job({ params: { sample_id: "pdc-sample-logs", dataset_name: "Mein Satz" } }), tDe)).toBe("Mein Satz");
  });
});

describe("too few observations", () => {
  it("says no choice of measures helps up to the fewest observations", () => {
    expect(MIN_OBSERVATIONS).toBe(4);
    expect(tooFewKind(1)).toBe("any");
    expect(tooFewKind(3)).toBe("any");
    expect(tooFewKind(4)).toBe("some");
  });

  it("counts one observation in the singular", () => {
    const tDe = translator("de").t;
    expect(countText(tDe, "factor.data.estimate_too_few_any.logs", 1, { needed: 4, limit: 10 })).toMatch(/^Mit 1 Log /);
    expect(countText(tDe, "factor.data.estimate_too_few_any.logs", 3, { needed: 4, limit: 10 })).toMatch(/^Mit 3 Logs /);
  });
});

describe("assignment rules", () => {
  it("default to the largest loading, also for options saved before the rules", () => {
    expect(defaultOptions("model").assignment_rule).toBe("largest");
    expect(optionsFromSaved("model", { n_factors: 4 }).assignment_rule).toBe("largest");
    expect(optionsFromSaved("model", { assignment_rule: "hair" }).assignment_rule).toBe("hair");
    // A rule of a newer server that this UI does not know.
    expect(optionsFromSaved("model", { assignment_rule: "other" as never }).assignment_rule).toBe("largest");
  });

  it("name unassigned measures with their reason, or without one from an older server", () => {
    expect(unassignedMeasures(analysis())).toEqual([{ measure: "d", reason: null }]);
    expect(
      unassignedMeasures(analysis({ unassigned_details: [{ measure: "d", reason: "cross_loading" }] })),
    ).toEqual([{ measure: "d", reason: "cross_loading" }]);
  });

  it("mark the further loadings of a cross-loaded measure, not its largest", () => {
    const crossed = analysis({
      n_factors: 3,
      loadings: { a: [-0.48, 0.46, 0.58], b: [0.1, 0.7, 0.2] },
      cross_loadings: [{ measure: "a", factors: [0, 1, 2], loadings: [-0.48, 0.46, 0.58] }],
    });
    expect([...secondaryCells(crossed)].sort()).toEqual(["a:0", "a:1"]);
    expect(secondaryCells(analysis()).size).toBe(0);
  });
});

describe("published options", () => {
  const bundled = {
    id: "comfy-paper-inductive-miner",
    name: "Inductive",
    description: "",
    observations: 288,
    measures: 13,
    published_options: {
      n_factors: 4,
      rotation: "varimax" as const,
      msa_threshold: 0.6,
      bartlett_alpha: 0.05,
      loading_threshold: 0.35,
      communality_threshold: 0.3,
      assignment_rule: "multi" as const,
    },
  };

  it("are completed like saved options; a dataset without them has none", () => {
    const paper = publishedOptions("model", bundled)!;
    expect(paper).toEqual({ ...defaultOptions("model"), n_factors: 4, communality_threshold: 0.3, assignment_rule: "multi" });
    expect(Object.keys(paper)).toEqual(Object.keys(defaultOptions("model")));
    expect(publishedOptions("model", { ...bundled, published_options: undefined })).toBeNull();
    expect(publishedOptions("model", null)).toBeNull();
  });

  it("differ from the standard in the factor count, the communality and the rule", () => {
    const paper = publishedOptions("model", bundled)!;
    expect([...differingOptions(paper, defaultOptions("model"))].sort()).toEqual([
      "assignment_rule",
      "communality_threshold",
      "n_factors",
    ]);
    // Excluded measures compare as a set.
    expect(differingOptions({ ...paper, excluded: ["a", "b"] }, { ...paper, excluded: ["b", "a"] }).size).toBe(0);
  });
});

describe("settingsSummary", () => {
  const standard = defaultOptions("model");

  it("says the settings in short and marks those that differ from the standard", () => {
    const paper = { ...standard, n_factors: 4, communality_threshold: 0.3, assignment_rule: "multi" as const };
    const result = analysis({
      used_measures: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
      n_factors: 4,
      factor_count: { kaiser: 2, parallel_analysis: 2, eigenvalues_random: [], seed: 1, simulations: 100, percentile: 95 },
    });
    const chips = settingsSummary(paper, standard, result, 12, t);
    expect(chips.map((c) => c.text).join(" · ")).toBe(
      "10 of 12 measures · MSA ≥ 0.6 · 4 factors (Kaiser 2) · varimax · |λ| > 0.35 · h² ≥ 0.3 · multiple membership",
    );
    expect(chips.filter((c) => c.differs).map((c) => c.id)).toEqual(["factors", "communality", "rule"]);
  });

  it("shows the communality the rule asks for when it is above the threshold", () => {
    const chip = (options: typeof standard) =>
      settingsSummary(options, standard, null, 12, t).find((c) => c.id === "communality");
    // Tinted like a threshold set by hand: the standard asks for h² ≥ 0.
    expect(chip({ ...standard, assignment_rule: "multi" })).toEqual({ id: "communality", text: "h² ≥ 0.3", differs: true });
    expect(chip(standard)?.differs).toBe(false);
    expect(chip({ ...standard, assignment_rule: "hair", communality_threshold: 0.3 })?.text).toBe("h² ≥ 0.5");
    expect(chip({ ...standard, assignment_rule: "multi", communality_threshold: 0.4 })?.text).toBe("h² ≥ 0.4");
  });

  it("says that multiple membership and Hair count a loading above the threshold, not at it", () => {
    const chip = (options: typeof standard) => settingsSummary(options, standard, null, 12, t).find((c) => c.id === "loading");
    expect(chip(standard)?.text).toBe("|λ| ≥ 0.35");
    expect(chip({ ...standard, assignment_rule: "multi" })?.text).toBe("|λ| > 0.35");
    expect(chip({ ...standard, assignment_rule: "hair" })?.text).toBe("|λ| > 0.35");
  });

  it("follows Kaiser without a count of its own, and shows α only when it is not the standard", () => {
    const chips = settingsSummary({ ...standard, bartlett_alpha: 0.01, auto_msa_filter: false }, standard, analysis(), 4, translator("de").t);
    expect(chips.map((c) => c.text)).toEqual([
      "4 von 4 Maßen",
      "kein MSA-Filter",
      "α = 0,01",
      "2 Faktoren (Kaiser)",
      "varimax",
      "|λ| ≥ 0,35",
      "h² ≥ 0",
      "größte Ladung",
    ]);
    expect(chips.filter((c) => c.differs).map((c) => c.id)).toEqual(["msa", "alpha"]);
  });

  it("counts the measures left by the exclusions before the first analysis", () => {
    expect(settingsSummary({ ...standard, excluded: ["a"] }, standard, null, 5, t)[0]).toEqual({
      id: "measures",
      text: "4 of 5 measures",
      differs: true,
    });
  });

  it("names Kaiser's count while the analysis on screen still has the count left behind", () => {
    const paperResult = analysis({
      n_factors: 4,
      factor_count: { kaiser: 2, parallel_analysis: 2, eigenvalues_random: [], seed: 1, simulations: 100, percentile: 95 },
    });
    const chip = settingsSummary(standard, standard, paperResult, 4, t).find((c) => c.id === "factors");
    expect(chip).toEqual({ id: "factors", text: "2 factors (Kaiser)", differs: false });
  });

  it("says that a count of one's own is the paper's a priori count", () => {
    const paperResult = analysis({
      n_factors: 4,
      factor_count: { kaiser: 2, parallel_analysis: 2, eigenvalues_random: [], seed: 1, simulations: 100, percentile: 95 },
    });
    const factors = (own: number | null, paper: number | null) =>
      settingsSummary({ ...standard, n_factors: own }, standard, paperResult, 4, t, paper).find((c) => c.id === "factors")?.text;
    expect(factors(4, 4)).toBe("4 factors (paper; Kaiser 2)");
    expect(factors(4, 3)).toBe("4 factors (Kaiser 2)");
    expect(factors(null, 4)).toBe("2 factors (Kaiser)");
  });
});

describe("the rows of one miner", () => {
  const dataset = { n_observations: 150, measures: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"] };
  const alpha = { name: "Alpha miner", n_observations: 50, n_measures: 12, dropped: ["m"] };
  const few = { name: "Heuristics miner", n_observations: 4, n_measures: 12, dropped: ["m"] };

  it("count the measures that vary within them, less the excluded ones", () => {
    expect(rowsChoice(dataset, null, [])).toEqual({ n: 150, p: 13, blocked: false, few: false });
    expect(rowsChoice(dataset, alpha, [])).toEqual({ n: 50, p: 12, blocked: false, few: true });
    // An excluded measure the miner drops anyway counts once.
    expect(rowsChoice(dataset, alpha, ["m", "a", "b"])).toEqual({ n: 50, p: 10, blocked: false, few: false });
  });

  it("block the analysis with no more rows than measures", () => {
    expect(rowsChoice(dataset, few, [])).toEqual({ n: 4, p: 12, blocked: true, few: false });
    expect(rowsChoice({ n_observations: 4, measures: ["a", "b", "c", "d"] }, null, [])).toMatchObject({ blocked: true });
    expect(rowsChoice({ n_observations: 5, measures: ["a", "b", "c", "d"] }, null, [])).toMatchObject({ blocked: false, few: true });
  });

  it("open with a saved miner only when the dataset has it, and show it in the settings", () => {
    const saved = { miner: "Alpha miner", n_factors: 3 };
    expect(initialOptions("model", saved, dataset.measures, [alpha]).miner).toBe("Alpha miner");
    expect(initialOptions("model", saved, dataset.measures, [few]).miner).toBeNull();
    expect(initialOptions("model", saved, dataset.measures, null).miner).toBeNull();
    const t = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`;
    const chips = settingsSummary({ ...defaultOptions("model"), miner: "Alpha miner" }, defaultOptions("model"), null, 13, t);
    expect(chips[0]).toEqual({ id: "miner", text: "Alpha miner", differs: true });
    expect(settingsSummary(defaultOptions("model"), defaultOptions("model"), null, 13, t).some((c) => c.id === "miner")).toBe(false);
  });
});

describe("the names of the factors", () => {
  it("are one line of at most forty characters", () => {
    expect(cleanFactorName("  Size \n of  nets ")).toBe("Size of nets");
    expect(cleanFactorName("x".repeat(50))).toHaveLength(FACTOR_NAME_MAX);
  });

  it("are set and cleared one by one, without empty ones at the end", () => {
    const names = withFactorName([], 2, "Choice");
    expect(names).toEqual([null, null, "Choice"]);
    expect(withFactorName(names, 0, "Size")).toEqual(["Size", null, "Choice"]);
    expect(withFactorName(names, 2, "   ")).toEqual([]);
    expect(factorName(names, 2)).toBe("Choice");
    expect(factorName(names, 5)).toBeNull();
    expect(hasNames(names)).toBe(true);
    expect(hasNames([null, ""])).toBe(false);
  });

  it("go to the API for the factors of the solution only", () => {
    expect(namesForApi(["Size", null, "Choice", "Extra"], 3)).toEqual(["Size", null, "Choice"]);
    expect(namesForApi([null, ""], 4)).toBeNull();
    expect(namesForApi(null, 4)).toBeNull();
  });

  it("belong to a factor count, a rotation, a rule and a miner", () => {
    const options = defaultOptions("model");
    expect(solutionKey(4, options)).toBe(solutionKey(4, { ...options, excluded: ["a"] } as typeof options));
    expect(solutionKey(4, options)).not.toBe(solutionKey(5, options));
    expect(solutionKey(4, options)).not.toBe(solutionKey(4, { ...options, rotation: "promax" }));
    expect(solutionKey(4, options)).not.toBe(solutionKey(4, { ...options, assignment_rule: "hair" }));
    expect(solutionKey(4, options)).not.toBe(solutionKey(4, { ...options, miner: "Alpha miner" }));
    expect(solutionKey(4, { ...options, miner: "Alpha miner" })).not.toBe(
      solutionKey(4, { ...options, miner: "Inductive miner" }),
    );
  });

  it("take the suggestions of an interpretation only for the factors there are", () => {
    const interpretation = {
      factors: [
        { index: 1, name: "Size and flow", summary: "", driving_measures: [], confidence: "high" as const },
        { index: 3, name: "x".repeat(60), summary: "", driving_measures: [], confidence: "low" as const },
        { index: 9, name: "Beyond", summary: "", driving_measures: [], confidence: "low" as const },
      ],
      overall: "",
      caveats: [],
      model: "m",
      requested_model: "m",
      effort: "medium",
      variants: [],
      created_at: "",
      language: "en" as const,
      prompt_version: "",
      cached: true,
      precomputed: false,
    };
    expect(suggestedNames(interpretation, 4)).toEqual(["Size and flow", null, "x".repeat(FACTOR_NAME_MAX)]);
  });
});

describe("plainFailure", () => {
  const known: Record<string, string> = { "errors.xes_invalid": "{file} is no XES file" };
  const tMaybe = (key: string, params?: Record<string, string | number>) =>
    known[key]?.replace("{file}", String(params?.file ?? ""));

  it("says a known code in plain words and keeps the technical text as details", () => {
    expect(plainFailure(tMaybe, { code: "xes_invalid", params: { file: "a.xes" }, message: "Security validation failed" }, "generic")).toEqual({
      text: "a.xes is no XES file",
      details: "Security validation failed",
    });
  });

  it("never shows library text as the message", () => {
    expect(plainFailure(tMaybe, { code: "nope", message: "IndexError: list index out of range" }, "generic")).toEqual({
      text: "generic",
      details: "IndexError: list index out of range",
    });
    expect(plainFailure(tMaybe, { message: null }, "generic")).toEqual({ text: "generic", details: null });
  });
});

describe("knownTooFew", () => {
  it("is known when there are no more observations than measures", () => {
    expect(knownTooFew(6, 13)).toEqual({ n: 6, measures: 13, needed: 14 });
    expect(knownTooFew(13, 13)).toEqual({ n: 13, measures: 13, needed: 14 });
    expect(knownTooFew(14, 13)).toBeNull();
  });

  it("leaves too few measures to the server", () => {
    expect(knownTooFew(2, 2)).toBeNull();
  });
});

describe("retryInput", () => {
  const base = { kind: "model" as const, source: "logs", name: "Four PDC training logs", name_auto: true };

  it("recomputes a sample from the choices it was made with", () => {
    expect(retryInput({ ...base, inputs: { sample_id: "pdc-sample-logs", miners: ["Inductive miner"], measures: ["a", "b"] } })).toEqual({
      kind: "model",
      source: "logs",
      bundledId: "pdc-sample-logs",
      measures: ["a", "b"],
      miners: ["Inductive miner"],
      groups: undefined,
      name: undefined,
    });
  });

  it("cannot recompute uploaded files, which are gone", () => {
    expect(retryInput({ ...base, inputs: { files: 3 } } as never)).toBeNull();
  });
});

describe("mostlyFiltered", () => {
  it("is true when the MSA filter took out more than half of the measures", () => {
    expect(mostlyFiltered(3, 10)).toBe(true);
    expect(mostlyFiltered(6, 6)).toBe(false);
    expect(mostlyFiltered(10, 3)).toBe(false);
    expect(mostlyFiltered(5, 0)).toBe(false);
  });
});

describe("stableWithoutFactor", () => {
  const entry = (measure: string, factors: number[], assignment: number | null) => ({
    measure,
    factors,
    primary_factor: 0,
    assignment,
    primary: null,
  });
  const stability = (measures: Stability["measures"]) =>
    ({ measures, summary: { stable: 0, measures: measures.length, threshold: 0.9 } }) as unknown as Stability;

  it("counts the measures that are stable only in having no factor", () => {
    const result = stability([entry("A", [0], 0.95), entry("B", [], 0.93), entry("C", [], 0.4), entry("D", [1], 0.5)]);
    expect(stableWithoutFactor(result)).toBe(1);
  });

  it("is 0 when every stable measure has a factor, or nothing was computed", () => {
    expect(stableWithoutFactor(stability([entry("A", [0], 0.95)]))).toBe(0);
    expect(stableWithoutFactor(stability([entry("A", [], null)]))).toBe(0);
  });
});
