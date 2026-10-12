import AxeBuilder from "@axe-core/playwright";
import { deleteSessionDatasets, expect, expectStep, openBundled, stepSection, test, text } from "./fixtures";

test.describe("German", () => {
  test.use({ language: "de" });
  test.afterEach(async ({ page }) => deleteSessionDatasets(page));

  test("shows decimal commas", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text("factor.model.title", {}, "de"));
    await openBundled(page, "Inductive miner", "de");
    await expectStep(page, "suitability", "done", "de");
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

const ROUTES = ["/", "/log", "/inspect", "/runs", "/settings", "/api-access"];

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
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(
        serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`),
      ).toEqual([]);
    });
  }
}

test("a single run without ProM fails with the coded error", { tag: "@no-prom" }, async ({ page }) => {
  test.slow();
  await page.goto("/inspect");
  await page
    .getByRole("group", { name: text("workbench.log_source.aria") })
    .getByRole("button", { name: text("workbench.log_source.use_sample") })
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
