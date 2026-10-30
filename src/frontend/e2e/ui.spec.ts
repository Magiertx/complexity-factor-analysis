import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  deleteSessionDatasets,
  expect,
  expectStep,
  FIT_TIMEOUT,
  goToStep,
  openBundled,
  pattern,
  stepLink,
  stepSection,
  test,
  text,
} from "./fixtures";

/** The serious and critical problems axe finds on the page, one line each. */
async function seriousProblems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

test.describe("German", () => {
  test.use({ language: "de" });
  test.afterEach(async ({ page }) => deleteSessionDatasets(page));

  test("shows decimal commas", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text("factor.model.title", {}, "de"));
    await openBundled(page, "Inductive miner", "de");
    await expectStep(page, "suitability", "done", "de");
    await goToStep(page, "suitability", "de");
    const suitability = stepSection(page, "suitability");
    // KMO 0.7467 and chi-square 6822.44, as the German UI writes them.
    await expect(suitability).toContainText("0,75");
    await expect(suitability).toContainText("6.822,4");
    await expect(suitability).not.toContainText("0.75");
  });
});

test("the theme switch toggles dark mode and keeps it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/settings");
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/\bdark\b/);
  const toggle = page.getByRole("button", { name: text("header.dark_mode") });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");

  await toggle.click();
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(html).toHaveClass(/\bdark\b/);

  await page.getByRole("button", { name: text("header.dark_mode") }).click();
  await expect(html).not.toHaveClass(/\bdark\b/);
});

const ROUTES = ["/", "/log", "/inspect", "/compare", "/runs", "/settings", "/api-access", "/guide"];

for (const scheme of ["light", "dark"] as const) {
  for (const route of ROUTES) {
    test(`axe finds no serious problem on ${route} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      // The theme follows the system until it is set.
      await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
      // Wait until the page has loaded what it fetches, e.g. the catalog or the runs.
      await page.waitForLoadState("networkidle");
      expect(await seriousProblems(page)).toEqual([]);
    });
  }

  test(`axe finds no serious problem in the three looks of the comparison (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    // The four miners and the Inductive miner with six factors beside them: a tile of its own.
    await page.goto(
      "/compare?cols=comfy-paper-alpha-miner,comfy-paper-directly-follows-miner,comfy-paper-inductive-miner,comfy-paper-inductive-miner~k6,comfy-paper-hybrid-ilp-miner&rule=hair",
    );
    await expect(page.locator("table.data-table").first()).toBeVisible({ timeout: FIT_TIMEOUT });
    await expect(page.getByRole("status").filter({ hasText: text("compare.computing") })).toHaveCount(0, { timeout: FIT_TIMEOUT });
    for (const look of ["matrix", "dimensions", "pairs"]) {
      await page.getByRole("radio", { name: text(`compare.look.${look}`) }).click();
      await expect(page.locator("table.data-table").first()).toBeVisible();
      expect(await seriousProblems(page), look).toEqual([]);
    }
  });

  test(`axe finds no serious problem on any step of an open analysis (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/?bundled=comfy-paper-inductive-miner&preset=published");
    await expectStep(page, "loadings", "done");
    for (const step of ["data", "dataset", "suitability", "factors", "loadings", "interpretation"]) {
      // Without an API key or a stored interpretation the last step cannot be opened.
      if (step === "interpretation" && (await stepLink(page, step).getAttribute("aria-disabled")) === "true") continue;
      await goToStep(page, step);
      await page.waitForLoadState("networkidle");
      expect(await seriousProblems(page), step).toEqual([]);
    }
    // The other look of the loadings, and the download menu open.
    await goToStep(page, "loadings");
    await stepSection(page, "loadings").getByRole("radio", { name: text("factor.loadings.look_dimensions") }).click();
    await page.getByRole("button", { name: text("factor.toolbar.export"), exact: true }).click();
    expect(await seriousProblems(page), "dimensions and menu").toEqual([]);
    await page.keyboard.press("Escape");
    // The statistics of the dataset step unfolded, and the print view of the analysis.
    await goToStep(page, "dataset");
    await stepSection(page, "dataset").getByRole("button", { name: pattern(text("factor.dataset.descriptives_heading")) }).click();
    expect(await seriousProblems(page), "descriptive statistics").toEqual([]);
    await page.getByRole("button", { name: text("factor.toolbar.export"), exact: true }).click();
    const print = await page.getByRole("menuitem", { name: pattern(text("factor.toolbar.print")) }).getAttribute("href");
    await page.keyboard.press("Escape");
    await page.goto(print!);
    await expect(page.locator("article.light-sheet img").first()).toBeVisible();
    expect(await seriousProblems(page), "print view").toEqual([]);
    await deleteSessionDatasets(page);
  });
}

test("axe finds no serious problem in the long lists of the log tab", async ({ page }) => {
  await page.goto("/log?bundled=comfy-log-pdc-training-logs&preset=standard&step=suitability");
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  const suitability = stepSection(page, "suitability");
  await suitability.getByRole("button", { name: text("factor.measures.group_aria") }).click();
  await page.getByRole("option", { name: text("factor.measures.grouping.group") }).click();
  await expect(suitability.locator("tr.table-group").first()).toBeVisible();
  expect(await seriousProblems(page), "suitability").toEqual([]);
  await goToStep(page, "loadings");
  expect(await seriousProblems(page), "loadings").toEqual([]);
  await deleteSessionDatasets(page);
});

test("a single run without ProM fails with the coded error", { tag: "@no-prom" }, async ({ page }) => {
  test.slow();
  await page.goto("/inspect");
  await page
    .getByRole("radiogroup", { name: text("workbench.log_source.aria") })
    .getByRole("radio", { name: text("workbench.log_source.use_sample") })
    .click();
  await page.getByRole("radiogroup", { name: text("workbench.samples.label") }).getByRole("radio").first().check({ force: true });
  const run = page.getByRole("button", { name: text("common.run_analysis") });
  await expect(run).toBeEnabled();
  await run.click();
  // ComFy waits PROM4PY_START_WAIT seconds for ProM, then the run fails with prom_unavailable,
  // which the UI shows in its own words instead of the server's message.
  await expect(page.getByText(text("errors.prom_unavailable"))).toBeVisible({ timeout: 60_000 });

  expect((await page.request.delete("/api/jobs")).ok()).toBeTruthy();
});
