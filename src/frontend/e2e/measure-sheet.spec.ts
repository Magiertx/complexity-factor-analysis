import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  deleteSessionDatasets,
  expect,
  expectStep,
  FIT_TIMEOUT,
  goToStep,
  pattern,
  stepSection,
  test,
  text,
  showMatrix,
} from "./fixtures";

// The fact sheet of a measure: a click or Enter on its name, wherever the name stands, opens a panel
// beside the page. The arrow keys page through the list it was opened from, Escape closes it and the
// focus returns to the name. It shows what the measure is (the description of the tool and the
// function of ComFy or feeed behind it), its distribution, what became of it in the analysis, the five
// measures it correlates with most, and lets the reader exclude or include it.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

const MODEL = "/?bundled=comfy-paper-inductive-miner&preset=published&step=suitability";
const LOG = "/log?bundled=comfy-log-pdc-training-logs&preset=standard&step=suitability";

function sheet(page: Page, measure: string): Locator {
  return page.getByRole("dialog", { name: measure, exact: true });
}

async function openModel(page: Page, step = "suitability") {
  await page.goto(`${MODEL.split("&step")[0]}&step=${step}`);
  await expectStep(page, "loadings", "done");
}

/** The name of a measure in the list of the MSA, which is a button that opens its sheet. */
function nameIn(section: Locator, measure: string): Locator {
  return section.getByRole("button", { name: measure, exact: true });
}

test("a name opens the sheet, the arrow keys page, Escape closes it and the focus returns", async ({ page }) => {
  await openModel(page);
  const list = stepSection(page, "suitability").locator("#fa-msa-table");
  const size = nameIn(list, "Size");
  await size.focus();
  await page.keyboard.press("Enter");
  const dialog = sheet(page, "Size");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  // The title takes the focus, and the list the sheet pages through is that of the table.
  await expect(dialog.getByRole("heading", { name: "Size", level: 2 })).toBeFocused();
  await expect(dialog).toContainText(text("factor.sheet.position", { i: 3, n: 12 }));

  await page.keyboard.press("ArrowRight");
  await expect(sheet(page, "Connector Mismatch")).toBeVisible();
  await expect(sheet(page, "Connector Mismatch")).toContainText(text("factor.sheet.position", { i: 4, n: 12 }));
  await expect(sheet(page, "Connector Mismatch").getByRole("status")).toHaveText(
    text("factor.sheet.announce", { measure: "Connector Mismatch", i: 4, n: 12 }),
  );
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(sheet(page, "Sequentiality")).toBeVisible();
  // The first of the list: no way back, and the button says why.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(sheet(page, "Control flow complexity")).toBeVisible();
  const previous = page.getByRole("dialog").getByRole("button", { name: text("factor.sheet.prev") });
  await expect(previous).toHaveAttribute("aria-disabled", "true");
  await expect(previous).toHaveAttribute("aria-description", pattern(text("factor.sheet.first")));
  await page.keyboard.press("ArrowLeft");
  await expect(sheet(page, "Control flow complexity")).toBeVisible();

  // Tab stays inside the sheet.
  for (let i = 0; i < 14; i++) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);

  // Escape closes a tooltip that is up first (the keyboard focus shows one), then the sheet.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 1000 });
  }).toPass();
  await expect(size).toBeFocused();
});

test("the sheet of a model measure says what it is, what became of it and what it correlates with", async ({ page }) => {
  await openModel(page);
  await nameIn(stepSection(page, "suitability").locator("#fa-msa-table"), "Size").click();
  const dialog = sheet(page, "Size");
  // Definition: the description of the tool and ComFy's function with a link into its file.
  await expect(dialog).toContainText("Number of places and transitions.");
  await expect(dialog).toContainText("measure_size");
  const source = dialog.getByRole("link", { name: pattern(text("factor.sheet.source_commit", { tool: "ComFy", commit: "1dd6ea6" })) });
  await expect(source).toHaveAttribute("href", "https://github.com/Pati-nets/ComFy/blob/1dd6ea6/modelcomplexity/ModelComplexity.py");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", /noopener/);
  // Distribution: the histogram, and the statistics of the dataset step in the same words.
  await expect(dialog.getByRole("img", { name: /^Histogram of Size: \d+ bins from 34 to 197/ })).toBeVisible();
  await expect(dialog).toContainText("288");
  await expect(dialog).toContainText("71.684");
  // In this analysis: MSA, communality, uniqueness and a bar for each of the four factors.
  await expect(dialog).toContainText(text("factor.sheet.status.used"));
  await expect(dialog.getByText("0.69", { exact: true })).toBeVisible();
  await expect(dialog.getByText("0.99", { exact: true }).first()).toBeVisible();
  const loadings = dialog.getByRole("heading", { name: text("factor.sheet.loadings") }).locator("xpath=following-sibling::ul[1]/li");
  await expect(loadings).toHaveCount(4);
  await expect(loadings.first()).toContainText("0.97");
  // The five closest measures, the strongest first.
  // The buttons of the list, not the (i) beside its heading.
  const closest = dialog.getByRole("region", { name: text("factor.sheet.closest") }).getByRole("list");
  await expect(closest.getByRole("button")).toHaveCount(5);
  await expect(closest.getByRole("button").first()).toContainText("Number of duplicate tasks");
  await expect(closest.getByRole("button").first()).toContainText("0.99");
  // A click on one of them shows its sheet, in the same panel.
  await closest.getByRole("button").first().click();
  await expect(sheet(page, "Number of duplicate tasks")).toBeVisible();
});

test("a measure the MSA filter removed says in which round and at which value", async ({ page }) => {
  await openModel(page);
  await nameIn(stepSection(page, "suitability").locator("#fa-msa-table"), "Sequentiality").click();
  const dialog = sheet(page, "Sequentiality");
  await expect(dialog).toContainText(text("factor.sheet.status.removed", { step: 1 }));
  await expect(dialog).toContainText(text("factor.sheet.msa_removed", { msa: "0.49" }));
  // A removed measure has no loadings.
  await expect(dialog.getByRole("heading", { name: text("factor.sheet.loadings") })).toHaveCount(0);
});

test("the sheet excludes and includes the measure, and the list agrees", async ({ page }) => {
  await openModel(page);
  const suitability = stepSection(page, "suitability");
  await nameIn(suitability.locator("#fa-msa-table"), "Density").click();
  const dialog = sheet(page, "Density");
  await dialog.getByRole("button", { name: text("factor.sheet.exclude") }).click();
  await expect(dialog).toContainText(text("factor.sheet.status.excluded"));
  await expect(dialog).toContainText(text("factor.sheet.excluded_note"));
  await expect(dialog.getByRole("status")).toHaveText(text("factor.sheet.excluded_done", { measure: "Density" }));
  await expect(dialog.getByRole("button", { name: text("factor.sheet.include") })).toBeVisible();
  await page.keyboard.press("Escape");
  const box = suitability.getByRole("checkbox", { name: text("factor.suitability.exclude_aria", { measure: "Density" }) });
  await expect(box).toBeChecked();

  await nameIn(suitability.locator("#fa-msa-table"), "Density").click();
  await sheet(page, "Density").getByRole("button", { name: text("factor.sheet.include") }).click();
  await page.keyboard.press("Escape");
  await expect(box).not.toBeChecked();
});

test("the sheet cannot take the analysis below the measures it needs", async ({ page }) => {
  await openModel(page);
  const suitability = stepSection(page, "suitability");
  // Leave three measures in: exclude all the others by the checkboxes.
  const names = await suitability.locator("#fa-msa-table tbody th[scope=row]").allInnerTexts();
  for (const name of names.slice(0, names.length - 3)) {
    await suitability.getByRole("checkbox", { name: text("factor.suitability.exclude_aria", { measure: name.trim() }) }).check({ force: true });
  }
  await nameIn(suitability.locator("#fa-msa-table"), names[names.length - 1].trim()).click();
  const button = page.getByRole("dialog").getByRole("button", { name: text("factor.sheet.exclude") });
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toHaveAttribute("aria-description", pattern(text("factor.sheet.locked", { n: 3 })));
});

test("every place that names a measure opens its sheet", async ({ page }) => {
  await openModel(page, "loadings");
  // The matrix of the loadings and the cards of the dimensions, and the unassigned measures.
  const loadings = stepSection(page, "loadings");
  await showMatrix(page);
  await nameIn(loadings.locator("table.data-table"), "Coefficient of network connectivity").click();
  await expect(sheet(page, "Coefficient of network connectivity")).toBeVisible();
  await page.keyboard.press("Escape");
  await loadings.getByRole("radio", { name: text("factor.loadings.look_dimensions") }).click();
  await nameIn(loadings, "Coefficient of network connectivity").first().click();
  await expect(sheet(page, "Coefficient of network connectivity")).toBeVisible();
  await page.keyboard.press("Escape");
  // The paging follows the cards: the next measure is the next one on screen.
  await nameIn(loadings, "Size").click();
  const position = await sheet(page, "Size").locator("p").first().innerText();
  expect(position).toMatch(/^\d+ of \d+$/);
  await page.keyboard.press("Escape");

  // The cleaning table and the statistics of the dataset step.
  await goToStep(page, "dataset");
  const dataset = stepSection(page, "dataset");
  await dataset.getByRole("button", { name: pattern(text("factor.dataset.descriptives_heading")) }).click();
  await nameIn(dataset, "Separability").click();
  await expect(sheet(page, "Separability")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nameIn(dataset, "Separability")).toBeFocused();
});

test("a measure the cleaning dropped has a sheet without an analysis", async ({ page }) => {
  await openModel(page, "dataset");
  const dataset = stepSection(page, "dataset");
  await dataset.getByRole("button", { name: pattern(text("factor.dataset.descriptives_heading")) }).click();
  // The Inductive miner data has measures cleaning drops (a duplicate of another); its row is greyed.
  const dropped = dataset.locator("table.data-table tbody tr.text-muted th").first();
  const name = (await dropped.innerText()).trim();
  await nameIn(dataset, name).first().click();
  const dialog = sheet(page, name);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(text("factor.sheet.status.dropped"));
  await expect(dialog.getByRole("button", { name: text("factor.sheet.exclude") })).toHaveCount(0);
});

test("the sheet of a log measure names its feeed group and function, with a link to the source", async ({ page }) => {
  test.setTimeout(FIT_TIMEOUT * 3);
  await page.goto(LOG);
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  const suitability = stepSection(page, "suitability");
  await suitability.getByRole("searchbox", { name: text("factor.measures.search") }).fill("n_events");
  await nameIn(suitability.locator("#fa-msa-table"), "n_events").click();
  const dialog = sheet(page, "n_events");
  await expect(dialog).toContainText("SimpleStats.n_events");
  await expect(dialog).toContainText("Simple statistics");
  // No definition of its own for a log measure.
  await expect(dialog).not.toContainText(text("factor.sheet.description_note"));
  await expect(dialog.getByRole("link", { name: pattern("feeed, commit b28fb49") })).toHaveAttribute(
    "href",
    "https://github.com/andreamalhera/feeed/blob/b28fb49/feeed/simple_stats.py",
  );
  // Fifteen factors: a bar for each.
  const loadings = dialog.getByRole("heading", { name: text("factor.sheet.loadings") }).locator("xpath=following-sibling::ul[1]/li");
  await expect(loadings).toHaveCount(15);
  // The closest measures come from the same map.
  await expect(dialog.getByRole("region", { name: text("factor.sheet.closest") }).getByRole("list").getByRole("button")).toHaveCount(5);
});

test.describe("German", () => {
  test.use({ language: "de" });

  test("the sheet speaks German and writes the decimal comma", async ({ page }) => {
    await page.goto(MODEL);
    await expectStep(page, "loadings", "done", "de");
    await nameIn(stepSection(page, "suitability").locator("#fa-msa-table"), "Size").click();
    const dialog = sheet(page, "Size");
    await expect(dialog).toContainText(text("factor.sheet.definition", {}, "de"));
    await expect(dialog).toContainText(text("factor.sheet.status.used", {}, "de"));
    await expect(dialog).toContainText("71,684");
    await expect(dialog.getByRole("button", { name: text("factor.sheet.exclude", {}, "de") })).toBeVisible();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no serious problem with a sheet open (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openModel(page);
    await nameIn(stepSection(page, "suitability").locator("#fa-msa-table"), "Size").click();
    await expect(sheet(page, "Size").getByRole("region", { name: text("factor.sheet.closest") }).getByRole("list").getByRole("button")).toHaveCount(5);
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
    expect(serious).toEqual([]);
  });
}
