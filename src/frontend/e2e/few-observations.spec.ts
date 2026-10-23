import type { Page } from "@playwright/test";
import { chooseSource, deleteSessionDatasets, expect, expectStep, goToStep, pattern, stepSection, test, text } from "./fixtures";

// Too few observations for the measures: the data step says it in plain words before computing,
// the log measures can be chosen one by one within their groups, the suitability step excludes
// many at once, and the error of the analysis says what an observation is and offers the ways out.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

/** `rows` observations of `cols` measures of noise around two factors, from a fixed seed. */
function table(rows: number, cols: number): Buffer {
  let state = 11;
  const random = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647 - 0.5;
  };
  const header = ["name", ...Array.from({ length: cols }, (_, j) => `x${j + 1}`)];
  const lines = [header.join(",")];
  for (let i = 0; i < rows; i++) {
    const a = random() * 4;
    const b = random() * 4;
    const values = Array.from({ length: cols }, (_, j) => (j % 2 ? a : b) * (1 + j / 10) + random());
    lines.push([`obs${i}`, ...values.map((v) => v.toFixed(6))].join(","));
  }
  return Buffer.from(lines.join("\n") + "\n");
}

async function uploadTable(page: Page, rows: number, cols: number) {
  await page.goto("/");
  await chooseSource(page, "csv");
  const data = stepSection(page, "data");
  await data.locator('input[type="file"]').setInputFiles({ name: `t${rows}x${cols}.csv`, mimeType: "text/csv", buffer: table(rows, cols) });
  await data.getByRole("button", { name: text("factor.data.submit_csv") }).click();
  await expectStep(page, "dataset", "done");
}

test("the log measures are chosen one by one within their groups, and the estimate says what too few means", async ({ page }) => {
  await page.goto("/log");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await data.getByRole("checkbox", { name: new RegExp(text("factor.data.sample_label")) }).check({ force: true });
  // The four sample logs with the standard groups: far more measures than logs, said with the way out.
  const estimate = data.getByRole("status").filter({ hasText: /4 logs and \d+ measures/ });
  await expect(estimate).toContainText("so with 4 logs at most 3 measures");
  await expect(data).toContainText(text("factor.data.estimate_wont_run"));
  // Computing stays possible.
  await expect(data.getByRole("button", { name: text("factor.data.submit_compute") })).toBeEnabled();

  // Three single measures instead of whole groups.
  await data.getByRole("button", { name: text("factor.data.select_none"), exact: true }).click();
  await data.getByRole("searchbox", { name: text("factor.data.measure_search") }).fill("n_");
  for (const m of ["n_traces", "n_variants", "n_events"]) await data.getByRole("checkbox", { name: m, exact: true }).check({ force: true });
  await data.getByRole("searchbox", { name: text("factor.data.measure_search") }).fill("");
  const group = data.getByRole("checkbox", { name: /^Simple statistics/ });
  // The group is partly chosen: three of its four measures.
  await expect(group).toHaveJSProperty("indeterminate", true);
  await expect(data).toContainText(text("factor.data.selected_count", { n: 3, total: 4 }));
  await expect(data).toContainText(text("factor.data.estimate", { rows: 4, cols: 3 }));
  await expect(data).not.toContainText(text("factor.data.estimate_wont_run"));

  // The request names the measures, and the groups they are of.
  let sent = "";
  await page.route("**/api/factor-analysis/datasets", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sent = route.request().postData() ?? "";
    await route.fulfill({ status: 400, json: { detail: "stopped by the test" } });
  });
  await data.getByRole("button", { name: text("factor.data.submit_compute") }).click();
  await expect.poll(() => sent).toContain('["n_traces","n_variants","n_events"]');
  expect(sent).toContain('["simple_stats"]');
});

test("too few observations: the error says what one is, and the measures are kept with a few clicks", async ({ page }) => {
  // Six rows of 24 measures: a table of logs would be six logs.
  await uploadTable(page, 6, 24);
  await goToStep(page, "suitability");
  const step = stepSection(page, "suitability");
  const error = step.getByRole("alert").filter({ hasText: text("factor.analysis.failed_title") });
  await expect(error).toContainText(text("factor.analysis.observation.row_plural", { n: 6 }));
  await expect(error).toContainText(text("factor.analysis.too_few_observations_way", { n: 6, max: 5 }));
  await expect(error.getByRole("button", { name: text("factor.data.change") })).toBeVisible();

  // Choose measures leads to the list, whose search finds some to keep.
  await error.getByRole("button", { name: text("factor.analysis.choose_measures") }).click();
  const search = step.getByRole("searchbox", { name: text("factor.measures.search") });
  await expect(search).toBeFocused();
  await search.fill("x1");
  // x1 and x10 to x19: eleven, still too many; then the first three of them.
  await step.getByRole("button", { name: text("factor.suitability.keep_found", { n: 11 }) }).click();
  await expect(step).toContainText(text("factor.suitability.excluded_count", { n: 13 }));
  await search.fill("");
  await step.getByRole("button", { name: text("factor.suitability.exclude_all") }).click();
  await expect(step).toContainText(text("factor.suitability.excluded_count", { n: 24 }));
  for (const m of ["x1", "x2", "x3"]) {
    await step.getByRole("checkbox", { name: text("factor.suitability.exclude_aria", { measure: m }), exact: true }).uncheck({ force: true });
  }
  await expectStep(page, "suitability", "done|warn");
  await expect(error).toHaveCount(0);
  // Include all brings the measures back.
  await step.getByRole("button", { name: text("factor.suitability.include_all") }).click();
  await expect(step).not.toContainText(text("factor.suitability.excluded_count", { n: 21 }));
});

test("the notices of finished datasets stay few, and the rest is in the History", async ({ page }) => {
  const job = (id: string, status: string) => ({
    id,
    algorithm_id: "_dataset:model",
    algorithm_name: "Factor analysis dataset (model measures)",
    filename: "4 log(s)",
    params: { dataset_id: `d-${id}`, source: "logs", dataset_name: `Set ${id}` },
    status,
    percentage: status === "completed" ? 100 : 37,
    progress_status: "",
    created_at: Date.now() / 1000,
  });
  const ids = ["a", "b", "c", "d", "e"];
  let done = 0;
  await page.route("**/api/jobs", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { jobs: ids.map((id, i) => job(id, i < done ? "completed" : "running")) } })
      : route.continue(),
  );
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  // One after the other, five notices.
  for (let i = 1; i <= ids.length; i++) {
    done = i;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(page.locator(".toast-region")).toContainText(text("jobs.ready", { name: `Set ${ids[i - 1]}` }));
  }
  const region = page.locator(".toast-region");
  // The newest two, and the three before them folded into a line that leads to the History.
  await expect(region.getByRole("link", { name: pattern(text("jobs.ready_open")) })).toHaveCount(2);
  await expect(region).toContainText(text("jobs.ready", { name: "Set e" }));
  await expect(region).not.toContainText(text("jobs.ready", { name: "Set a" }));
  await expect(region).toContainText(text("toasts.more", { n: 3 }));
  await expect(region.getByRole("link", { name: text("mode_bar.history_label") })).toHaveAttribute("href", "/runs");
});
