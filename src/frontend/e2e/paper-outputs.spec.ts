import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import {
  chooseDownload,
  deleteSessionDatasets,
  downloaded,
  expect,
  expectStep,
  FIT_TIMEOUT,
  goToStep,
  openBundled,
  pattern,
  stepSection,
  test,
  text,
  unzip,
} from "./fixtures";

// What a paper takes from an analysis: the short codes of the papers, the descriptive
// statistics, the LaTeX report, the figures, the print view, and the user guide.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

function toolbar(page: Page) {
  return page.getByRole("group", { name: text("factor.toolbar.aria") });
}

function codesSwitch(page: Page) {
  return toolbar(page).getByRole("button", { name: text("factor.toolbar.codes"), exact: true });
}

/** Opens the Inductive miner of Important Factors with the paper settings. */
async function openPaper(page: Page) {
  await page.goto("/");
  const data = stepSection(page, "data");
  await data.getByRole("radio", { name: "Inductive miner", exact: true }).check({ force: true });
  await data.getByRole("radio", { name: text("factor.data.preset.published"), exact: true }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_bundled") }).click();
  await expectStep(page, "loadings", "done");
}

test("short codes name the measures as the papers do, with the full name in the tooltip", async ({ page }) => {
  await page.goto("/");
  await openBundled(page, "Inductive miner");
  await expectStep(page, "loadings", "done");
  await goToStep(page, "loadings");
  const loadings = stepSection(page, "loadings");
  const row = loadings.getByRole("rowheader", { name: "Coefficient of network connectivity" });
  await expect(row).toBeVisible();

  await expect(codesSwitch(page)).toHaveAttribute("aria-pressed", "false");
  await codesSwitch(page).click();
  await expect(codesSwitch(page)).toHaveAttribute("aria-pressed", "true");
  const coded = loadings.getByRole("rowheader", { name: "CNC", exact: true });
  await expect(coded).toBeVisible();
  // The full name is in the tooltip of the code.
  await expect(coded.locator("[data-tip-more]")).toHaveAttribute("data-tip-more", /^Coefficient of network connectivity: /);

  // The list of the MSA uses them as well.
  await goToStep(page, "suitability");
  await expect(stepSection(page, "suitability").getByRole("rowheader", { name: "CNC", exact: true })).toBeVisible();

  // The browser keeps the choice.
  await page.reload();
  await expect(codesSwitch(page)).toHaveAttribute("aria-pressed", "true");
  await codesSwitch(page).click();
  await expect(stepSection(page, "suitability").getByRole("rowheader", { name: "Coefficient of network connectivity" })).toBeVisible();
});

test("the dataset step folds the descriptive statistics until asked for", async ({ page }) => {
  await page.goto("/");
  await openBundled(page, "Inductive miner");
  const dataset = stepSection(page, "dataset");
  const fold = dataset.getByRole("button", { name: pattern(text("factor.dataset.descriptives_heading")) });
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  // A bundled dataset was not computed by the tool, so it has no run times.
  await expect(dataset.getByRole("button", { name: pattern(text("factor.dataset.measurement_heading")) })).toHaveCount(0);
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
  const table = dataset.getByRole("table", { name: text("factor.dataset.descriptives_heading") });
  // As ComFy's report prints them: Size has the mean 71.684028; the constant measure is there too.
  await expect(table.getByRole("row", { name: /^Size/ })).toContainText("71.684");
  await expect(table.getByRole("row", { name: /^Number of empty sequence flows/ })).toContainText(text("factor.dataset.reason.constant"));
});

test("the LaTeX report, the figures and the ZIP take the analysis on screen into a paper", async ({ page }) => {
  await openPaper(page);
  await codesSwitch(page).click();

  // The report: as ComFy's, under the paper settings with its numbers and the assigned loadings bold.
  let download = page.waitForEvent("download");
  await chooseDownload(page, "factor.toolbar.export_report");
  const report = readFileSync(await downloaded(await download), "utf8");
  expect((await download).suggestedFilename()).toMatch(/-report\.tex$/);
  expect(report).toContain("\\section*{Results of the Factor Analysis}");
  expect(report).toContain("\\item CNC (Coefficient of network connectivity)");
  expect(report).toContain("size & $\\mathbf{0.9712}$");

  // The scree plot as SVG, its text kept as text.
  await goToStep(page, "factors");
  download = page.waitForEvent("download");
  await stepSection(page, "factors").getByRole("button", { name: text("factor.figure.download", { figure: text("factor.factors.scree_title") }) }).click();
  await page.getByRole("menuitem", { name: pattern(text("factor.figure.svg_hint")) }).click();
  const scree = readFileSync(await downloaded(await download), "utf8");
  expect(scree).toContain("<svg");
  expect(scree).toContain(">Eigenvalue<");

  // The loadings heatmap as PNG, with the short codes.
  await goToStep(page, "loadings");
  download = page.waitForEvent("download");
  await stepSection(page, "loadings").getByRole("button", { name: text("factor.figure.download", { figure: text("factor.figure.loadings") }) }).click();
  await page.getByRole("menuitem", { name: pattern(text("factor.figure.png_hint")) }).click();
  const png = readFileSync(await downloaded(await download));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  // The ZIP has all of it.
  download = page.waitForEvent("download");
  await chooseDownload(page, "factor.toolbar.export_zip");
  const files = unzip(await downloaded(await download));
  for (const name of ["report.tex", "descriptives.csv", "figures/scree.svg", "figures/loadings.svg"]) expect(files.has(name), name).toBe(true);
  expect(files.get("figures/loadings.svg")!.toString("utf8")).toContain(">CNC<");
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  expect(manifest.measure_labels).toBe("short_codes");
  // The heatmap of the ZIP is drawn as the figure menu draws it, in English as a paper is.
  expect(manifest.figure_order).toBe("factor");
  expect(manifest.figure_language).toBe("en");
});

test.describe("in the German UI", () => {
  test.use({ language: "de" });

  test("the figures are labelled in German and the ZIP has the order of the loadings on screen", async ({ page }) => {
    await page.goto("/");
    await openBundled(page, "Inductive miner", "de");
    await expectStep(page, "loadings", "done", "de");

    // The scree plot follows the language of the UI.
    await goToStep(page, "factors", "de");
    let download = page.waitForEvent("download");
    await stepSection(page, "factors")
      .getByRole("button", { name: text("factor.figure.download", { figure: text("factor.factors.scree_title", {}, "de") }, "de") })
      .click();
    await page.getByRole("menuitem", { name: pattern(text("factor.figure.svg_hint", {}, "de")) }).click();
    const scree = readFileSync(await downloaded(await download), "utf8");
    expect(scree).toContain(">Eigenwert<");
    expect(scree).not.toContain(">Eigenvalue<");

    // The ZIP takes the order chosen at the loadings, and keeps its figures English.
    await goToStep(page, "loadings", "de");
    await stepSection(page, "loadings").getByRole("button", { name: text("factor.loadings.order_original", {}, "de") }).click();
    download = page.waitForEvent("download");
    await page.getByRole("button", { name: text("factor.toolbar.export", {}, "de"), exact: true }).click();
    await page.getByRole("menuitem", { name: pattern(text("factor.toolbar.export_zip", {}, "de")) }).click();
    const files = unzip(await downloaded(await download));
    const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
    expect(manifest.figure_order).toBe("dataset");
    expect(manifest.figure_language).toBe("en");
    expect(files.get("figures/scree.svg")!.toString("utf8")).toContain(">Eigenvalue<");
  });
});

test("the print view shows the whole analysis on light pages without controls", async ({ page }) => {
  await openPaper(page);
  await toolbar(page).getByRole("button", { name: text("factor.toolbar.export") }).click();
  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("menuitem", { name: pattern(text("factor.toolbar.print")) }).click(),
  ]);
  await expect(print).toHaveURL(/\/print\?kind=model&dataset=.*&k=4&rot=varimax.*rule=multi/);
  const sheet = print.locator("article.light-sheet");
  await expect(sheet.getByRole("heading", { level: 1 })).toContainText("Important Factors: Inductive miner");
  for (const step of ["dataset", "suitability", "factors", "loadings"]) {
    await expect(sheet.getByRole("heading", { level: 2, name: text(`factor.steps.${step}`) })).toBeVisible();
  }
  // The figures the server drew are there and loaded.
  const scree = sheet.getByRole("img", { name: text("factor.factors.scree_title") });
  await expect(scree).toBeVisible();
  await expect.poll(() => scree.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // Under the paper settings it says that the numbers are those of the ComFy report.
  await expect(sheet).toContainText(text("print.match", { source: "@" }).split("@")[0]);
  // On paper only the sheet is left: no header, no tools.
  await print.emulateMedia({ media: "print" });
  await expect(print.getByRole("banner").first()).toBeHidden();
  await expect(print.getByRole("button", { name: text("print.print") })).toBeHidden();
  await expect(sheet).toBeVisible();
  await print.close();
});

test("the print view sets the loadings of many measures as a table, as the heatmap would not fit a page", async ({ page }) => {
  await page.goto("/log?bundled=comfy-log-pdc-training-logs&preset=standard&step=loadings");
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await toolbar(page).getByRole("button", { name: text("factor.toolbar.export") }).click();
  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("menuitem", { name: pattern(text("factor.toolbar.print")) }).click(),
  ]);
  const sheet = print.locator("article.light-sheet");
  await expect(sheet.getByRole("heading", { level: 1 })).toBeVisible({ timeout: FIT_TIMEOUT });
  const loadings = sheet.locator("section", { has: print.getByRole("heading", { level: 2, name: text("factor.steps.loadings") }) });
  // No heatmap: its 120 rows are taller than two pages and cannot break. A table of one row per
  // measure, with the header that repeats on every page.
  await expect(loadings.getByRole("img", { name: text("factor.figure.loadings") })).toHaveCount(0);
  const table = loadings.getByRole("table", { name: text("factor.loadings.table_heading") });
  await expect(table.locator("tbody tr")).not.toHaveCount(0);
  expect(await table.locator("tbody tr").count()).toBeGreaterThan(100);
  await print.emulateMedia({ media: "print" });
  expect(await table.locator("thead").evaluate((el) => getComputedStyle(el).display)).toBe("table-header-group");
  // The heading stays with its first block.
  await expect(loadings.locator(".print-keep").getByRole("heading", { level: 2 })).toBeVisible();
  await print.close();
});

test("the help icon opens the user guide", async ({ page }) => {
  await page.goto("/");
  await toolbar(page).getByRole("button", { name: text("factor.toolbar.help") }).click();
  const [guide] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("menuitem", { name: pattern(text("factor.toolbar.guide")) }).click(),
  ]);
  await expect(guide).toHaveURL(/\/guide$/);
  await expect(guide.getByRole("heading", { level: 1, name: text("guide.title") })).toBeVisible();
  const toc = guide.getByRole("navigation", { name: text("guide.toc") });
  await toc.getByRole("link", { name: text("guide.export.title") }).click();
  await expect(guide).toHaveURL(/#guide-export$/);
  await expect(guide.getByRole("heading", { level: 2, name: text("guide.export.title") })).toBeInViewport();
  await guide.close();
});

for (const language of ["en", "de"] as const) {
  test.describe(`methods text (${language})`, () => {
    test.use({ language });

    test("the methods text is copied with the numbers on screen and its BibTeX is downloaded", async ({ page }) => {
      // The clipboard is stubbed: the text is kept for the test to read.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: { writeText: async (value: string) => ((window as unknown as { __copied: string }).__copied = value) },
        });
      });
      await page.goto("/");
      await openBundled(page, "Inductive miner", language);
      await expectStep(page, "loadings", "done", language);
      await goToStep(page, "suitability", language);
      // The numbers of the suitability step on screen.
      const suitability = stepSection(page, "suitability");
      const shown = (await suitability.innerText()).replace(/\s+/g, " ");
      await chooseDownload(page, "factor.toolbar.export_methods", language);
      await expect(page.getByRole("status").filter({ hasText: text("factor.toolbar.methods_copied", {}, language) })).toBeVisible();
      const copied = await page.evaluate(() => (window as unknown as { __copied: string }).__copied);
      const kmo = language === "de" ? "0,75" : "0.75";
      const chi = language === "de" ? "6.822,4" : "6822.4";
      // The decimal comma in German; the KMO and chi-square of the page are those of the text.
      expect(shown).toContain(kmo);
      expect(shown).toContain(language === "de" ? "6.822,4" : "6,822.4");
      expect(copied).toContain(kmo);
      expect(copied).toContain(`$\\chi^2(`);
      expect(copied).toContain(`= ${chi}$`);
      expect(copied).toContain("\\cite{schalk2026important}");
      expect(copied).toContain(language === "de" ? "Der Datensatz" : "The dataset");
      const keys = [...copied.matchAll(/\\cite\{([^}]*)\}/g)].flatMap((m) => m[1].split(","));

      const download = page.waitForEvent("download");
      await chooseDownload(page, "factor.toolbar.export_bibtex", language);
      const bib = readFileSync(await downloaded(await download), "utf8");
      const entries = [...bib.matchAll(/^@\w+\{([^,]+),/gm)].map((m) => m[1]);
      // Exactly the keys the text cites, each once.
      expect([...new Set(keys)].sort()).toEqual([...entries].sort());
      expect(bib).toContain("doi = {10.1007/BF02291575}");
    });
  });
}
