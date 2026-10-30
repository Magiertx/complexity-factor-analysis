import type { Page, Request } from "@playwright/test";
import { deleteSessionDatasets, expect, expectStep, FIT_TIMEOUT, goToStep, pattern, stepSection, test, text, showMatrix } from "./fixtures";

// The long lists of the log tab (over a hundred measures): the notable ones first and the rest
// folded, searched, sorted and grouped. None of that is part of the analysis.

const LOG = "/log?bundled=comfy-log-pdc-training-logs&preset=standard&step=suitability";

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

function settingsRow(page: Page) {
  return page.getByRole("region", { name: text("factor.settings.aria") });
}

/** The link the copy button puts on the clipboard: the settings and the step on screen. */
async function copiedLink(page: Page): Promise<string> {
  await page.getByRole("button", { name: text("factor.link.copy") }).click();
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Everything that would change the analysis or what is saved with the dataset: no GET reads. */
function watchWrites(page: Page): Request[] {
  const writes: Request[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/factor-analysis/")) writes.push(r);
  });
  return writes;
}

async function choose(page: Page, section: ReturnType<typeof stepSection>, label: string, option: string) {
  await section.getByRole("button", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

test("the list of measures keeps the unremarkable ones folded until a search or a sort asks for them", async ({ page }) => {
  await page.goto(LOG);
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  const suitability = stepSection(page, "suitability");
  const rows = suitability.locator("#fa-msa-table tbody tr:not(.table-group)");
  const others = suitability.getByRole("button", { name: pattern(text("factor.measures.section_other")) });

  // Folded: the measures worth a look only, and the count of the others on the fold's own row.
  await expect(others).toHaveAttribute("aria-expanded", "false");
  const folded = await rows.count();
  expect(folded).toBeGreaterThan(0);
  expect(folded).toBeLessThan(40);

  await others.click();
  await expect(others).toHaveAttribute("aria-expanded", "true");
  expect(await rows.count()).toBeGreaterThan(100);
  await others.click();
  await expect(rows).toHaveCount(folded);

  // A search is a question about the whole list: the fold opens by itself, and has no button then.
  const search = suitability.getByRole("searchbox", { name: text("factor.measures.search") });
  await search.fill("entropy");
  await expect(others).toHaveCount(0);
  const found = await rows.allInnerTexts();
  expect(found.length).toBeGreaterThan(1);
  for (const row of found) expect(row.toLowerCase()).toContain("entropy");
  await search.fill("");
  await expect(others).toHaveAttribute("aria-expanded", "false");
  await expect(rows).toHaveCount(folded);

  // So does sorting by name or by MSA.
  await choose(page, suitability, text("factor.measures.sort_aria"), text("factor.measures.sort.msa"));
  await expect(others).toHaveCount(0);
  expect(await rows.count()).toBeGreaterThan(100);
});

test("the loadings of a long list start with the measures worth a look and fold the others, in both looks", async ({ page }) => {
  await page.goto(LOG);
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await goToStep(page, "loadings");
  await showMatrix(page);
  const loadings = stepSection(page, "loadings");
  const matrix = loadings.locator("table.data-table").first().locator("tbody tr:not(.table-group)");
  const others = loadings.getByRole("button", { name: pattern(text("factor.measures.section_other")) });
  const search = loadings.getByRole("searchbox", { name: text("factor.measures.search") });

  // Folded: the cross-loaded and the unassigned measures, and the number of the others on the fold's own row.
  await expect(others).toHaveAttribute("aria-expanded", "false");
  const folded = await matrix.count();
  expect(folded).toBeGreaterThan(0);
  expect(folded).toBeLessThan(60);
  await others.click();
  await expect(others).toHaveAttribute("aria-expanded", "true");
  expect(await matrix.count()).toBeGreaterThan(100);
  await others.click();
  await expect(matrix).toHaveCount(folded);

  // A search is a question about the whole list: the fold opens by itself and has no button then.
  await search.fill("entropy");
  await expect(others).toHaveCount(0);
  const found = await matrix.allInnerTexts();
  expect(found.length).toBeGreaterThan(1);
  for (const row of found) expect(row.toLowerCase()).toContain("entropy");
  await search.fill("");
  await expect(others).toHaveAttribute("aria-expanded", "false");

  // So does the order of the dataset: it is not the order of the factors the folded list starts with.
  await loadings.getByRole("radio", { name: text("factor.loadings.order_original") }).click();
  await expect(others).toHaveCount(0);
  expect(await matrix.count()).toBeGreaterThan(100);
  await loadings.getByRole("radio", { name: text("factor.loadings.order_factor") }).click();
  await expect(others).toHaveAttribute("aria-expanded", "false");
  await expect(matrix).toHaveCount(folded);

  // The dimensions start the same way, and one fold opens them all, the matrix's too.
  await loadings.getByRole("radio", { name: text("factor.loadings.look_dimensions") }).click();
  const members = loadings.locator("ul > li.text-xs:not(.font-medium):not([data-testid=\"short-set\"] li)");
  await expect(others.first()).toHaveAttribute("aria-expanded", "false");
  const cards = await others.count();
  expect(cards).toBeGreaterThan(1);
  const listed = await members.count();
  await others.first().click();
  for (let i = 0; i < cards; i++) await expect(others.nth(i)).toHaveAttribute("aria-expanded", "true");
  expect(await members.count()).toBeGreaterThan(listed + 50);
  await others.first().click();
  await expect(members).toHaveCount(listed);
  // A search leaves out the cards without a match.
  await search.fill("entropy");
  await expect(others).toHaveCount(0);
  for (const member of await members.allInnerTexts()) expect(member.toLowerCase()).toContain("entropy");
});

test("a short list of loadings is shown in full, without a fold", async ({ page }) => {
  await page.goto("/?bundled=comfy-paper-inductive-miner&preset=published");
  await expectStep(page, "loadings", "done");
  await goToStep(page, "loadings");
  await showMatrix(page);
  const loadings = stepSection(page, "loadings");
  await expect(loadings.getByRole("button", { name: pattern(text("factor.measures.section_other")) })).toHaveCount(0);
  await expect(loadings.getByRole("searchbox", { name: text("factor.measures.search") })).toHaveCount(0);
  expect(await loadings.locator("table.data-table").first().locator("tbody tr").count()).toBeGreaterThan(5);
});

test("a search, a sort, a grouping and the notable filter change only what the lists show", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // The settings of a dataset just opened are saved with it once, a second after its first analysis.
  const saved = page.waitForResponse((r) => r.request().method() === "PUT" && r.url().endsWith("/options"));
  await page.goto(LOG);
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await saved;
  const suitability = stepSection(page, "suitability");
  const before = { row: await settingsRow(page).innerText(), link: await copiedLink(page) };

  const writes = watchWrites(page);
  await suitability.getByRole("searchbox", { name: text("factor.measures.search") }).fill("dfg");
  await choose(page, suitability, text("factor.measures.sort_aria"), text("factor.measures.sort.name"));
  await choose(page, suitability, text("factor.measures.group_aria"), text("factor.measures.grouping.group"));
  await suitability.getByRole("switch", { name: pattern(text("factor.measures.only_notable", { n: "" }).split("(")[0].trim()) }).click();
  // The loadings have a search, a filter and a fold of their own.
  await goToStep(page, "loadings");
  const loadings = stepSection(page, "loadings");
  const matrix = loadings.locator("table.data-table").first().locator("tbody tr:not(.table-group)");
  const folded = await matrix.count();
  await loadings.getByRole("searchbox", { name: text("factor.measures.search") }).fill("entropy");
  await expect.poll(async () => (await matrix.allInnerTexts()).every((row) => row.toLowerCase().includes("entropy"))).toBe(true);
  await loadings.getByRole("searchbox", { name: text("factor.measures.search") }).fill("");
  await expect(matrix).toHaveCount(folded);
  await loadings.getByRole("switch", { name: pattern(text("factor.loadings.only_notable", { n: "" }).split("(")[0].trim()) }).click();
  // The notable measures are what stays of the folded list; nothing is left to fold.
  await expect(matrix).toHaveCount(folded);
  await expect(loadings.getByRole("button", { name: pattern(text("factor.measures.section_other")) })).toHaveCount(0);
  // The analysis would be asked for within 300 ms of a change of its settings.
  await page.waitForTimeout(1500);

  expect(writes.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
  expect(await settingsRow(page).innerText()).toBe(before.row);
  expect(await copiedLink(page)).toBe(before.link.replace("step=suitability", "step=loadings"));
});

test("ticking a measure in a sorted list adds it at the end and keeps the order of the columns", async ({ page }) => {
  // Two fits: the list as it comes, and without the measure ticked.
  test.slow();
  const analyses: { used_measures: string[] }[] = [];
  const bodies: { excluded?: string[] }[] = [];
  page.on("response", async (r) => {
    const request = r.request();
    if (request.method() === "POST" && r.url().endsWith("/analyze")) {
      bodies.push(request.postDataJSON());
      analyses.push(await r.json());
    }
  });
  await page.goto(LOG);
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await expect.poll(() => analyses.length).toBeGreaterThan(0);
  const suitability = stepSection(page, "suitability");

  // The list sorted by name is not the order of the dataset's columns, on which the analysis depends.
  await choose(page, suitability, text("factor.measures.sort_aria"), text("factor.measures.sort.name"));
  await suitability.getByRole("searchbox", { name: text("factor.measures.search") }).fill("n_events");
  const seen = analyses.length;
  await suitability.getByRole("checkbox", { name: text("factor.suitability.exclude_aria", { measure: "n_events" }), exact: true }).check({ force: true });
  await expect.poll(() => analyses.length, { timeout: FIT_TIMEOUT }).toBeGreaterThan(seen);
  expect(bodies.at(-1)?.excluded).toEqual(["n_events"]);

  const [summary] = (await (await page.request.get("/api/factor-analysis/datasets?kind=log")).json()).datasets;
  const dataset = await (await page.request.get(`/api/factor-analysis/datasets/${summary.id}?rows=1`)).json();
  const place = new Map<string, number>(dataset.measures.map((m: string, i: number) => [m, i]));
  for (const analysis of analyses) {
    const places = analysis.used_measures.map((m) => place.get(m)!);
    expect(places.every((p) => p !== undefined)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
  }
  expect(analyses.at(-1)!.used_measures).not.toContain("n_events");
});

test.describe("on a phone, in german", () => {
  test.use({ language: "de", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the list of measures fits the width without scrolling sideways, and a row of a notable measure is short", async ({ page }) => {
    await page.goto(LOG);
    await expectStep(page, "loadings", "done", "de", FIT_TIMEOUT);
    const list = stepSection(page, "suitability").locator("#fa-msa-table");
    const frame = list.locator(".table-frame");
    await expect(frame).toBeVisible();
    expect(await frame.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    // A status of a word or two, not the sentence of a wide screen: no row grows beyond two lines.
    const heights = await list.locator("tbody tr:not(.table-group)").evaluateAll((rows) => rows.map((r) => r.getBoundingClientRect().height));
    expect(Math.max(...heights)).toBeLessThan(60);
  });
});
