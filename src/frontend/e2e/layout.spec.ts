import { expect, pattern, stepSection, test, text } from "./fixtures";

// The navigation without description lines, the keyboard, the 404 page, the language of a first
// visit and the view of the loadings in the address (docs/UI.md).

const LOADINGS = "/?bundled=comfy-paper-inductive-miner&preset=published&step=loadings";

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("all five entries of the nav are in view, the tools as icons with a name", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: text("mode_bar.aria_label") });
    for (const key of ["model", "log", "inspect", "compare", "history"]) {
      const link = nav.getByRole("link", { name: pattern(text(`mode_bar.${key}_label`)) });
      await expect(link).toBeInViewport({ ratio: 0.9 });
    }
    // The line under a tab is gone: what a tab is for is its tooltip.
    await expect(nav).not.toContainText(text("mode_bar.model_desc"));
    // The tools have no visible label here, but a name.
    await expect(nav.getByRole("link", { name: text("mode_bar.compare_label"), exact: true })).toHaveAttribute(
      "aria-label",
      text("mode_bar.compare_label"),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test("the first stop of the keyboard is the link to the content", async ({ page }) => {
  await page.goto("/guide");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: text("common.skip_to_content") });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("a Segmented control is a radiogroup that arrow keys move", async ({ page }) => {
  await page.goto("/settings");
  const group = page.getByRole("radiogroup").first();
  const options = group.getByRole("radio");
  const checked = group.getByRole("radio", { checked: true });
  await expect(checked).toHaveCount(1);
  // One tab stop: only the chosen option is reached with Tab.
  expect(await options.evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex === 0).length)).toBe(1);
  const before = await checked.innerText();
  await checked.focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { checked: true })).not.toHaveText(before);
  await expect(group.getByRole("radio", { checked: true })).toBeFocused();
});

test("an unknown address shows a page in the language of the UI with a way to the start", async ({ page }) => {
  await page.goto("/there-is-nothing-here");
  await expect(page.getByRole("heading", { level: 1, name: text("not_found.title") })).toBeVisible();
  await page.getByRole("link", { name: text("not_found.home") }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the loadings open on the dimensions; the matrix is one click away and in the address", async ({ page }) => {
  await page.goto(LOADINGS);
  const loadings = stepSection(page, "loadings");
  const dimensions = loadings.getByRole("radio", { name: text("factor.loadings.look_dimensions") });
  const matrix = loadings.getByRole("radio", { name: text("factor.loadings.look_matrix") });
  await expect(dimensions).toBeChecked({ timeout: 90_000 });
  expect(new URL(page.url()).searchParams.has("view")).toBe(false);
  await matrix.click();
  await expect(matrix).toBeChecked();
  expect(new URL(page.url()).searchParams.get("view")).toBe("matrix");
  // A link with the view opens the matrix, and the arrow keys go back to the dimensions.
  await page.goto(`${LOADINGS}&view=matrix`);
  await expect(loadings.getByRole("radio", { name: text("factor.loadings.look_matrix") })).toBeChecked({ timeout: 90_000 });
  await loadings.getByRole("radio", { name: text("factor.loadings.look_matrix") }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(dimensions).toBeChecked();
  expect(new URL(page.url()).searchParams.has("view")).toBe(false);
});

test("a factor without a name is labelled with the measure that loads highest", async ({ page }) => {
  await page.goto(LOADINGS);
  const loadings = stepSection(page, "loadings");
  const first = loadings.getByRole("button", { name: pattern(text("factor.loadings.factor_n", { i: 1 })) }).first();
  await expect(first).toContainText("·", { timeout: 90_000 });
});

test("a first visit follows the language of the browser", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "de-DE" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    try {
      localStorage.setItem("app.onboarding-completed", "1");
    } catch {
      /* storage blocked */
    }
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByRole("link", { name: pattern(text("mode_bar.model_label", {}, "de")) })).toBeVisible();
  await context.close();
});
