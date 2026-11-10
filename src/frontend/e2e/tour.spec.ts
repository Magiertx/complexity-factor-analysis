import { desktopAccess } from "./desktop-access";
import { expect, pattern, test as base, text } from "./fixtures";

// The welcome tour of a first visit: its language follows the browser, and a switch in the window
// sets the same choice as the language of the page. No fixture here: the tests need an empty storage.

base("a browser in en-US with an empty storage gets the tour in English", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "en-US", ...desktopAccess() });
  const page = await context.newPage();
  await page.goto("/");
  const tour = page.getByRole("dialog");
  await expect(tour).toBeVisible();
  await expect(tour.getByRole("heading")).toHaveText(text("tours.onboarding.step0_title", { app: "XCom" }, "en"), {
    timeout: 15_000,
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await context.close();
});

base("the switch in the tour sets the language of the page too", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "en-US", ...desktopAccess() });
  const page = await context.newPage();
  await page.goto("/");
  const tour = page.getByRole("dialog");
  await expect(tour).toBeVisible();
  await tour.getByRole("radiogroup", { name: text("header.locale_label", {}, "en") }).getByRole("radio", { name: "DE" }).click();
  await expect(tour.getByRole("button", { name: pattern(text("common.next", {}, "de")) })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  expect(await page.evaluate(() => localStorage.getItem("app.locale"))).toBe("de");
  // Closing the tour leaves the page in German.
  await tour.getByRole("button", { name: text("common.close", {}, "de") }).click();
  await expect(tour).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await context.close();
});
