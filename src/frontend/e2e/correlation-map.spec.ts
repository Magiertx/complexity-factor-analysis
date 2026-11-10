import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  deleteSessionDatasets,
  downloaded,
  expect,
  expectStep,
  FIT_TIMEOUT,
  pattern,
  stepSection,
  test,
  text,
} from "./fixtures";

// The correlation map of the suitability step: folded and loaded only when it is opened, one cell for
// each pair of measures, read with the pointer or the arrow keys, with a table as its text, and a
// figure like the others. The model dataset has 12 measures, so every cell is an SVG rectangle; the
// log dataset has 125, drawn on a canvas, which has to be on screen within a second.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

const MODEL = "/?bundled=comfy-paper-inductive-miner&preset=published&step=suitability";
const LOG = "/log?bundled=comfy-log-pdc-training-logs&preset=standard&step=suitability";

function map(page: Page): Locator {
  return page.locator("#fa-correlation-map");
}

/** The button that folds the map or its table; anchored, as the download menu of the figure has the name of the map too. */
function foldOf(page: Page, name: string): Locator {
  return map(page).getByRole("button", { name: new RegExp("^" + pattern(name).source) });
}

/** The plot: the focusable group that holds the cells. */
function plot(page: Page, n: number): Locator {
  return map(page).getByRole("group", { name: text("factor.correlations.region", { n }) });
}

async function openModelMap(page: Page) {
  await page.goto(MODEL);
  await expectStep(page, "loadings", "done");
  await foldOf(page, text("factor.correlations.heading")).click();
  await expect(plot(page, 12)).toBeVisible();
}

/** The correlation at a row and a column of the table, as the table writes it. */
async function tableCell(page: Page, row: number, column: number): Promise<string> {
  const table = map(page).getByRole("table", { name: text("factor.correlations.table_caption", { n: 12 }) });
  return (await table.locator("tbody tr").nth(row).locator("td").nth(column).innerText()).trim();
}

test("the map is loaded when it is opened, and a pair reads like the table says", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/correlations")) requests.push(r.postData() ?? "");
  });
  await page.goto(MODEL);
  await expectStep(page, "loadings", "done");
  const fold = foldOf(page, text("factor.correlations.heading"));
  // Folded, with the number of its measures, and nothing asked for yet.
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(fold).toContainText("12");
  expect(requests).toEqual([]);

  await fold.click();
  await expect(plot(page, 12)).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0])).toMatchObject({ order: "cluster" });
  await expect(map(page).locator("[data-cells]")).toHaveAttribute("data-cells", "svg");

  // The keys: the first arrow reads the first pair, and the live region says it.
  await map(page).getByRole("button", { name: pattern(text("factor.correlations.table_heading")) }).click();
  const group = plot(page, 12);
  await group.focus();
  await page.keyboard.press("ArrowRight");
  const heard = group.getByRole("status");
  await expect(heard).toHaveText(/^.+ × .+: r = −?\d\.\d\d$/);
  const first = (await heard.innerText()).replace(/^.*r = /, "");
  expect(first).toBe(await tableCell(page, 0, 1));
  await expect(group.locator("[data-pair-tip]")).toContainText("r = " + first);
  // Down and left move one cell; the pair is the other way round, with the same r.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await expect(heard).toHaveText(new RegExp(` r = ${await tableCell(page, 1, 0)}$`));
  await page.keyboard.press("Escape");
  await expect(group.locator("[data-pair-tip]")).toHaveCount(0);

  // The pointer shows the pair under it, with a crosshair.
  const matrix = group.locator("[data-matrix]");
  const cell = Number(await matrix.getAttribute("data-cell"));
  await matrix.hover({ position: { x: cell * 3.5, y: cell * 5.5 } });
  const tip = group.locator("[data-pair-tip]");
  await expect(tip).toContainText(/ × .+: r = /);
  await expect(tip).toContainText("r = " + (await tableCell(page, 5, 3)));
  await page.mouse.move(0, 0);
  await expect(tip).toHaveCount(0);
});

test("the cells follow the sign, outline the pairs near 1 and group the measures by dimension or by cluster", async ({ page }) => {
  await openModelMap(page);
  const cells = plot(page, 12).locator("svg");
  // Slate for negative values, the data colour for positive ones.
  expect(await cells.locator('rect[style*="--negative"]').count()).toBeGreaterThan(0);
  expect(await cells.locator('rect[style*="--data"]').count()).toBeGreaterThan(0);
  // Four pairs reach 0.95, each outlined at both of its cells.
  await expect(map(page)).toContainText(text("factor.correlations.legend_high_plural", { n: 4, limit: "0.95" }));
  await expect(cells.locator('rect[fill="none"]')).toHaveCount(8);

  // By factor: the dimensions named at the right of the cells.
  const factor = map(page).getByRole("radio", { name: text("factor.correlations.order_factor") });
  await expect(factor).toHaveAttribute("aria-checked", "true");
  for (const label of ["F1", "F2", "F3", "F4", text("factor.correlations.block_none")]) {
    await expect(plot(page, 12).getByText(label, { exact: true })).toBeVisible();
  }
  // The same cells, clustered: no dimensions, and the choice is kept for the next visit.
  await map(page).getByRole("radio", { name: text("factor.correlations.order_cluster") }).click();
  await expect(plot(page, 12).getByText("F1", { exact: true })).toHaveCount(0);
  await page.reload();
  await expectStep(page, "loadings", "done");
  await foldOf(page, text("factor.correlations.heading")).click();
  await expect(map(page).getByRole("radio", { name: text("factor.correlations.order_cluster") })).toHaveAttribute("aria-checked", "true");
  await map(page).getByRole("radio", { name: text("factor.correlations.order_factor") }).click();
});

test("a measure excluded by hand leaves the map", async ({ page }) => {
  await openModelMap(page);
  const exclude = stepSection(page, "suitability").getByRole("checkbox", {
    name: text("factor.suitability.exclude_aria", { measure: "Density" }),
  });
  await exclude.check({ force: true });
  await expect(foldOf(page, text("factor.correlations.heading"))).toContainText("11");
  await expect(plot(page, 11)).toBeVisible();
  await expect(plot(page, 11).getByText("Density", { exact: true })).toHaveCount(0);
  await exclude.uncheck({ force: true });
  await expect(plot(page, 12)).toBeVisible();
});

test("the table has every value, and a measure removed by the MSA filter is marked", async ({ page }) => {
  await openModelMap(page);
  await map(page).getByRole("button", { name: pattern(text("factor.correlations.table_heading")) }).click();
  const table = map(page).getByRole("table", { name: text("factor.correlations.table_caption", { n: 12 }) });
  await expect(table.locator("tbody tr")).toHaveCount(12);
  await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(12);
  // The diagonal is 1, and the table is symmetric.
  expect(await tableCell(page, 3, 3)).toBe("1.00");
  expect(await tableCell(page, 2, 7)).toBe(await tableCell(page, 7, 2));
  // The measures the filter removed (Sequentiality, Control flow complexity) are in the map, last.
  await expect(plot(page, 12).locator('[data-tip-more="' + text("factor.correlations.removed") + '"]')).toHaveCount(4);
});

test("the figure of the map downloads like the others, with the order on screen", async ({ page }) => {
  await openModelMap(page);
  await map(page).getByRole("button", { name: text("factor.figure.download", { figure: text("factor.figure.correlations") }) }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: pattern(text("factor.figure.svg")) }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/-correlations\.svg$/);
  const svg = readFileSync(await downloaded(download), "utf8");
  expect(svg).toContain("Coefficient of network connectivity");
  expect(svg).toContain("Pearson correlations r; outlined: |r| ≥ 0.95; measures grouped by dimension");

  await map(page).getByRole("radio", { name: text("factor.correlations.order_cluster") }).click();
  await map(page).getByRole("button", { name: text("factor.figure.download", { figure: text("factor.figure.correlations") }) }).click();
  const [clustered] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: pattern(text("factor.figure.svg")) }).click(),
  ]);
  expect(readFileSync(await downloaded(clustered), "utf8")).toContain("measures clustered (average linkage on 1 − |r|)");
  await map(page).getByRole("radio", { name: text("factor.correlations.order_factor") }).click();
});

test("the map of over a hundred measures (128 with those the filter removed) is drawn on a canvas within a second", async ({ page }) => {
  test.setTimeout(FIT_TIMEOUT * 3);
  await page.goto(LOG);
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await foldOf(page, text("factor.correlations.heading")).click();
  const frame = map(page).locator("[data-cells]");
  await expect(frame).toHaveAttribute("data-cells", "canvas");
  await expect(frame).toHaveAttribute("data-measures", "128");
  // From the click to the cells on screen, the request included, and the drawing alone.
  await expect(frame).toHaveAttribute("data-render-ms", /\d/);
  const open = Number(await frame.getAttribute("data-open-ms"));
  const draw = Number(await frame.getAttribute("data-render-ms"));
  console.log(`128 x 128 map: ${open} ms from the click, ${draw} ms to draw`);
  expect(open).toBeLessThan(1000);
  expect(draw).toBeLessThan(1000);

  // The pair under the pointer, and the table, which has them all.
  const group = plot(page, 128);
  const matrix = group.locator("[data-matrix]");
  const cell = Number(await matrix.getAttribute("data-cell"));
  await matrix.hover({ position: { x: cell * 10.5, y: cell * 20.5 } });
  await expect(group.locator("[data-pair-tip]")).toContainText(/ × .+: r = /);
  await map(page).getByRole("button", { name: pattern(text("factor.correlations.table_heading")) }).click();
  const table = map(page).getByRole("table", { name: text("factor.correlations.table_caption", { n: 128 }) });
  await expect(table.locator("tbody tr")).toHaveCount(128);
  await expect(table.locator("tbody tr").first().locator("td")).toHaveCount(128);
});

test.describe("German", () => {
  test.use({ language: "de" });

  test("the map speaks German and writes the decimal comma", async ({ page }) => {
    await page.goto(MODEL);
    await expectStep(page, "loadings", "done", "de");
    await foldOf(page, text("factor.correlations.heading", {}, "de")).click();
    const group = map(page).getByRole("group", { name: text("factor.correlations.region", { n: 12 }, "de") });
    await group.focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("status")).toHaveText(/ × .+: r = −?\d,\d\d$/);
    await expect(map(page)).toContainText(text("factor.correlations.legend_high_plural", { n: 4, limit: "0,95" }, "de"));
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no serious problem with the map and its table open (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openModelMap(page);
    await map(page).getByRole("button", { name: pattern(text("factor.correlations.table_heading")) }).click();
    await plot(page, 12).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
    expect(serious).toEqual([]);
  });
}
