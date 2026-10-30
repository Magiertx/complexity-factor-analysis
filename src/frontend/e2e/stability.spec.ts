import {
  FIT_TIMEOUT,
  deleteSessionDatasets,
  expect,
  expectStep,
  goToStep,
  stepSection,
  test,
  text,
} from "./fixtures";

// The stability of the solution: checked only on request as a job of the History, shown per
// measure and dimension, kept for the settings, stale once they change; and the short set with its
// badges and copy actions.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

const NAME = "Important Factors: Inductive miner";

test("the stability is checked on request and the short set is copied", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?bundled=comfy-paper-inductive-miner&step=loadings");
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await goToStep(page, "loadings");
  const section = stepSection(page, "loadings");

  // The short set needs no request: a representative per dimension, with its badge.
  const shortSet = section.getByTestId("short-set");
  await expect(shortSet).toBeVisible();
  const representatives = await section.getByTestId("representative").count();
  expect(representatives).toBeGreaterThan(0);
  await expect(shortSet.getByRole("heading")).toHaveText(
    text(representatives === 1 ? "factor.short_set.heading" : "factor.short_set.heading_plural", { n: representatives }),
  );
  await shortSet.getByRole("button", { name: text("factor.short_set.copy_csv") }).click();
  await expect(page.getByRole("status").filter({ hasText: text("factor.short_set.copied") })).toBeVisible();
  const csv = await page.evaluate(() => navigator.clipboard.readText());
  // The clipboard of Windows hands the lines back with CRLF.
  const lines = csv.trim().split(/\r?\n/);
  expect(lines[0]).toBe("dimension,measure,loading,purity");
  expect(lines).toHaveLength(representatives + 1);
  await shortSet.getByRole("button", { name: text("factor.short_set.copy_latex") }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("\\begin{tabular}{llr}");

  // Nothing is computed until asked.
  await expect(section.getByTestId("measure-stability")).toHaveCount(0);
  await section.getByRole("radio", { name: "100", exact: true }).click();
  await section.getByRole("button", { name: text("factor.stability.action"), exact: true }).click();
  await expect(section.getByTestId("measure-stability").first()).toBeVisible({ timeout: 60_000 });
  await expect(section.getByTestId("stability")).toContainText(/Stable over \d+ samples: \d+ of \d+ measures ≥ 90 %/);
  await expect(section.getByTestId("factor-congruence").first()).toContainText("φ");
  await expect(section.getByRole("button", { name: text("factor.stability.action"), exact: true })).toHaveCount(0);
  // The stability goes into the short set and its LaTeX table.
  await shortSet.getByRole("button", { name: text("factor.short_set.copy_latex") }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("\\begin{tabular}{llrr}");

  // The pairs are one click away.
  await section.getByRole("button", { name: text("factor.stability.pairs_show") }).click();
  await expect(section.getByTestId("stability-pairs").getByRole("table")).toBeVisible();

  // Kept for these settings: the dataset reopens with it at once.
  const id = await page.evaluate(() => localStorage.getItem("app.factor-dataset-model"));
  await page.goto(`/?dataset=${id}&step=loadings`);
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await goToStep(page, "loadings");
  await expect(section.getByTestId("measure-stability").first()).toBeVisible();

  // Other settings: the old result is stale, not shown as current.
  await section.locator("#fa-loading-threshold").fill("0.5");
  await section.locator("#fa-loading-threshold").press("Enter");
  await expect(section.getByText(text("factor.stability.stale"))).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(section.getByTestId("measure-stability")).toHaveCount(0);
  await expect(section.getByRole("button", { name: text("factor.stability.again"), exact: true })).toBeVisible();

  // The job is in the History.
  await page.goto("/runs");
  await expect(page.getByText(text("jobs.stability_title", { name: NAME })).first()).toBeVisible();
});
