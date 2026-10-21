import {
  COMPUTE_TIMEOUT,
  FIT_TIMEOUT,
  chooseSource,
  deleteSessionDatasets,
  expect,
  expectStep,
  goToStep,
  pattern,
  stepSection,
  test,
  text,
} from "./fixtures";
import { xesFiles } from "./logs";

// The logs a dataset is computed from stay among the recent uploads of the session, so that its rows
// can lead to the page of a single log ("View this log"); and a dataset that has been computed
// raises a notice wherever the reader is meanwhile.

test.afterEach(async ({ page }) => {
  await deleteSessionDatasets(page);
  await page.request.delete("/api/jobs");
});

/** Computes the measures of three small logs on the log tab and leaves for another page meanwhile. */
async function computeThreeLogs(page: import("@playwright/test").Page) {
  await page.goto("/log");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await data.locator('input[type="file"]').setInputFiles(xesFiles(3));
  // Two groups of feeed that small logs can give values for; the others need more traces.
  await data.getByRole("button", { name: "None", exact: true }).click();
  await data.getByRole("checkbox", { name: /^Simple statistics/ }).check({ force: true });
  await data.getByRole("checkbox", { name: /^Activities/ }).check({ force: true });
  const started = page.waitForResponse((r) => r.url().endsWith("/factor-analysis/datasets") && r.request().method() === "POST");
  await data.getByRole("button", { name: text("factor.data.submit_compute") }).click();
  expect((await started).ok()).toBeTruthy();
}

test("a dataset that was computed in the background says so wherever the reader is, and Open leads to it", async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await computeThreeLogs(page);
  // To another page by its link, so that this page stays: a notice is for those who left meanwhile.
  await page.getByRole("link", { name: text("header.settings_label") }).click();
  await expect(page.getByRole("heading", { level: 1, name: text("settings.page_title") })).toBeVisible();
  const notice = page.getByRole("status").filter({ hasText: /is ready/ });
  await expect(notice).toBeVisible({ timeout: COMPUTE_TIMEOUT });
  await expect(notice).toContainText(text("jobs.ready", { name: "Dataset from 3 logs" }));
  await notice.getByRole("link", { name: pattern(text("jobs.ready_open")) }).click();
  // The dataset opens on the log tab, at its dataset step.
  await expect(page).toHaveURL(/\/log/);
  await expectStep(page, "dataset", "done", "en", FIT_TIMEOUT);
  await expect(stepSection(page, "dataset")).toBeVisible();
  await expect(notice).toHaveCount(0);
});

test("the rows of a dataset of logs lead to the logs, which stay among the recent uploads", async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await computeThreeLogs(page);
  await expectStep(page, "dataset", "done", "en", COMPUTE_TIMEOUT);
  await goToStep(page, "dataset");
  const dataset = stepSection(page, "dataset");
  const links = dataset.getByRole("link", { name: text("factor.dataset.view_log") });
  // One link at each row of the preview of the data (the run times, folded, have one at each row too).
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAttribute("href", "/inspect?log=log1.xes");
  await expect(links.nth(2)).toHaveAttribute("href", "/inspect?log=log3.xes");

  // The log is among the recent uploads of the page of a single log, chosen by the link.
  await links.nth(1).click();
  await expect(page).toHaveURL(/\/inspect/);
  const recent = page.getByRole("radiogroup", { name: text("workbench.recent.label") });
  await expect(recent.getByRole("radio", { name: /^log2\.xes/ })).toBeChecked();
  await expect(page.getByRole("status").filter({ hasText: text("inspect.from_dataset", { log: "log2.xes" }) })).toBeVisible();
  // The link is taken once: the address is clean again and the choice can be changed.
  await expect(page).toHaveURL(/\/inspect$/);
  // The overview of the log is there.
  await expect(page.getByText(/traces/).first()).toBeVisible();
  await recent.getByRole("radio", { name: /^log3\.xes/ }).check({ force: true });
  await expect(recent.getByRole("radio", { name: /^log3\.xes/ })).toBeChecked();
});

test("a log that is no longer among the recent uploads says so, and the icon says why", async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await computeThreeLogs(page);
  await expectStep(page, "dataset", "done", "en", COMPUTE_TIMEOUT);
  // The server keeps the ten newest uploads; here none is left.
  await page.route("**/api/recent-logs", (route) => route.fulfill({ json: [] }));
  await page.reload();
  await expectStep(page, "dataset", "done", "en", FIT_TIMEOUT);
  await goToStep(page, "dataset");
  const dataset = stepSection(page, "dataset");
  await expect(dataset.getByRole("link", { name: text("factor.dataset.view_log") })).toHaveCount(0);
  const gone = dataset.getByRole("button", { name: text("factor.dataset.view_log") });
  await expect(gone).toHaveCount(3);
  await expect(gone.first()).toHaveAttribute("aria-disabled", "true");
  await expect(gone.first()).toHaveAttribute("aria-description", pattern(text("factor.dataset.view_log_gone")));

  // An address that names such a log says so, without choosing anything.
  await page.goto("/inspect?log=log1.xes");
  await expect(page.getByRole("status").filter({ hasText: text("inspect.log_gone", { log: "log1.xes" }) })).toBeVisible();
  await expect(page).toHaveURL(/\/inspect$/);
  await expect(page.getByRole("button", { name: text("common.run_analysis") })).toBeDisabled();
});

test("the page of a single log named by an address takes the miner of the row", { tag: "@prom" }, async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await page.goto("/");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await data.getByRole("checkbox", { name: new RegExp(text("factor.data.sample_label")) }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_compute") }).click();
  await expectStep(page, "dataset", "done", "en", COMPUTE_TIMEOUT);
  await goToStep(page, "dataset");
  const dataset = stepSection(page, "dataset");
  // A row is a log and a miner; its link names both.
  const link = dataset.getByRole("link", { name: text("factor.dataset.view_log") }).first();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/inspect\?log=pdc.*\.xes&miner=Inductive\+miner$/);
  await link.click();
  await expect(page).toHaveURL(/\/inspect$/);
  const miners = page.getByRole("group", { name: /Discovery algorithms/ });
  // Only the miner of the row is chosen.
  await expect(page.getByRole("checkbox", { name: "Inductive miner", exact: true })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Directly Follows miner", exact: true })).not.toBeChecked();
  void miners;
});
