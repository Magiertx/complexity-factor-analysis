// Datasets of the data step: an uploaded CSV, the PNML and log samples, the file limit and deleting a dataset from My datasets.

import {
  COMPUTE_TIMEOUT,
  chooseSource,
  pattern,
  deleteSessionDatasets,
  expect,
  expectStep,
  goToStep,
  nextFromData,
  openBundled,
  stepSection,
  test,
  text,
} from "./fixtures";

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

/** 80 observations of eight measures driven by two correlated factors, from a fixed seed. */
function measureTable(): Buffer {
  let state = 7;
  const random = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647 - 0.5;
  };
  const rows = ["name,m1,m2,m3,m4,m5,m6,m7,m8"];
  for (let i = 0; i < 80; i++) {
    const a = random() * 4;
    const b = random() * 4;
    const c = 0.5 * a + random() * 4;
    const values = [
      a + random(), 2 * a + random(), -a + random(), a + 0.5 * b + random(),
      b + random(), 3 * b + random(), b - random(), c + random(),
    ];
    rows.push([`obs${i}`, ...values.map((v) => v.toFixed(6))].join(","));
  }
  return Buffer.from(rows.join("\n") + "\n");
}

test("an uploaded CSV reopens from My datasets with its excluded measure", async ({ page }) => {
  await page.goto("/");
  await chooseSource(page, "csv");
  const data = stepSection(page, "data");
  await data.locator('input[type="file"]').setInputFiles({
    name: "measures.csv",
    mimeType: "text/csv",
    buffer: measureTable(),
  });
  await data.getByRole("button", { name: text("factor.data.submit_csv") }).click();
  await expectStep(page, "suitability", "done");
  // The CSV is loaded in the data step, which leads on to the dataset step.
  await expect(data).toContainText(text("factor.data.loaded", { name: "measures.csv" }).split(":")[0]);
  await nextFromData(page).click();
  await expect(stepSection(page, "dataset")).toContainText("80");

  // Excluding a measure runs the analysis again and keeps the setting with the dataset.
  await goToStep(page, "suitability");
  const suitability = stepSection(page, "suitability");
  const exclude = suitability.getByRole("checkbox", { name: text("factor.suitability.exclude_aria", { measure: "m3" }) });
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/options") && r.request().method() === "PUT" && (r.request().postData() ?? "").includes("m3"),
  );
  await exclude.check({ force: true });
  expect((await saved).status()).toBe(204);
  await expect(suitability).toContainText(text("factor.suitability.excluded_count", { n: 1 }));

  // Without the open dataset remembered, the data step offers the session's datasets.
  await page.evaluate(() => localStorage.removeItem("app.factor-dataset-model"));
  await page.goto("/");
  const mine = stepSection(page, "data").getByRole("radiogroup", { name: text("factor.data.source.mine") });
  await mine.getByRole("radio", { name: /measures\.csv/ }).check({ force: true });
  await stepSection(page, "data").getByRole("button", { name: text("factor.data.submit_open") }).click();
  await expectStep(page, "suitability", "done");
  await goToStep(page, "suitability");
  await expect(
    stepSection(page, "suitability").getByRole("checkbox", { name: text("factor.suitability.exclude_aria", { measure: "m3" }) }),
  ).toBeChecked();
  await expect(stepSection(page, "suitability")).toContainText(text("factor.suitability.excluded_count", { n: 1 }));
});

test("the PNML sample computes a model dataset without ProM", async ({ page }) => {
  // A job, like the log sample: in the Docker stack it waits for a free Celery worker.
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await page.goto("/");
  await chooseSource(page, "pnml");
  const data = stepSection(page, "data");
  await data.getByRole("checkbox", { name: new RegExp(text("factor.data.sample_label")) }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_compute") }).click();
  await expectStep(page, "dataset", "done", "en", COMPUTE_TIMEOUT);
  await expectStep(page, "loadings", "done");
  // 32 nets, one observation each.
  await goToStep(page, "dataset");
  const dataset = stepSection(page, "dataset");
  await expect(dataset).toContainText("32");
  // The run times and the size of each net, folded until asked for.
  await dataset.getByRole("button", { name: pattern(text("factor.dataset.measurement_heading")) }).click();
  const times = dataset.getByRole("table", { name: text("factor.dataset.measurement_heading") });
  await expect(times.getByRole("columnheader", { name: text("factor.dataset.col_net") })).toBeVisible();
  await expect(times.locator("tbody tr")).toHaveCount(32);
});

test("the log sample computes feeed measures without ProM", async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await page.goto("/log");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await data.getByRole("checkbox", { name: new RegExp(text("factor.data.sample_label")) }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_compute") }).click();
  await expectStep(page, "dataset", "done", "en", COMPUTE_TIMEOUT);
  await expectStep(page, "suitability", "done|warn");
  // One observation per log.
  await goToStep(page, "dataset");
  const dataset = stepSection(page, "dataset");
  await expect(dataset).toContainText("pdc2025_02001100.xes");
  // The size of each log and the seconds of its features.
  await dataset.getByRole("button", { name: pattern(text("factor.dataset.measurement_heading")) }).click();
  const times = dataset.getByRole("table", { name: text("factor.dataset.measurement_heading") });
  await expect(times.getByRole("row", { name: /^pdc2025_02001100\.xes/ })).toContainText("1,000");
  await expect(times.getByRole("columnheader", { name: text("factor.dataset.col_features_s") })).toBeVisible();
});

test("the log sample mined with the default miner gives a model dataset", { tag: "@prom" }, async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await page.goto("/");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await data.getByRole("checkbox", { name: new RegExp(text("factor.data.sample_label")) }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_compute") }).click();
  await expectStep(page, "dataset", "done", "en", COMPUTE_TIMEOUT);
  // Four logs with the Inductive miner, one row each.
  await goToStep(page, "dataset");
  await expect(stepSection(page, "dataset")).toContainText("Inductive miner");
});

test("mining logs says up front that ProM is missing, while log measures stay usable", { tag: "@no-prom" }, async ({ page }) => {
  await page.goto("/");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await data.getByRole("checkbox", { name: new RegExp(text("factor.data.sample_label")) }).check({ force: true });
  await expect(data.getByText(text("common.prom_missing"))).toBeVisible();
  await expect(data.getByRole("button", { name: text("factor.data.submit_compute") })).toBeDisabled();
  // Petri nets need no ProM.
  await chooseSource(page, "pnml");
  await expect(data.getByText(text("common.prom_missing"))).toHaveCount(0);
  // Nor do the measures of the logs themselves.
  await page.goto("/log");
  await chooseSource(page, "logs");
  await expect(stepSection(page, "data").getByText(text("common.prom_missing"))).toHaveCount(0);
});

test("the number of files per dataset is the one the server reports", async ({ page }) => {
  // The operator sets it (MAX_LOG_FILES), so the page must not assume the default of 50.
  const limits = { max_log_files: 3, max_pnml_files: 5, max_file_bytes: 100 * 1024 * 1024, max_total_bytes: 500 * 1024 * 1024 };
  await page.route("**/api/factor-analysis/catalog?*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), limits } });
  });
  await page.route("**/api/factor-analysis/limits", (route) => route.fulfill({ json: limits }));

  await page.goto("/");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await expect(data).toContainText(text("factor.data.logs_drop_hint", { max: 3 }));
  const log = (name: string) => ({ name, mimeType: "application/xml", buffer: Buffer.from("<log/>") });
  await data.locator('input[type="file"]').setInputFiles([1, 2, 3, 4].map((i) => log(`log${i}.xes`)));
  await expect(data).toContainText(text("factor.data.too_many_files", { max: 3, n: 1 }));

  await chooseSource(page, "pnml");
  await expect(data).toContainText(text("factor.data.pnml_drop_hint", { max: 5 }));
});

test("a deleted dataset is gone from My datasets", async ({ page }) => {
  await page.goto("/");
  await openBundled(page, "Alpha miner");
  await goToStep(page, "data");
  await stepSection(page, "data").getByRole("button", { name: text("factor.data.change") }).click();
  const mine = stepSection(page, "data").getByRole("radiogroup", { name: text("factor.data.source.mine") });
  const name = "Important Factors: Alpha miner";
  await expect(mine.getByRole("radio", { name })).toBeVisible();

  await mine.getByRole("button", { name: text("factor.data.delete_aria", { name }) }).click();
  const deleted = page.waitForResponse((r) => r.request().method() === "DELETE" && r.url().includes("/factor-analysis/datasets/"));
  await stepSection(page, "data").getByRole("button", { name: text("factor.data.delete_confirm") }).click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByRole("radio", { name })).toHaveCount(0);

  const listed = await (await page.request.get("/api/factor-analysis/datasets?kind=model")).json();
  expect(listed.datasets).toEqual([]);
});
