import { describe, expect, it } from "vitest";
import type { DatasetSummary, Job } from "./api";
import { dayKey, historyHref, isSingleRun, historyRows, parseTypeFilter, savedSettingsText } from "./history";
import { defaultOptions } from "./factor-analysis";

const t = (key: string, params: Record<string, string | number> = {}) =>
  `${key}${Object.keys(params).length ? JSON.stringify(params) : ""}`;

function dataset(id: string, extra: Partial<DatasetSummary> = {}): DatasetSummary {
  return {
    id,
    kind: "model",
    name: id,
    name_auto: false,
    source: "bundled",
    status: "ready",
    created_at: "2026-10-20T10:00:00Z",
    n_observations: 288,
    n_measures: 12,
    bundled_id: null,
    job_id: null,
    inputs: { files: 0 },
    has_options: false,
    ...extra,
  };
}

function job(id: string, extra: Partial<Job> = {}): Job {
  return {
    id,
    algorithm_id: "comfy",
    algorithm_name: "ComFy",
    filename: "log.xes",
    status: "completed",
    percentage: 100,
    progress_status: "",
    created_at: Date.parse("2026-10-20T09:00:00Z") / 1000,
    ...extra,
  };
}

describe("the rows of the History", () => {
  it("puts a dataset and the job that computed it on one row, and single runs on their own, newest first", () => {
    const rows = historyRows(
      [
        dataset("d1", { source: "logs", status: "computing", job_id: "j1", created_at: "2026-10-20T11:00:00Z" }),
        dataset("d2", { kind: "log" }),
      ],
      [
        job("j1", { algorithm_id: "_dataset:model", status: "running", percentage: 37, params: { dataset_id: "d1" } }),
        job("s1", { created_at: Date.parse("2026-10-20T12:00:00Z") / 1000 }),
      ],
    );
    expect(rows.map((r) => r.key)).toEqual(["job:s1", "dataset:d1", "dataset:d2"]);
    expect(rows[1]).toMatchObject({ type: "model", status: "active", percent: 37 });
    expect(rows[1].job?.id).toBe("j1");
    expect(rows[0]).toMatchObject({ type: "single", status: "completed", dataset: null });
    expect(rows[2]).toMatchObject({ type: "log", status: "completed", job: null });
  });

  it("says why a dataset failed: aborted by its job, or failed", () => {
    const [aborted, failed] = historyRows(
      [
        dataset("a", { status: "failed", job_id: "ja", created_at: "2026-10-20T11:00:00Z" }),
        dataset("f", { status: "failed", job_id: "jf" }),
      ],
      [
        job("ja", { algorithm_id: "_dataset:model", status: "aborted", params: { dataset_id: "a" } }),
        job("jf", { algorithm_id: "_dataset:model", status: "failed", params: { dataset_id: "f" } }),
      ],
    );
    expect(aborted.status).toBe("aborted");
    expect(failed.status).toBe("failed");
  });

  it("calls an aborted dataset aborted even when its job is gone", () => {
    const [gone, unlinked] = historyRows(
      [dataset("g", { status: "aborted", job_id: "pruned" }), dataset("u", { status: "aborted", job_id: null })],
      [],
    );
    expect(gone.status).toBe("aborted");
    expect(unlinked.status).toBe("aborted");
  });

  it("keeps a dataset job whose dataset is not listed yet, and opens its dataset", () => {
    const rows = historyRows([], [job("j", { algorithm_id: "_dataset:log", status: "pending", params: { dataset_id: "d9" } })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "log", status: "active", percent: null });
    expect(historyHref(rows[0])).toBe("/log?dataset=d9");
  });

  it("lists the stability of a listed dataset as a row of its own, which opens the dataset", () => {
    const stability = job("s", { algorithm_id: "_stability:model", status: "running", percentage: 40, params: { dataset_id: "d1" } });
    const rows = historyRows([dataset("d1")], [stability]);
    expect(rows).toHaveLength(2);
    const row = rows.find((r) => r.job?.id === "s")!;
    expect(row).toMatchObject({ type: "model", status: "active", percent: 40, dataset: null });
    expect(historyHref(row)).toBe("/?dataset=d1");
  });

  it("keeps dataset jobs and stability checks out of the runs of single logs", () => {
    expect(isSingleRun(job("a"))).toBe(true);
    expect(isSingleRun(job("b", { algorithm_id: "_dataset:model" }))).toBe(false);
    expect(isSingleRun(job("c", { algorithm_id: "_stability:model", filename: "200 samples" }))).toBe(false);
  });

  it("opens a dataset on its tab and a single run on the page of a single log", () => {
    const [single, model] = historyRows([dataset("d 1")], [job("s1", { created_at: Date.parse("2026-10-21T00:00:00Z") / 1000 })]);
    expect(historyHref(single)).toBe("/inspect?job=s1");
    expect(historyHref(model)).toBe("/?dataset=d%201");
  });
});

describe("the settings of the last analysis", () => {
  it("is nothing before a first analysis", () => {
    expect(savedSettingsText("model", null, 12, null, t)).toBeNull();
  });

  it("names the standard and the paper settings by name", () => {
    const paper = { ...defaultOptions("model"), n_factors: 4, assignment_rule: "multi" as const, communality_threshold: 0.3 };
    expect(savedSettingsText("model", {}, 12, paper, t)).toBe("factor.data.preset.standard");
    expect(savedSettingsText("model", { n_factors: 4, assignment_rule: "multi", communality_threshold: 0.3 }, 12, paper, t)).toBe(
      "factor.data.preset.published",
    );
  });

  it("lists only what differs from the standard, with a count of one's own as a plain count", () => {
    expect(savedSettingsText("model", { n_factors: 3, rotation: "promax" }, 12, null, t)).toBe(
      'factor.factors.criterion_count_plural{"n":3} · factor.settings.rotation.promax',
    );
  });
});

describe("the filters of the address", () => {
  it("reads a type and nothing else", () => {
    expect(parseTypeFilter("single")).toBe("single");
    expect(parseTypeFilter("log")).toBe("log");
    expect(parseTypeFilter("runs")).toBe("all");
    expect(parseTypeFilter(null)).toBe("all");
  });

  it("groups by the day of the browser", () => {
    expect(dayKey(new Date(2026, 9, 3, 23, 59).getTime())).toBe("2026-10-03");
  });
});
