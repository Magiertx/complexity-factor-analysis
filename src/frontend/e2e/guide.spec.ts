import { expect, test, text } from "./fixtures";

// The guide: a table of contents beside the sections on a wide screen, a row of chips above them on a
// phone, and the section being read marked in it.

const SECTIONS = ["steps", "bundled", "own", "results", "compare", "export"];

test("the guide has one page heading, a heading per section and a named table of contents", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/guide");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveCount(SECTIONS.length);
  await expect(page.getByRole("navigation", { name: text("guide.toc") }).getByRole("link")).toHaveCount(SECTIONS.length);
  // The terms of the items are headings below the sections.
  await expect(page.getByRole("heading", { level: 3, name: text("guide.bundled.terms.choose") })).toBeVisible();
});

test("the table of contents marks the section being read and stays beside it", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/guide");
  const toc = page.getByRole("navigation", { name: text("guide.toc") });
  const here = toc.locator('[aria-current="location"]');
  await expect(here).toHaveText(text("guide.steps.title"));

  await toc.getByRole("link", { name: text("guide.compare.title") }).click();
  await expect(here).toHaveText(text("guide.compare.title"));

  // At the end of the page the last section is the one being read, and the contents are still in view.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(here).toHaveText(text("guide.export.title"));
  await expect(toc.getByRole("link", { name: text("guide.steps.title") })).toBeInViewport();
});

test("on a phone the contents are a row of chips and the page does not scroll sideways", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/guide");
  const toc = page.getByRole("navigation", { name: text("guide.toc") });
  const first = toc.getByRole("link", { name: text("guide.steps.title") });
  await expect(first).toBeVisible();
  expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  // The row is a strip of its own: the last chip lies beyond the edge, not in a wider page.
  await expect(toc.getByRole("link", { name: text("guide.export.title") })).not.toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
