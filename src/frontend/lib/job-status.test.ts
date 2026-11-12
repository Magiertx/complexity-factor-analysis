// Unit tests for job-status.ts.

import { describe, expect, it } from "vitest";
import type { Job } from "./api";
import { NO_ACTIVITY, finishedDatasets, jobActivity, statusesOf } from "./job-status";

function job(id: string, status: Job["status"], extra: Partial<Job> = {}): Job {
  return {
    id,
    algorithm_id: "comfy",
    algorithm_name: "ComFy",
    filename: "log.xes",
    status,
    percentage: status === "completed" ? 100 : 0,
    progress_status: "",
    created_at: 1,
    ...extra,
  };
}

const dataset = (id: string, status: Job["status"], extra: Partial<Job> = {}) =>
  job(id, status, { algorithm_id: "_dataset:model", ...extra });

describe("the activity of the jobs", () => {
  it("is none without jobs and for finished ones", () => {
    expect(jobActivity([], new Set())).toEqual(NO_ACTIVITY);
    expect(jobActivity([job("a", "completed"), job("b", "aborted")], new Set())).toEqual(NO_ACTIVITY);
  });

  it("counts the jobs that wait or run and averages the progress of the running ones", () => {
    const jobs = [
      job("a", "running", { percentage: 37 }),
      job("b", "running", { percentage: 50 }),
      job("c", "pending"),
      job("d", "completed"),
    ];
    // The one that waits counts as active but has no progress to average.
    expect(jobActivity(jobs, new Set())).toEqual({ active: 3, percent: 44, failed: 0 });
    expect(jobActivity([job("a", "running", { percentage: 37 })], new Set())).toEqual({ active: 1, percent: 37, failed: 0 });
    expect(jobActivity([job("c", "pending")], new Set())).toEqual({ active: 1, percent: null, failed: 0 });
  });

  it("keeps the progress between 0 and 100", () => {
    expect(jobActivity([job("a", "running", { percentage: 140 })], new Set()).percent).toBe(100);
    expect(jobActivity([job("a", "running", { percentage: -3 })], new Set()).percent).toBe(0);
  });

  it("counts a failure until it has been looked at", () => {
    const jobs = [job("a", "failed"), job("b", "failed"), job("c", "completed")];
    expect(jobActivity(jobs, new Set()).failed).toBe(2);
    expect(jobActivity(jobs, new Set(["a"])).failed).toBe(1);
    expect(jobActivity(jobs, new Set(["a", "b"])).failed).toBe(0);
    // An abort is the reader's own doing, not a failure.
    expect(jobActivity([job("a", "aborted")], new Set()).failed).toBe(0);
  });
});

describe("the datasets that finished", () => {
  const none = { initial: new Set<string>(), reported: new Set<string>() };

  it("are the dataset jobs that were running and are completed now", () => {
    const before = statusesOf([dataset("a", "running"), dataset("b", "pending"), dataset("c", "running"), job("d", "running")]);
    const now = [dataset("a", "completed"), dataset("b", "completed"), dataset("c", "failed"), job("d", "completed")];
    expect(finishedDatasets(before, now, { ...none, initial: new Set(["a", "b", "c", "d"]) }).map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("are not those that were finished when the page loaded", () => {
    const first = [dataset("a", "completed")];
    const before = statusesOf(first);
    expect(finishedDatasets(before, first, { ...none, initial: new Set(["a"]) })).toEqual([]);
    // Not seen before, but in the first list: it was there when the page loaded.
    expect(finishedDatasets(new Map(), first, { ...none, initial: new Set(["a"]) })).toEqual([]);
  });

  it("are those started while the page was open, also when they finished between two lists", () => {
    const initial = new Set(["old"]);
    const before = statusesOf([dataset("old", "completed")]);
    const now = [dataset("old", "completed"), dataset("quick", "completed")];
    expect(finishedDatasets(before, now, { ...none, initial }).map((j) => j.id)).toEqual(["quick"]);
  });

  it("are reported once", () => {
    const initial = new Set<string>();
    const before = statusesOf([dataset("a", "running")]);
    const now = [dataset("a", "completed")];
    expect(finishedDatasets(before, now, { initial, reported: new Set() })).toHaveLength(1);
    expect(finishedDatasets(before, now, { initial, reported: new Set(["a"]) })).toHaveLength(0);
    // And the next list has them as completed already.
    expect(finishedDatasets(statusesOf(now), now, { initial, reported: new Set() })).toHaveLength(0);
  });

  it("are dataset jobs only, and completed ones", () => {
    const before = statusesOf([]);
    const now = [job("a", "completed"), dataset("b", "failed"), dataset("c", "aborted")];
    expect(finishedDatasets(before, now, none)).toEqual([]);
  });
});
