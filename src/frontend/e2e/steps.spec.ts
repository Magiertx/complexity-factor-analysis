import type { Page } from "@playwright/test";
import {
  deleteSessionDatasets,
  expect,
  expectStep,
  goToStep,
  openBundled,
  pattern,
  stepLink,
  stepSection,
  test,
  text,
} from "./fixtures";

// One step on screen at a time: the step rail, Back and Next, the address (?step=...), the
// browser's history, the old anchors of the one-page layout, the toolbar and the tooltip.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

function toolbar(page: Page) {
  return page.getByRole("group", { name: text("factor.toolbar.aria") });
}

test("each step is a view of its own, with an address, Back and Next, and the browser's history", async ({ page }) => {
  await page.goto("/");
  // Before a dataset the later steps are listed but locked, with the reason in their tooltip.
  const locked = stepLink(page, "suitability");
  await expect(locked).toHaveAttribute("aria-disabled", "true");
  await expect(locked).toHaveAttribute("aria-description", pattern(text("factor.nav.locked.no_dataset")));
  await expect(stepSection(page, "data")).toBeVisible();
  await expect(stepSection(page, "suitability")).toHaveCount(0);

  // Use dataset opens the dataset step, with its heading focused and an address of its own.
  await openBundled(page, "Inductive miner");
  await expect(page).toHaveURL(/\/\?step=dataset$/);
  await expect(page.locator("#fa-step-dataset-title")).toBeFocused();
  await expect(stepSection(page, "data")).toBeHidden();

  // Next and Back at the end of the step.
  const next = (step: string) => page.getByRole("button", { name: text("factor.nav.next_to", { step: text(`factor.steps.${step}`) }) });
  const back = (step: string) => page.getByRole("button", { name: text("factor.nav.back_to", { step: text(`factor.steps.${step}`) }) });
  await next("suitability").click();
  await expect(page).toHaveURL(/\?step=suitability$/);
  await expect(page.locator("#fa-step-suitability-title")).toBeFocused();
  await expect(stepLink(page, "suitability")).toHaveAttribute("aria-current", "step");
  await back("dataset").click();
  await expect(page).toHaveURL(/\?step=dataset$/);

  // The rail.
  await goToStep(page, "loadings");
  await expect(page).toHaveURL(/\?step=loadings$/);

  // The browser's back and forward move between the steps.
  await page.goBack();
  await expect(page).toHaveURL(/\?step=dataset$/);
  await expect(stepSection(page, "dataset")).toBeVisible();
  await expect(stepLink(page, "dataset")).toHaveAttribute("aria-current", "step");
  await page.goBack();
  await expect(page).toHaveURL(/\?step=suitability$/);
  await expect(stepSection(page, "suitability")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\?step=dataset$/);
  await expect(stepSection(page, "dataset")).toBeVisible();

  // An address with a step opens it, with the dataset remembered.
  await page.goto("/?step=factors");
  await expect(stepSection(page, "factors").locator("#fa-factor-count")).toHaveText("2");
  // An anchor of the one-page layout before opens its step.
  await page.goto("/#fa-step-loadings");
  await expect(page).toHaveURL(/\/\?step=loadings$/);
  await expect(stepSection(page, "loadings")).toBeVisible();

  // The last step to be had has Back but no Next: the interpretation, or the loadings where the
  // server can give none.
  if ((await stepLink(page, "interpretation").getAttribute("aria-disabled")) === "true") {
    await goToStep(page, "loadings");
    await expect(back("factors")).toBeVisible();
  } else {
    await goToStep(page, "interpretation");
    await expect(back("loadings")).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /^Next:/ })).toHaveCount(0);
});

/** Starts the tour from its icon at the end of the toolbar. */
async function startTour(page: Page) {
  await toolbar(page).getByRole("button", { name: text("factor.tour_button"), exact: true }).click();
}

test("the tour opens the step of each stop", async ({ page }) => {
  await page.goto("/");
  await openBundled(page, "Inductive miner");
  await startTour(page);
  const next = page.getByRole("button", { name: /^Next \(\d+ of \d+\)$/ });
  await next.click();
  await expect(stepSection(page, "data")).toBeVisible();
  await next.click();
  await expect(page).toHaveURL(/\?step=dataset$/);
  await next.click();
  await expect(page).toHaveURL(/\?step=suitability$/);
  await expect(stepSection(page, "suitability")).toBeVisible();
  await page.keyboard.press("Escape");
});

test("the tour keeps its spotlight below the settings row and ends on the step it began on", async ({ page }) => {
  await page.goto("/");
  await openBundled(page, "Inductive miner");
  await goToStep(page, "loadings");
  await startTour(page);
  const next = page.getByRole("button", { name: /^Next \(\d+ of \d+\)$/ });
  await next.click();
  await next.click();
  await expect(page).toHaveURL(/\?step=dataset$/);
  // The heading the tour points at is not under the row that sticks to the top of the window.
  const row = page.getByRole("region", { name: text("factor.settings.aria") });
  await expect
    .poll(async () => {
      const heading = await page.locator('[data-tour="fa-dataset"]').boundingBox();
      const covering = await row.boundingBox();
      return heading!.y - (covering!.y + covering!.height);
    })
    .toBeGreaterThanOrEqual(-1);
  await page.keyboard.press("Escape");
  // Back where it began, not on the stop it was left at.
  await expect(page).toHaveURL(/\?step=loadings$/);
  await expect(stepSection(page, "loadings")).toBeVisible();
});

test("an interpretation the server cannot give is unavailable with its reason, and no Next leads into it", async ({ page }) => {
  const status = await (await page.request.get("/api/factor-analysis/interpretation/status")).json();
  test.skip(status.available || status.precomputed_only, "the server has a key or stored interpretations");
  await page.goto("/");
  await openBundled(page, "Inductive miner");
  await expectStep(page, "loadings", "done");
  const link = stepLink(page, "interpretation");
  // Not a dead end to walk into: the list of steps says why, with a key instead of a lock.
  await expect(link).toHaveAttribute("aria-disabled", "true");
  await expect(link).toHaveAttribute("aria-description", pattern(text("factor.interpretation.unavailable_key")));
  await expect(link).toContainText(text("factor.interpretation.unavailable_key"));
  await expect(link).toHaveAccessibleName(pattern(`(${text("factor.state.unavailable")})`));
  await expect(link.locator("svg.lucide-key-round")).toBeVisible();
  await expect(link.locator("svg.lucide-lock")).toHaveCount(0);
  // The loadings are the last step to go to.
  await goToStep(page, "loadings");
  await expect(page.getByRole("button", { name: /^Next:/ })).toHaveCount(0);
});

test("the toolbar has the tools of the analysis only, and says why a download waits", async ({ page }) => {
  await page.goto("/");
  // Without a dataset the downloads are listed with the reason.
  await toolbar(page).getByRole("button", { name: text("factor.toolbar.export") }).click();
  const zip = page.getByRole("menuitem", { name: pattern(text("factor.toolbar.export_zip")) });
  await expect(zip).toHaveAttribute("aria-disabled", "true");
  await expect(zip).toContainText(text("factor.nav.locked.no_dataset"));
  await page.keyboard.press("Escape");
  await expect(zip).toHaveCount(0);

  // The ways to other pages are the tabs and the header, not icons of the toolbar.
  await expect(toolbar(page).getByRole("link")).toHaveCount(0);
  for (const gone of ["factor.start.title", "factor.data.source.mine", "factor.toolbar.guide"]) {
    await expect(toolbar(page).getByRole("button", { name: text(gone), exact: true })).toHaveCount(0);
  }
  await expect(toolbar(page).getByRole("button")).toHaveCount(4);
});

test("the data step has Start here first and the datasets of the session as a source", async ({ page }) => {
  await page.goto("/");
  await openBundled(page, "Inductive miner");
  await goToStep(page, "data");
  const data = stepSection(page, "data");
  // With a dataset open, Start here stays above it.
  await expect(data.getByRole("button", { name: pattern(text("factor.start.title")) })).toBeVisible();
  await data.getByRole("button", { name: text("factor.data.change") }).click();
  const mine = data.getByRole("radiogroup", { name: text("factor.data.source.mine") });
  await expect(mine).toBeVisible();
  await expect(mine.getByRole("radio", { name: "Important Factors: Inductive miner" })).toBeVisible();
});

test("an icon names itself in a tooltip, and explains itself after a while", async ({ page }) => {
  await page.goto("/");
  const tour = toolbar(page).getByRole("button", { name: text("factor.tour_button"), exact: true });
  await expect(tour).toHaveAttribute("aria-description", text("factor.tour_title"));
  await tour.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toContainText(text("factor.tour_button"));
  await expect(tip).not.toHaveClass(/tip--stage2/);
  // The explanation joins the name in the same box, 2 s after the pointer arrived.
  await expect(tip).toHaveClass(/tip--stage2/, { timeout: 4000 });
  await expect(tip).toContainText(text("factor.tour_title"));
  await page.keyboard.press("Escape");
  await expect(tip).toHaveCount(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the row of steps fits, and Back and Next stay at the bottom", async ({ page }) => {
    await page.goto("/");
    await openBundled(page, "Inductive miner");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const steps = page.getByRole("navigation", { name: text("factor.steps.aria") });
    await expect(steps.getByRole("link", { name: pattern(text("factor.steps.dataset")) })).toHaveAttribute(
      "aria-current",
      "step",
    );
    const bar = page.getByRole("navigation", { name: text("factor.nav.aria") });
    await bar.getByRole("button", { name: text("factor.nav.next") }).click();
    await expect(page).toHaveURL(/\?step=suitability$/);
    await expect(bar).toContainText(text("factor.nav.position", { n: 3, total: 6 }));
    // Fixed at the bottom of the window while the step scrolls above it.
    await page.mouse.wheel(0, 1500);
    const box = await bar.boundingBox();
    expect(Math.round(box!.y + box!.height)).toBe(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await bar.getByRole("button", { name: text("factor.nav.back") }).click();
    await expect(page).toHaveURL(/\?step=dataset$/);
  });

  test("the bar of steps is in view when a step opens, without the page's own sentence before it", async ({ page }) => {
    await page.goto("/");
    // The data step keeps the sentence on what the page is for; a step with a dataset has no room for it.
    await expect(page.getByText(text("factor.model.subtitle"))).toBeVisible();
    await openBundled(page, "Inductive miner");
    await expect(page.getByText(text("factor.model.subtitle"))).toBeHidden();
    const steps = page.getByRole("navigation", { name: text("factor.steps.aria") });
    // Where the bar already shows, the page does not move; from further down, a step opened by
    // Next brings it back into view.
    const inView = async () => {
      const y = Math.round((await steps.boundingBox())!.y);
      return y >= 0 && y <= 844 - 96;
    };
    await expect.poll(inView).toBe(true);
    await page.mouse.wheel(0, 700);
    await page.getByRole("navigation", { name: text("factor.nav.aria") }).getByRole("button", { name: text("factor.nav.next") }).click();
    await expect(page).toHaveURL(/\?step=suitability$/);
    await expect.poll(inView).toBe(true);
  });

  test("the bottom bar says why Next waits", async ({ page }) => {
    await page.goto("/");
    const bar = page.getByRole("navigation", { name: text("factor.nav.aria") });
    await expect(bar).toContainText(text("factor.nav.locked.no_dataset"));
    await expect(bar).not.toContainText(text("factor.nav.position", { n: 1, total: 6 }));
    await expect(bar.getByRole("button", { name: text("factor.nav.next") })).toHaveAttribute("aria-disabled", "true");
  });
});
