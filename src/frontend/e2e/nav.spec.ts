import type { Page } from "@playwright/test";
import { deleteSessionDatasets, expect, expectStep, openBundled, pattern, stepSection, test, text } from "./fixtures";

// The navigation is the same on every page: the four tabs of the analyses and History in the mode
// bar, the guide and the settings in the header. Exactly one entry is marked as the page.

/** Each route with the label of its entry: a tab or a link of the header. */
const ROUTES: [string, string][] = [
  ["/", "mode_bar.model_label"],
  ["/log", "mode_bar.log_label"],
  ["/compare", "mode_bar.compare_label"],
  ["/inspect", "mode_bar.inspect_label"],
  ["/runs", "mode_bar.history_label"],
  ["/guide", "header.guide_label"],
  ["/settings", "header.settings_label"],
];

function tabs(page: Page) {
  return page.getByRole("navigation", { name: text("mode_bar.aria_label") });
}

function history(page: Page) {
  return tabs(page).getByRole("link", { name: pattern(text("mode_bar.history_label")) });
}

test("every page marks exactly one entry, and History is at the same place on each", async ({ page }) => {
  let place: { right: number; y: number } | null = null;
  for (const [route, label] of ROUTES) {
    await page.goto(route);
    await expect(page.getByRole("main")).toBeVisible();
    const marked = page.locator('header [aria-current="page"], nav[aria-label] [aria-current="page"]').filter({ visible: true });
    await expect(marked, route).toHaveCount(1);
    await expect(marked, route).toHaveAccessibleName(pattern(text(label)));
    // History is always there, leads to its page, and does not move.
    await expect(history(page), route).toHaveAttribute("href", "/runs");
    // Measured from the right end of the bar, which a scrollbar of the page does not move.
    const box = (await history(page).boundingBox())!;
    const bar = (await tabs(page).boundingBox())!;
    const at = { right: Math.round(bar.x + bar.width - (box.x + box.width)), y: Math.round(box.y) };
    if (place) expect(at, route).toEqual(place);
    else place = at;
  }
});

test("the pages of the header lead back to the page of the tab visited last", async ({ page }) => {
  // Without a tab visited before, back to the model tab.
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: text("nav.back_to", { page: text("mode_bar.model_label") }) })).toHaveAttribute("href", "/");
  await page.goto("/compare");
  await page.getByRole("navigation", { name: text("header.nav_aria") }).getByRole("link", { name: text("header.guide_label") }).click();
  await expect(page).toHaveURL(/\/guide$/);
  const back = page.getByRole("link", { name: text("nav.back_to", { page: text("mode_bar.compare_label") }) });
  await expect(back).toHaveAttribute("href", /^\/compare/);
  await back.click();
  await expect(page).toHaveURL(/\/compare/);
  await expect(tabs(page).getByRole("link", { name: pattern(text("mode_bar.compare_label")) })).toHaveAttribute("aria-current", "page");
});

test("a bundled dataset opened on a tab is in the History, and opens from there", async ({ page }) => {
  await page.goto("/");
  // The settings of the first analysis are saved with the dataset.
  const saved = page.waitForResponse((r) => r.url().endsWith("/options") && r.request().method() === "PUT");
  await openBundled(page, "Alpha miner");
  await expectStep(page, "loadings", "done");
  expect((await saved).status()).toBe(204);
  await history(page).click();
  await expect(page).toHaveURL(/\/runs$/);
  const row = page.getByRole("listitem").filter({ hasText: "Important Factors: Alpha miner" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(text("mode_bar.model_label"));
  await expect(row).toContainText(text("factor.data.source.bundled"));
  await expect(row).toContainText("288 × 12");
  // The settings of its last analysis: the tool standard.
  await expect(row).toContainText(text("factor.data.preset.standard"));
  // A filter by type keeps it; another type does not.
  const types = page.getByRole("radiogroup", { name: text("run_history.filter_type_aria") });
  await types.getByRole("radio", { name: text("run_history.type.single") }).click();
  await expect(page).toHaveURL(/\/runs\?type=single$/);
  await expect(row).toHaveCount(0);
  await types.getByRole("radio", { name: text("run_history.type.model") }).click();
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: pattern(text("run_history.open_button")) }).click();
  await expect(page).toHaveURL(/\/\?step=dataset$/);
  await expectStep(page, "dataset", "done");
  await expect(stepSection(page, "dataset")).toBeVisible();
  await deleteSessionDatasets(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the header keeps one line and the tab of the page is in view", async ({ page }) => {
    await page.goto("/runs");
    const header = page.locator("header").first();
    const box = (await header.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(70);
    // Language and theme are in the settings on a phone.
    await expect(page.getByRole("button", { name: text("header.dark_mode") })).toBeHidden();
    // Not ratio 1: the sideways scrolling bar clips a fraction of a pixel of the tab with the
    // fonts of some systems, though the whole tab is on screen.
    await expect(history(page)).toBeInViewport({ ratio: 0.9 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
