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

/** The header of a column as its text reads: the title, then the count of its notes where it has any. */
function column(title: string): RegExp {
  return new RegExp(`^${pattern(title).source}\\d*$`);
}

const FOUR = ["Alpha miner", "Directly Follows miner", "Inductive miner", "Hybrid ILP miner"];

function matrix(page: Page, lang: "en" | "de" = "en") {
  return page.getByRole("table", { name: pattern(text("compare.matrix_caption", { rule: "", columns: "" }, lang).split(":")[0]) });
}

/** The cells of a measure's row in the matrix, after its name. */
function cells(page: Page, measure: string) {
  return matrix(page).getByRole("row", { name: new RegExp("^" + pattern(measure).source) }).getByRole("cell");
}

/** The folded notes below the table, by their summary "Notes (n)". */
function notesSummary(page: Page, lang: "en" | "de" = "en") {
  const [before, after] = text("compare.notes.title", { n: "#" }, lang).split("#");
  return page.locator("summary").filter({ hasText: new RegExp(`^${pattern(before).source}\\d+${pattern(after).source}$`) });
}

/** The notes on one dataset in the folded list below the table. */
function notesOf(page: Page, column: string) {
  return page.locator("details section").filter({ has: page.getByRole("heading", { name: column, exact: true }) });
}

async function openCompare(page: Page, query = "") {
  await page.goto(`/compare${query}`);
  await expect(page.getByRole("heading", { level: 1, name: text("compare.title") })).toBeVisible();
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(page.getByRole("status").filter({ hasText: text("compare.computing") })).toHaveCount(0, { timeout: FIT_TIMEOUT });
}

/** Chooses a card of Get started in the data step and opens the comparison it names. */
async function openFromStart(page: Page, scenario: string) {
  await page.goto("/");
  const data = stepSection(page, "data");
  await data.getByRole("radio", { name: text(`factor.start.scenario.${scenario}.title`), exact: true }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_compare") }).click();
}

test("Get started opens the four miners of Tab. 17 under Hair et al., without a dataset of the session", async ({ page }) => {
  await openFromStart(page, "if_four_miners");
  await expect(page).toHaveURL(new RegExp(`/compare\\?cols=${TABLE_17.join(",")}&rule=hair$`));
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });

  const headers = matrix(page).locator("thead").getByRole("columnheader");
  await expect(headers).toHaveText([text("factor.loadings.col_measure"), ...FOUR.map(column)]);
  await expect(page.locator('input[name="cmp-rule"]:checked')).toHaveValue("hair");
  // The header of every column: n and the factors of the paper settings.
  await expect(cells(page, text("compare.header.n"))).toHaveText(["288", "288", "288", "288"]);
  await expect(cells(page, text("compare.header.factors"))).toHaveText(["4", "4", "4", "4"]);
  // sep lines up in one dimension for every miner; the cross-loaded CH of the Alpha miner is in
  // none under Hair et al. and names the dimensions of its cross-loading.
  await expect(cells(page, "Separability")).toHaveText([/^D3/, /^D3/, /^D3/, /^D3/]);
  await expect(cells(page, "Connector Heterogeneity").first()).toHaveText(/D4 · D2/);
  await expect(cells(page, "Connector Heterogeneity").first()).toContainText(text("factor.loadings.cross_cell"));
  // The one rule is in the tiles and the caption, not in a row of its own. No column failed; the
  // possible Heywood cases of three miners are notes: a count in the header of their column, which
  // opens them, and the folded list below the table.
  await expect(matrix(page).getByRole("row", { name: /^Rule\b/ })).toHaveCount(0);
  await expect(matrix(page).locator("thead").getByRole("img")).toHaveCount(0);
  const indicator = matrix(page).locator("thead").getByRole("button", { name: pattern(text("compare.notes.column_aria", { column: "Directly Follows miner", n: 2 })) });
  await indicator.click();
  await expect(page.getByRole("dialog", { name: "Directly Follows miner" })).toContainText(/Heywood/);
  await page.keyboard.press("Escape");
  await expect(indicator).toBeFocused();
  await expect(notesSummary(page)).toBeVisible();
  await notesSummary(page).click();
  await expect(notesOf(page, "Inductive miner")).toContainText(/Heywood/);
  // A group says what its number counts.
  await expect(matrix(page).locator("tr.table-group th").filter({ hasText: /^Dimension 1 · \d+ measures$/ })).toHaveCount(1);

  const datasets = await page.request.get("/api/factor-analysis/datasets");
  expect((await datasets.json()).datasets).toEqual([]);
});

test("Get started opens the Inductive miner with 4 and with 6 factors, as section 6 does", async ({ page }) => {
  await openFromStart(page, "if_k4_k6");
  await expect(page).toHaveURL(/\/compare\?cols=comfy-paper-inductive-miner,comfy-paper-inductive-miner~k6&rule=multi$/);
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });
  const second = "Inductive miner, k = 6";
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveText([text("factor.loadings.col_measure"), column("Inductive miner"), column(second)]);
  await expect(cells(page, text("compare.header.factors"))).toHaveText(["4", "6"]);
  // Only MM has its largest loading beyond the fourth factor, 0.50 on the fifth; with four
  // factors its communality is too low for any dimension.
  await expect(cells(page, "Connector Mismatch").nth(0)).toHaveText(/^h² 0\.21/);
  await expect(cells(page, "Connector Mismatch").nth(1)).toHaveText(/^D5\s*0\.50/);
  // The note on the rule is about the settings of the paper: the first column has it, the one
  // with a factor count of its own does not.
  const ruleNote = pattern(text("factor.paper_notes.rules.inductive_multi"));
  await expect(page.getByText(ruleNote)).toHaveCount(1);
  await notesSummary(page).click();
  await expect(notesOf(page, "Inductive miner").getByText(ruleNote)).toHaveCount(1);

  // The column has a tile of its own, which a comparison cannot lose below two columns.
  const tiles = page.getByRole("group", { name: text("compare.columns.label") });
  const variant = tiles.getByRole("checkbox", { name: second, exact: true });
  await expect(variant).toBeChecked();
  await expect(variant).toHaveAttribute("aria-disabled", "true");

  // Its title tells the two columns of one dataset apart in the downloads.
  const wait = page.waitForEvent("download");
  await chooseDownload(page, "compare.export.csv");
  const csv = readFileSync(await downloaded(await wait), "utf8").split(/\r?\n/);
  expect(csv[0]).toBe(`measure,code,dimension,Inductive miner,"${second}"`);

  // With a third dataset the column can go, and the link follows.
  await tiles.getByRole("checkbox", { name: "Alpha miner", exact: true }).click({ force: true });
  await expect(page).toHaveURL(/cols=comfy-paper-alpha-miner,comfy-paper-inductive-miner,comfy-paper-inductive-miner~k6&rule=multi$/);
  await variant.click({ force: true });
  await expect(variant).toHaveCount(0);
  await expect(page).toHaveURL(/cols=comfy-paper-alpha-miner,comfy-paper-inductive-miner&rule=multi$/);
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveText([text("factor.loadings.col_measure"), column("Alpha miner"), column("Inductive miner")], {
    timeout: FIT_TIMEOUT,
  });
});

test("the rule and the datasets change the comparison and its link", async ({ page }) => {
  await openCompare(page);
  const tiles = page.getByRole("group", { name: text("compare.columns.label") });

  // The rule and the datasets are in the address, which the page follows a moment later.
  // A click on the radio itself, which the corner badge of a dev server can cover at the bottom left.
  await page.getByRole("radio", { name: text("factor.loadings.rule.multi.title") }).dispatchEvent("click");
  await expect(page).toHaveURL(/rule=multi/);
  // Multiple membership: acd of the Inductive miner in three dimensions.
  await expect(cells(page, "Average connector degree").nth(2)).toHaveText(/^D2 · D1 · D4/, { timeout: FIT_TIMEOUT });

  // Alpha Dollar has the values of Alpha: the note says so.
  await tiles.getByRole("checkbox", { name: "Alpha Dollar miner", exact: true }).click({ force: true });
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveCount(6, { timeout: FIT_TIMEOUT });
  await notesSummary(page).click();
  await expect(notesOf(page, "Alpha Dollar miner")).toContainText(text("compare.same_as", { other: "Alpha miner" }));

  // Down to two datasets, and no further.
  for (const label of ["Directly Follows miner", "Inductive miner", "Hybrid ILP miner"]) {
    const tile = tiles.getByRole("checkbox", { name: label, exact: true });
    await tile.click({ force: true });
    await expect(tile).not.toBeChecked();
  }
  await expect(page).toHaveURL(/cols=comfy-paper-alpha-miner,comfy-paper-alpha-dollar-miner&rule=multi$/);
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveText([text("factor.loadings.col_measure"), column("Alpha miner"), column("Alpha Dollar miner")], {
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
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveText([text("factor.loadings.col_measure"), ...FOUR.map(column)], { timeout: FIT_TIMEOUT });
});

test("the dimensions look like Tab. 17, with the names or the short codes", async ({ page }) => {
  await openCompare(page);
  await page.getByRole("radio", { name: text("compare.look.dimensions") }).click();
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

test("a match of dimensions says which measures it rests on, and the first dataset keeps its numbers", async ({ page }) => {
  await openCompare(page);
  await page.getByRole("radio", { name: text("compare.look.dimensions") }).click();
  const table = page.getByRole("table", { name: pattern(text("compare.dimensions_caption", { rule: "Hair et al." })) });
  const row = (name: string) => table.getByRole("row", { name: new RegExp("^" + pattern(name).source) }).getByRole("cell");
  await expect(row("Alpha miner").nth(0)).toHaveAttribute("data-tip-more", text("compare.tip.kept"));
  // The factor of seq of the Hybrid ILP miner shares one measure with the dimension before it, CH.
  await expect(row("Hybrid ILP miner").nth(3)).toHaveText("Sequentiality");
  await expect(row("Hybrid ILP miner").nth(3)).toHaveAttribute("data-tip-more", /^Matched to this dimension by 1 shared measure \(Connector Heterogeneity\); congruence of the loadings 0\.\d\d\.$/);
  await expect(row("Hybrid ILP miner").nth(3)).toHaveAttribute("data-tip", text("compare.tip.factor_of", { factor: text("factor.loadings.factor_n", { i: 3 }), column: "Hybrid ILP miner" }));
});

test("the pairs of measures count the datasets in which two share a dimension, whatever the numbers", async ({ page }) => {
  await openCompare(page);
  await page.getByRole("radio", { name: text("compare.look.pairs") }).click();
  const table = page.getByRole("table", { name: pattern(text("compare.pairs.caption", { rule: "", columns: "" }).split(":")[0]) });
  await expect(table).toBeVisible();
  const codes = (await table.locator("thead th").allTextContents()).slice(1);
  expect(codes.sort()).toEqual(["CFC", "CH", "CNC", "MM", "acd", "dens", "dup", "esf", "mcd", "sep", "seq", "size", "ts"]);
  const header = (await table.locator("thead th").allTextContents()).slice(1);
  /** The cell of a pair: its row by the code of the first measure, its column by the code of the second. */
  const pair = (a: string, b: string) =>
    table.getByRole("row").filter({ has: page.getByRole("rowheader", { name: a, exact: true }) }).getByRole("cell").nth(header.indexOf(b));
  const fraction = (a: string, b: string) => pair(a, b).locator("[aria-hidden]");

  // ts and CFC: in the same dimension in both datasets that analysed both. mcd and CNC: in four
  // datasets that analysed both, together in three; the fourth leaves both out as cross-loaded.
  await expect(fraction("ts", "CFC")).toHaveText("2/2");
  await expect(fraction("CFC", "ts")).toHaveText("2/2");
  await expect(fraction("mcd", "CNC")).toHaveText("3/4");
  // Size goes with sep in the Hybrid ILP miner only.
  await expect(fraction("size", "sep")).toHaveText("1/4");
  // On the diagonal: in a dimension in how many of the datasets that analysed the measure.
  await expect(fraction("CH", "CH")).toHaveText("1/3");
  // CH is alone (section 6 of the paper): with no other measure in one dimension.
  for (const other of header.filter((c) => c !== "CH")) await expect(fraction("CH", other)).toHaveText(/^0\//);
  // The words for the screen reader and the tooltip.
  await expect(pair("ts", "CFC")).toContainText(text("compare.pairs.fraction", { together: 2, analysed: 2 }));
  await expect(pair("mcd", "CNC")).toHaveAttribute("data-tip-more", text("compare.pairs.pair_plural", { together: 3, n: 4, assigned: 3 }));

  // Another rule changes who is in a dimension, not the way the pairs are counted.
  // A click on the radio itself, which the corner badge of a dev server can cover at the bottom left.
  await page.getByRole("radio", { name: text("factor.loadings.rule.multi.title") }).dispatchEvent("click");
  await expect(page).toHaveURL(/rule=multi/);
  await expect(fraction("mcd", "CNC")).toHaveText("4/4", { timeout: FIT_TIMEOUT });
  await expect(fraction("ts", "CFC")).toHaveText("2/2");
});

test("a failed update leaves the old table dimmed and blocks the downloads until it works", async ({ page }) => {
  await openCompare(page);
  let broken = true;
  await page.route("**/api/factor-analysis/compare", (route) =>
    broken ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "The server broke." }) }) : route.continue(),
  );
  const tiles = page.getByRole("group", { name: text("compare.columns.label") });
  await tiles.getByRole("checkbox", { name: "Hybrid ILP miner", exact: true }).click({ force: true });
  await expect(page.getByRole("alert").filter({ hasText: "The server broke." })).toBeVisible();
  // The tiles show three datasets, the table four: it is dimmed, and a download would be of three.
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveCount(5);
  await expect(page.locator("section[aria-labelledby=cmp-result] .opacity-60")).toBeVisible();
  await page.getByRole("button", { name: text("factor.toolbar.export"), exact: true }).click();
  const csv = page.getByRole("menuitem", { name: pattern(text("compare.export.csv")) });
  await expect(csv).toHaveAttribute("aria-disabled", "true");
  await expect(csv).toContainText(text("compare.stale"));
  await page.keyboard.press("Escape");

  // The retry works; the table is the one of the tiles again.
  broken = false;
  await page.getByRole("button", { name: text("common.try_again") }).click();
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveCount(4, { timeout: FIT_TIMEOUT });
  await expect(page.locator("section[aria-labelledby=cmp-result] .opacity-60")).toHaveCount(0);
  await page.getByRole("button", { name: text("factor.toolbar.export"), exact: true }).click();
  await expect(page.getByRole("menuitem", { name: pattern(text("compare.export.csv")) })).not.toHaveAttribute("aria-disabled", "true");
});

test("the link says that it opens a comparison", async ({ page }) => {
  await openCompare(page);
  const link = page.getByRole("button", { name: text("factor.link.copy"), exact: true });
  await link.hover();
  await expect(link).toHaveAttribute("aria-description", new RegExp(pattern(text("compare.link_more")).source));
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
  expect([...files.keys()].sort()).toEqual(["README.txt", "co_assignment.csv", "comparison.json", "dimensions.tex", "manifest.json", "membership.csv"]);
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  expect(manifest.assignment_rule).toBe("hair");
  // What the rule applied, which the parameter (0.3) does not say.
  expect(manifest.columns[0].assignment.communality_threshold).toBe(0.5);
  // One row per pair of the 13 measures.
  expect(files.get("co_assignment.csv")!.toString("utf8").trim().split(/\r?\n/)).toHaveLength(1 + (13 * 12) / 2);
  expect(manifest.columns.map((c: { bundled_id: string }) => c.bundled_id)).toEqual(TABLE_17);
  expect(manifest.measure_labels).toBe("short_codes");
});

test("the Compare tab opens the comparison of Tab. 17, and is the one tab marked", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("navigation", { name: text("mode_bar.aria_label") });
  const tab = tabs.getByRole("link", { name: pattern(text("mode_bar.compare_label")) });
  await tab.click();
  await expect(page).toHaveURL(/\/compare$/);
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(tab).toHaveAttribute("aria-current", "page");
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
  // A tab of its own needs no way back to another one.
  await expect(page.getByRole("main").getByRole("link", { name: pattern(text("mode_bar.model_label")) })).toHaveCount(0);
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
    await expect(notesSummary(page, "de")).toBeVisible();
  });
});
