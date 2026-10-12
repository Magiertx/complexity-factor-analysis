import type { Page } from "@playwright/test";
import {
  deleteSessionDatasets,
  expect,
  expectStep,
  freshPage,
  pattern,
  stepSection,
  test,
  text,
} from "./fixtures";

// The analyses as Important Factors published them: the paper settings with the check against
// the ComFy report, the criteria for the factor count, the assignment rules, links and "Start
// here". They need the backend of the paper settings (published_options, published_match,
// factor_count, assignment_rule, cross_loadings and the reuse of a bundled copy).

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

const INDUCTIVE = "comfy-paper-inductive-miner";

function settingsRow(page: Page, lang: "en" | "de" = "en") {
  return page.getByRole("region", { name: text("factor.settings.aria", {}, lang) });
}

function factorCount(page: Page) {
  return stepSection(page, "factors").locator("#fa-factor-count");
}

/** Opens a bundled dataset of the data step with the tool standard or the paper settings. */
async function openWith(page: Page, label: string, preset: "standard" | "published") {
  const data = stepSection(page, "data");
  await data.getByRole("radio", { name: label, exact: true }).check({ force: true });
  await data.getByRole("radio", { name: text(`factor.data.preset.${preset}`), exact: true }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_bundled") }).click();
  await expectStep(page, "loadings", "done");
}

test("the paper settings reproduce the report, and a reset to the standard can be undone", async ({ page }) => {
  await page.goto("/");
  await openWith(page, "Inductive miner", "published");

  // Tab. 11 of Important Factors: four factors, varimax, Size loads 0.9712 on the first.
  await expect(factorCount(page)).toHaveText("4");
  const row = settingsRow(page);
  const match = row.getByRole("button", { name: text("factor.match.chip_match") });
  await expect(match).toBeVisible();
  await expect(stepSection(page, "loadings").getByTitle("Size · Factor 1: 0.971", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="fa-assignment"]:checked')).toHaveValue("multi");

  // The chip says what was compared and that the groups are not.
  await match.click();
  const dialog = page.getByRole("dialog", { name: text("factor.match.title") });
  await expect(dialog).toContainText(text("factor.match.what.loadings"));
  await expect(dialog).toContainText(text("factor.match.numbers_only"));
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(match).toBeFocused();

  // Back to the standard: Kaiser's two factors, and no check, since the settings are not the paper's.
  await row.getByRole("button", { name: text("factor.settings.reset") }).click();
  await expect(factorCount(page)).toHaveText("2");
  await expect(page.locator('input[name="fa-assignment"]:checked')).toHaveValue("largest");
  await expect(row.getByRole("button", { name: text("factor.match.chip_match") })).toHaveCount(0);
  await expect(page.getByText(text("factor.settings.reset_done"))).toBeVisible();

  await page.getByRole("button", { name: text("common.undo"), exact: true }).click();
  await expect(factorCount(page)).toHaveText("4");
  await expect(row.getByRole("button", { name: text("factor.match.chip_match") })).toBeVisible();
});

test("the chips of the settings row and the match dialog work with the keyboard", async ({ page }) => {
  await page.goto("/");
  await openWith(page, "Inductive miner", "published");
  const row = settingsRow(page);
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement | null;
      return { tag: el?.tagName, type: el?.type, msa: !!el?.closest("#fa-msa-table") };
    });

  // A chip leads to its control, not to the "?" of the label above it.
  await row.getByRole("button", { name: pattern(text("factor.settings.rule.multi")) }).click();
  await expect(page.locator('input[name="fa-assignment"]:checked')).toBeFocused();
  await row.getByRole("button", { name: pattern(text("factor.settings.measures", { used: 10, total: 12 })) }).click();
  expect(await focused()).toEqual({ tag: "INPUT", type: "checkbox", msa: true });

  // Tab out of the dialog goes on after its chip and closes it, rather than to the page's top.
  const match = row.getByRole("button", { name: text("factor.match.chip_match") });
  await match.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: text("factor.match.title") });
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: text("common.close") })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("button", { name: text("factor.settings.reset") })).toBeFocused();
  // Shift+Tab from its start goes back to the chip.
  await match.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog).toHaveCount(0);
  await expect(match).toBeFocused();
});

test("a dataset the paper does not analyse names its settings after the ComFy report", async ({ page }) => {
  await page.goto("/");
  await openWith(page, "Heuristics miner", "standard");
  const factors = stepSection(page, "factors");
  // The report fits 4 factors to the 4 measures the MSA filter leaves; 3 is the most possible.
  await expect(
    factors.getByRole("radio", {
      name: `${text("factor.factors.criterion.report")}: ${text("factor.factors.criterion_count_plural", { n: 3 })}`,
    }),
  ).toBeVisible();
  await expect(factors.getByRole("radio", { name: pattern(`${text("factor.factors.criterion.paper")}:`) })).toHaveCount(0);
  const source = text("factor.paper_notes.source_report", { source: "Important Factors, ATAED 2026" });
  await expect(settingsRow(page).getByRole("button", { name: text("factor.settings.paper") })).toHaveAttribute(
    "title",
    text("factor.settings.paper_title", { source }),
  );
});

test("a criterion tile sets the number of factors", async ({ page }) => {
  await page.goto("/");
  await openWith(page, "Inductive miner", "standard");
  const factors = stepSection(page, "factors");
  const tile = (criterion: string, n: number) =>
    factors.getByRole("radio", {
      name: `${text(`factor.factors.criterion.${criterion}`)}: ${text(n === 1 ? "factor.factors.criterion_count" : "factor.factors.criterion_count_plural", { n })}`,
    });

  // Kaiser and parallel analysis both give 2 on IF Inductive; the paper chose 4 a priori.
  await expect(factorCount(page)).toHaveText("2");
  await expect(tile("kaiser", 2)).toBeChecked();
  await expect(tile("parallel", 2)).toBeVisible();
  await tile("paper", 4).check({ force: true });
  await expect(factorCount(page)).toHaveText("4");
  await expect(tile("paper", 4)).toBeChecked();
  await expect(factors).toContainText(text("factor.factors.criteria_differ_paper"));

  await tile("kaiser", 2).check({ force: true });
  await expect(factorCount(page)).toHaveText("2");
  await expect(factors).toContainText(text("factor.factors.following_suggestion"));

  // The scree plot has a table with every series as its text alternative.
  await factors.getByRole("button", { name: text("factor.factors.show_table") }).click();
  const table = factors.getByRole("table", { name: text("factor.factors.table_caption") });
  await expect(table.getByRole("columnheader", { name: text("factor.factors.col_random", { percentile: 95 }) })).toBeVisible();
});

test("the assignment rule decides what happens to cross-loaded measures", async ({ page }) => {
  await page.goto("/");
  await openWith(page, "Inductive miner", "published");
  const loadings = stepSection(page, "loadings");
  const rule = (name: string) => loadings.getByRole("radio", { name: text(`factor.loadings.rule.${name}.title`), exact: true });

  // Multiple membership (Tab. 12): average connector degree and density stand in F1 and F3,
  // with a chip on each card that names the other factor.
  await expect(rule("multi")).toBeChecked();
  await expect(loadings.getByText(pattern(text("factor.loadings.also", { i: 1 }))).first()).toBeVisible();
  await expect(loadings.getByText(pattern(text("factor.loadings.also", { i: 3 }))).first()).toBeVisible();
  // The rule also puts average connector degree in F2, which Tab. 12 does not; a note says so.
  await expect(loadings).toContainText(text("factor.paper_notes.rules.inductive_multi"));

  // Hair et al. (Tab. 17) leaves both out as cross-loaded.
  await rule("hair").check({ force: true });
  await expect(loadings).not.toContainText(text("factor.paper_notes.rules.inductive_multi"));
  await expect(loadings).toContainText(text("factor.loadings.reason.cross_loading", { factors: "F1, F3" }));
  await expect(loadings.getByText(pattern(text("factor.loadings.also", { i: 1 })))).toHaveCount(0);
  // The step rail counts the cross-loaded measures.
  await expect(page.getByRole("navigation", { name: text("factor.steps.aria") })).toContainText(
    text("factor.rail_summary.cross", { n: 2 }),
  );
});

test("a copied link opens the same analysis in a fresh browser", async ({ page, browser, baseURL }) => {
  // The clipboard of a headless browser cannot be read everywhere; the page's own write is kept.
  await page.addInitScript(() => {
    const w = window as unknown as { __copied?: string };
    navigator.clipboard.writeText = async (value: string) => {
      w.__copied = value;
    };
  });
  await page.goto("/");
  await openWith(page, "Inductive miner", "published");
  await page.locator("#fa-rotation").click();
  await page.getByRole("option", { name: text("factor.factors.rotation.promax") }).click();
  await expect(settingsRow(page).getByRole("button", { name: text("factor.match.chip_match") })).toHaveCount(0);
  await expectStep(page, "loadings", "done");

  await settingsRow(page).getByRole("button", { name: text("factor.link.copy") }).click();
  const link = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
  expect(link).toBeTruthy();
  const url = new URL(link!);
  expect(Object.fromEntries(url.searchParams)).toMatchObject({ bundled: INDUCTIVE, k: "4", rot: "promax", rule: "multi" });

  const fresh = await freshPage(browser, baseURL);
  try {
    for (let i = 0; i < 2; i++) {
      await fresh.page.goto(url.pathname + url.search);
      await expectStep(fresh.page, "loadings", "done");
      await expect(factorCount(fresh.page)).toHaveText("4");
      await expect(fresh.page.locator("#fa-rotation")).toHaveText(text("factor.factors.rotation.promax"));
      await expect(fresh.page.locator('input[name="fa-assignment"]:checked')).toHaveValue("multi");
      // The link leaves the address once it is opened.
      await expect(fresh.page).toHaveURL(/\/$/);
    }
    // Opening the link again reuses the copy of the session.
    const listed = await (await fresh.page.request.get("/api/factor-analysis/datasets?kind=model")).json();
    expect(listed.datasets.map((d: { bundled_id: string }) => d.bundled_id)).toEqual([INDUCTIVE]);

    // A link with a setting that cannot be read opens the standard and says so.
    await fresh.page.goto(`/?bundled=${INDUCTIVE}&k=many`);
    await expect(stepSection(fresh.page, "data")).toContainText(text("factor.link.invalid"));
    await expect(factorCount(fresh.page)).toHaveText("2");
  } finally {
    await deleteSessionDatasets(fresh.page);
    await fresh.context.close();
  }
});

for (const lang of ["en", "de"] as const) {
  test.describe(`Start here (${lang})`, () => {
    test.use({ language: lang });

    test("opens Important Factors with the paper settings in one click", async ({ page }) => {
      await page.goto("/");
      const data = stepSection(page, "data");
      await data.getByRole("link", { name: pattern(text("factor.start.scenario.if_inductive.title", {}, lang)) }).click();
      await expectStep(page, "loadings", "done", lang);
      await expect(factorCount(page)).toHaveText("4");
      await expect(
        settingsRow(page, lang).getByRole("button", { name: text("factor.match.chip_match", {}, lang) }),
      ).toBeVisible();
      // The card stays as it was left.
      await data.getByRole("button", { name: text("factor.data.change", {}, lang) }).click();
      const toggle = data.getByRole("button", { name: pattern(text("factor.start.title", {}, lang)) });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
      await page.reload();
      await data.getByRole("button", { name: text("factor.data.change", {}, lang) }).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    });
  });
}
