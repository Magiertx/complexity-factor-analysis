import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { FIT_TIMEOUT, chooseDownload, downloaded, expect, pattern, stepSection, test, text, unzip } from "./fixtures";

// The comparison of factor structures (/compare), like Tab. 17 of Important Factors: the four
// miners under Hair et al., the rule and the datasets as choices, the two looks, the downloads,
// and the ways in from Start here and from the toolbar. It needs no dataset of the session.

const TABLE_17 = [
  "comfy-paper-alpha-miner",
  "comfy-paper-directly-follows-miner",
  "comfy-paper-inductive-miner",
  "comfy-paper-hybrid-ilp-miner",
];
const FOUR = ["Alpha miner", "Directly Follows miner", "Inductive miner", "Hybrid ILP miner"];

function matrix(page: Page, lang: "en" | "de" = "en") {
  return page.getByRole("table", { name: pattern(text("compare.matrix_caption", { rule: "", columns: "" }, lang).split(":")[0]) });
}

/** The cells of a measure's row in the matrix, after its name. */
function cells(page: Page, measure: string) {
  return matrix(page).getByRole("row", { name: new RegExp("^" + pattern(measure).source) }).getByRole("cell");
}

async function openCompare(page: Page, query = "") {
  await page.goto(`/compare${query}`);
  await expect(page.getByRole("heading", { level: 1, name: text("compare.title") })).toBeVisible();
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(page.getByRole("status").filter({ hasText: text("compare.computing") })).toHaveCount(0, { timeout: FIT_TIMEOUT });
}

test("Start here opens the four miners of Tab. 17 under Hair et al., without a dataset of the session", async ({ page }) => {
  await page.goto("/");
  await stepSection(page, "data")
    .getByRole("link", { name: pattern(text("factor.start.scenario.if_four_miners.title")) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/compare\\?cols=${TABLE_17.join(",")}&rule=hair$`));
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });

  const headers = matrix(page).locator("thead").getByRole("columnheader");
  await expect(headers).toHaveText([text("factor.loadings.col_measure"), ...FOUR]);
  await expect(page.locator('input[name="cmp-rule"]:checked')).toHaveValue("hair");
  // The header of every column: n and the factors of the paper settings.
  await expect(cells(page, text("compare.header.n"))).toHaveText(["288", "288", "288", "288"]);
  await expect(cells(page, text("compare.header.factors"))).toHaveText(["4", "4", "4", "4"]);
  // sep lines up in one dimension for every miner; the cross-loaded CH of the Alpha miner is in
  // none under Hair et al. and names the dimensions of its cross-loading.
  await expect(cells(page, "Separability")).toHaveText([/^D3/, /^D3/, /^D3/, /^D3/]);
  await expect(cells(page, "Connector Heterogeneity").first()).toHaveText(/D4 · D2/);
  await expect(cells(page, "Connector Heterogeneity").first()).toContainText(text("factor.loadings.cross_cell"));

  const datasets = await page.request.get("/api/factor-analysis/datasets");
  expect((await datasets.json()).datasets).toEqual([]);
});

test("the rule and the datasets change the comparison and its link", async ({ page }) => {
  await openCompare(page);
  const tiles = page.getByRole("group", { name: text("compare.columns.label") });

  // The rule and the datasets are in the address, which the page follows a moment later.
  await page.getByRole("radio", { name: text("factor.loadings.rule.multi.title") }).click({ force: true });
  await expect(page).toHaveURL(/rule=multi/);
  // Multiple membership: acd of the Inductive miner in three dimensions.
  await expect(cells(page, "Average connector degree").nth(2)).toHaveText(/^D2 · D1 · D4/, { timeout: FIT_TIMEOUT });

  // Alpha Dollar has the values of Alpha: the note says so.
  await tiles.getByRole("checkbox", { name: "Alpha Dollar miner", exact: true }).click({ force: true });
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveCount(6, { timeout: FIT_TIMEOUT });
  await expect(page.getByText(`Alpha Dollar miner: ${text("compare.same_as", { other: "Alpha miner" })}`)).toBeVisible();

  // Down to two datasets, and no further.
  for (const label of ["Directly Follows miner", "Inductive miner", "Hybrid ILP miner"]) {
    const tile = tiles.getByRole("checkbox", { name: label, exact: true });
    await tile.click({ force: true });
    await expect(tile).not.toBeChecked();
  }
  await expect(page).toHaveURL(/cols=comfy-paper-alpha-miner,comfy-paper-alpha-dollar-miner&rule=multi$/);
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveText([text("factor.loadings.col_measure"), "Alpha miner", "Alpha Dollar miner"], {
    timeout: FIT_TIMEOUT,
  });
  const alpha = tiles.getByRole("checkbox", { name: "Alpha miner", exact: true });
  await expect(alpha).toHaveAttribute("aria-disabled", "true");
  await alpha.click({ force: true });
  await expect(alpha).toBeChecked();
  await expect(page).toHaveURL(/cols=comfy-paper-alpha-miner,comfy-paper-alpha-dollar-miner&/);

  // Back to Tab. 17 in one click.
  await page.getByRole("button", { name: text("compare.columns.reset") }).click();
  await expect(page).toHaveURL(new RegExp(`cols=${TABLE_17.join(",")}&rule=hair$`));
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveText([text("factor.loadings.col_measure"), ...FOUR], { timeout: FIT_TIMEOUT });
});

test("the dimensions look like Tab. 17, with the names or the short codes", async ({ page }) => {
  await openCompare(page);
  await page.getByRole("button", { name: text("compare.look.dimensions") }).click();
  const table = page.getByRole("table", { name: pattern(text("compare.dimensions_caption", { rule: "Hair et al." })) });
  const inductive = table.getByRole("row", { name: /^Inductive miner/ }).getByRole("cell");
  await expect(inductive).toHaveText(["Size, Token split, Number of duplicate tasks", "Connector Heterogeneity", "Separability", "Maximum connector degree, Coefficient of network connectivity", /Connector Mismatch/]);

  await page.getByRole("button", { name: text("factor.toolbar.codes"), exact: true }).click();
  await expect(inductive).toHaveText(["size, ts, dup", "CH", "sep", "mcd, CNC", "MM, acd, dens"]);
  // The look and the codes stay for the next visit.
  await page.reload();
  await expect(table.getByRole("row", { name: /^Directly Follows miner/ }).getByRole("cell").first()).toHaveText("size, CFC, acd, dup", {
    timeout: FIT_TIMEOUT,
  });
});

test("the comparison downloads as CSV, as LaTeX like Tab. 17 and as a ZIP with a manifest", async ({ page }) => {
  await openCompare(page);
  await page.getByRole("button", { name: text("factor.toolbar.codes"), exact: true }).click();

  let wait = page.waitForEvent("download");
  await chooseDownload(page, "compare.export.csv");
  let download = await wait;
  expect(download.suggestedFilename()).toBe("factor-structures.csv");
  const csv = readFileSync(await downloaded(download), "utf8").split(/\r?\n/);
  expect(csv[0]).toBe(`measure,code,dimension,${FOUR.join(",")}`);
  expect(csv).toContain("Separability,sep,D3,D3,D3,D3,D3");

  wait = page.waitForEvent("download");
  await chooseDownload(page, "compare.export.latex");
  download = await wait;
  expect(download.suggestedFilename()).toBe("factor-structures.tex");
  const tex = readFileSync(await downloaded(download), "utf8");
  expect(tex).toContain("Inductive miner & size, ts, dup & CH & sep & mcd, CNC \\\\");

  wait = page.waitForEvent("download");
  await chooseDownload(page, "compare.export.zip");
  download = await wait;
  const files = unzip(await downloaded(download));
  expect([...files.keys()].sort()).toEqual(["README.txt", "comparison.json", "dimensions.tex", "manifest.json", "membership.csv"]);
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  expect(manifest.assignment_rule).toBe("hair");
  expect(manifest.columns.map((c: { bundled_id: string }) => c.bundled_id)).toEqual(TABLE_17);
  expect(manifest.measure_labels).toBe("short_codes");
});

test("the toolbar of Model complexity leads to the comparison", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: text("factor.toolbar.compare"), exact: true }).click();
  await expect(page).toHaveURL(/\/compare\?/);
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });
  // The page belongs to the tab of the model measures.
  await expect(page.getByRole("navigation", { name: text("mode_bar.aria_label") }).getByRole("link", { name: pattern(text("mode_bar.model_label")) })).toHaveAttribute("data-active", "true");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the matrix scrolls in its frame and the page does not", async ({ page }) => {
    await openCompare(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const frame = page.getByRole("region", { name: text("compare.matrix_label") });
    await expect(frame).toBeVisible();
    const scrolls = await frame.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(scrolls).toBe(true);
  });
});

test.describe("in German", () => {
  test.use({ language: "de" });

  test("the page, the header and the notes are German", async ({ page }) => {
    await page.goto("/compare");
    await expect(page.getByRole("heading", { level: 1, name: text("compare.title", {}, "de") })).toBeVisible();
    await expect(matrix(page, "de")).toBeVisible({ timeout: FIT_TIMEOUT });
    await expect(matrix(page, "de").getByRole("row", { name: new RegExp("^" + text("compare.header.measures", {}, "de")) }).getByRole("cell").first()).toHaveText(
      text("compare.header.measures_value", { used: 12, total: 13 }, "de"),
    );
    await expect(page.getByText(text("compare.column_notes", {}, "de"), { exact: true })).toBeVisible();
  });
});
