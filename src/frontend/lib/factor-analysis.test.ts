import { describe, expect, it } from "vitest";
import type { FactorAnalysis, Job } from "./api";
import {
  analysisNotices,
  countText,
  datasetJobHref,
  datasetJobSubtitle,
  datasetName,
  defaultOptions,
  initialOptions,
  isSolutionNotice,
  jobErrorText,
  jobTitle,
  kmoGrade,
  noticeText,
  optionsFromSaved,
  orderMeasures,
  progressPercent,
  solutionNeedsAttention,
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
});
