import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  FIT_TIMEOUT,
  chooseDownload,
  deleteSessionDatasets,
  downloaded,
  expect,
  expectStep,
  goToStep,
  pattern,
  stepLink,
  stepSection,
  test,
  text,
  unzip,
} from "./fixtures";

// The names of the factors: given in place in the loadings, carried into the step rail and the
// downloads, kept with the dataset, and cleared with an undo when the solution changes.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

/** The Inductive miner of Important Factors with the paper settings: 4 factors, multiple membership. */
async function openPaper(page: Page) {
  await page.goto("/?bundled=comfy-paper-inductive-miner&preset=published&step=loadings");
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await goToStep(page, "loadings");
  await stepSection(page, "loadings").getByRole("radio", { name: text("factor.loadings.look_matrix") }).click();
}

function head(page: Page, i: number) {
  return stepSection(page, "loadings").locator("thead").first().getByRole("button", {
    name: new RegExp(`^${text("factor.loadings.factor_n", { i })}\\b`),
  });
}

async function rename(page: Page, i: number, name: string, key: "Enter" | "Escape" = "Enter") {
  await head(page, i).click();
  const field = stepSection(page, "loadings").getByRole("textbox", { name: text("factor.names.field", { i }) });
  await expect(field).toBeFocused();
  await field.fill(name);
  await field.press(key);
}

test("a factor is named in place and the name goes into the rail, the cards and the LaTeX loadings", async ({ page }) => {
  await openPaper(page);
  // The name is saved with the options of the dataset, a moment after it is given.
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/options") && (r.request().postData() ?? "").includes("Größe"),
  );
  await rename(page, 1, "Größe");
  await expect(head(page, 1)).toHaveAccessibleName(`${text("factor.loadings.factor_n", { i: 1 })}: Größe`);
  await expect(head(page, 1)).toBeFocused();
  // Esc leaves a name as it was.
  await rename(page, 2, "not kept", "Escape");
  await expect(head(page, 2)).toHaveAccessibleName(text("factor.loadings.factor_n", { i: 2 }));
  // At most 40 characters.
  await head(page, 3).click();
  const field = stepSection(page, "loadings").getByRole("textbox", { name: text("factor.names.field", { i: 3 }) });
  await expect(field).toHaveAttribute("maxlength", "40");
  await field.press("Escape");

  await expect(stepLink(page, "loadings")).toContainText("Größe");
  await stepSection(page, "loadings").getByRole("radio", { name: text("factor.loadings.look_dimensions") }).click();
  await expect(stepSection(page, "loadings").locator("h4").first()).toContainText("Größe");

  // The LaTeX of the loadings heads the column with the name.
  const download = page.waitForEvent("download");
  await chooseDownload(page, "factor.toolbar.export_loadings_latex");
  const tex = readFileSync(await downloaded(await download), "utf8");
  expect(tex).toContain("Measure & Größe & Factor 2 & Factor 3 & Factor 4 & Communality");

  // The ZIP lists the names in its manifest.
  const zip = page.waitForEvent("download");
  await chooseDownload(page, "factor.toolbar.export_zip");
  const files = unzip(await downloaded(await zip));
  expect(JSON.parse(files.get("manifest.json")!.toString("utf8")).factor_names).toEqual(["Größe", null, null, null]);

  // Kept with the dataset: a reload brings the name back.
  expect((await saved).status()).toBe(204);
  await page.reload();
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await expect(stepLink(page, "loadings")).toContainText("Größe");
});

test("another factor count clears the names, and Undo brings back both", async ({ page }) => {
  await openPaper(page);
  await rename(page, 1, "Size");
  await goToStep(page, "factors");
  await stepSection(page, "factors").getByRole("button", { name: text("factor.factors.increase") }).click();
  const toast = page.getByRole("status").filter({ hasText: text("factor.names.cleared") });
  await expect(toast).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(stepLink(page, "loadings")).not.toContainText("Size");
  await toast.getByRole("button", { name: text("common.undo") }).click();
  await expect(stepSection(page, "factors").locator("#fa-factor-count")).toHaveText("4");
  await expect(stepLink(page, "loadings")).toContainText("Size", { timeout: FIT_TIMEOUT });
  await goToStep(page, "loadings");
  await expect(head(page, 1)).toHaveAccessibleName(pattern("Size"));
});
