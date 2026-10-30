import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { COMPUTE_TIMEOUT, downloaded, expect, pattern, test, text, unzip } from "./fixtures";

// The page for a single log (/inspect): three sections instead of a list with one algorithm, one
// description of ComFy instead of three, and everything the page did before: the example logs and
// the recent uploads, the overview of the log, presets, Ctrl+Enter, the result with its nets in a
// lightbox, the notes of a run and the ZIP.

test.afterEach(async ({ page }) => {
  expect((await page.request.delete("/api/jobs")).ok()).toBeTruthy();
});

async function chooseExample(page: Page) {
  await page
    .getByRole("radiogroup", { name: text("workbench.log_source.aria") })
    .getByRole("radio", { name: text("workbench.log_source.use_sample") })
    .click();
  await page.getByRole("radiogroup", { name: text("workbench.samples.label") }).getByRole("radio").first().check({ force: true });
}

test("the page has three sections and no list of algorithms", async ({ page }) => {
  await page.goto("/inspect");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(text("inspect.title"));
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([
    text("inspect.section_log"),
    text("inspect.section_settings"),
    text("inspect.section_run"),
  ]);
  for (const name of [text("inspect.section_log"), text("inspect.section_settings"), text("inspect.section_run")]) {
    await expect(page.getByRole("region", { name })).toBeVisible();
  }
  // The side list with its one entry is gone, with the buttons that folded it.
  await expect(page.getByLabel("Algorithms", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /algorithm list/i })).toHaveCount(0);
  // ComFy is described once, in the sentence under the title; its description from the server stays
  // out of the page, which has the explanation behind the icon in the header.
  const algorithm = (await (await page.request.get("/api/algorithms")).json()).algorithms[0];
  await expect(page.getByText(algorithm.description, { exact: true })).toHaveCount(0);
  await expect(page.getByText(text("inspect.subtitle"))).toHaveCount(1);
});

test("the tools of the header: what ComFy does, its paper and citation, and the tour", async ({ page }) => {
  await page.goto("/inspect");
  const about = page.getByRole("button", { name: text("inspect.about_menu", { name: "ComFy" }) });
  await about.click();
  await expect(page.getByRole("menuitem", { name: pattern(text("inspect.about")) })).toBeVisible();
  const paper = page.getByRole("menuitem", { name: pattern(text("workbench.algo_card.paper_link")) });
  await expect(paper).toHaveAttribute("href", /^https:\/\//);
  await expect(paper).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("menuitem", { name: pattern(text("workbench.algo_card.copy_bibtex")) })).toBeVisible();
  // The long explanation of what ComFy does opens as a dialog.
  await page.getByRole("menuitem", { name: pattern(text("inspect.about")) }).click();
  const explanation = page.getByRole("dialog", { name: /ComFy/ });
  await expect(explanation).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(explanation).toHaveCount(0);

  // The tour names the three sections.
  await page.getByRole("button", { name: text("inspect.tour") }).click();
  const tour = page.getByTestId("floater");
  await expect(tour.getByRole("heading", { name: text("tours.single_run.intro_title") })).toBeVisible();
  await expect(tour).toContainText("three sections");
});

test("an example log shows its overview, the presets stay, and Ctrl+Enter starts the run", async ({ page }) => {
  await page.goto("/inspect");
  const run = page.getByRole("button", { name: text("common.run_analysis") });
  await expect(run).toBeDisabled();
  await chooseExample(page);
  await expect(run).toBeEnabled();
  await expect(page.getByRole("button", { name: pattern(text("preset_bar.save_preset")) })).toBeVisible();
  // The overview of the log: its traces and events.
  await expect(page.getByText(/^6\s*traces$/)).toBeVisible();
  await expect(page.getByText(/^30\s*events$/)).toBeVisible();

  // Ctrl+Enter anywhere on the page starts the run, which then has its address.
  await page.locator("h1").click();
  await page.keyboard.press("Control+Enter");
  await expect(page).toHaveURL(/\/inspect\?job=[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { level: 2, name: text("inspect.section_log") })).toBeVisible();
  // The log of that run, with a note field, instead of the choice of a log.
  await expect(page.getByText(text("workbench.algo_card.analyzed_log"))).toBeVisible();
});

test("a run with ProM gives the result with nets in a lightbox, notes and the ZIP", { tag: "@prom" }, async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT);
  await page.goto("/inspect");
  await chooseExample(page);
  await page.getByRole("button", { name: text("common.run_analysis") }).click();
  const result = page.getByRole("heading", { level: 2, name: text("result_panel.heading") });
  await expect(result).toBeVisible({ timeout: COMPUTE_TIMEOUT });

  // A net in a lightbox with its zoom, closed with Escape.
  // The net of the miner, and the same net as a PNG with 300 dpi.
  await expect(page.getByRole("heading", { name: /^Petri net \(Directly Follows miner\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^High-resolution PNG/ })).toBeVisible();
  await page.locator("figure div.cursor-zoom-in").first().click({ force: true });
  await expect(page.getByTitle(text("artifacts.image.zoom_in_title"))).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTitle(text("artifacts.image.zoom_in_title"))).toHaveCount(0);

  // Notes of the run stay with it.
  await page.getByRole("button", { name: pattern(text("job_notes.add_note_button")) }).click();
  await page.getByRole("textbox").last().fill("Example log, the Directly Follows miner");
  await page.getByRole("button", { name: text("common.save"), exact: true }).click();
  await expect(page.getByText("Example log, the Directly Follows miner")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Example log, the Directly Follows miner")).toBeVisible();

  // The ZIP of the run.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: text("result_panel.download_all") }).click(),
  ]);
  const files = unzip(await downloaded(download));
  expect(files.size).toBeGreaterThan(0);
  expect(readFileSync(await downloaded(download)).length).toBeGreaterThan(100);
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no serious problem with a log chosen and the tools open (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/inspect");
    await chooseExample(page);
    await expect(page.getByText(/^6\s*traces$/)).toBeVisible();
    await page.getByRole("button", { name: text("inspect.about_menu", { name: "ComFy" }) }).click();
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
    expect(serious).toEqual([]);
  });
}
