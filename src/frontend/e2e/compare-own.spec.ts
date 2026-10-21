import type { Page } from "@playwright/test";
import {
  FIT_TIMEOUT,
  deleteSessionDatasets,
  expect,
  expectStep,
  goToStep,
  pattern,
  stepSection,
  test,
  text,
} from "./fixtures";

// The comparison of the session's own analyses: two pinned solutions of one dataset, with 4 and
// with 6 factors as section 6 of Important Factors does, and datasets picked in My datasets.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

function matrix(page: Page) {
  return page.getByRole("table", { name: pattern(text("compare.matrix_caption", { rule: "", columns: "" }).split(":")[0]) });
}

function headerCells(page: Page, row: string) {
  return matrix(page).getByRole("row", { name: new RegExp(`^${row}\\b`) }).getByRole("cell");
}

test("two pinned solutions of one dataset, with 4 and 6 factors, side by side", async ({ page }) => {
  test.setTimeout(FIT_TIMEOUT * 3);
  await page.goto("/?bundled=comfy-paper-inductive-miner&preset=published&step=loadings");
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await goToStep(page, "loadings");
  const loadings = stepSection(page, "loadings");
  const pin = loadings.getByRole("button", { name: text("factor.pin.pin") });
  await pin.click();
  // Pinned: the button takes it off again; one pin is no comparison yet.
  await expect(loadings.getByRole("button", { name: text("factor.pin.unpin") })).toHaveAttribute("aria-pressed", "true");
  const compare = loadings.getByRole("link", { name: text("factor.pin.compare", { n: 1 }) });
  await expect(compare).toHaveAttribute("aria-disabled", "true");

  await goToStep(page, "factors");
  const more = stepSection(page, "factors").getByRole("button", { name: text("factor.factors.increase") });
  await more.click();
  await expect(stepSection(page, "factors").locator("#fa-factor-count")).toHaveText("5");
  await more.click();
  await expect(stepSection(page, "factors").locator("#fa-factor-count")).toHaveText("6");
  await goToStep(page, "loadings");
  await expect(loadings.getByRole("button", { name: text("factor.pin.pin") })).not.toHaveAttribute("aria-disabled", "true", {
    timeout: FIT_TIMEOUT,
  });
  await loadings.getByRole("button", { name: text("factor.pin.pin") }).click();
  await loadings.getByRole("link", { name: text("factor.pin.compare", { n: 2 }) }).click();

  await expect(page).toHaveURL(/\/compare\?cols=[0-9a-f-]{36}~k4~rvarimax,[0-9a-f-]{36}~k6~rvarimax&rule=multi$/);
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });
  const label = "Important Factors: Inductive miner";
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveText([
    text("factor.loadings.col_measure"),
    `${label} · k = 4 · ${text("factor.settings.rotation.varimax")}`,
    `${label} · k = 6 · ${text("factor.settings.rotation.varimax")}`,
  ]);
  await expect(headerCells(page, text("compare.header.factors"))).toHaveText(["4", "6"]);
  await expect(page.locator('input[name="cmp-rule"]:checked')).toHaveValue("multi");
  // The own columns are tiles that switch off; with two left none can go.
  const tiles = page.getByRole("group", { name: text("compare.columns.label") });
  await expect(tiles.getByRole("checkbox", { name: `${label} · k = 6 · ${text("factor.settings.rotation.varimax")}` })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("datasets picked in My datasets are compared side by side, each with its saved settings", async ({ page }) => {
  test.setTimeout(FIT_TIMEOUT * 2);
  for (const bundled of ["comfy-paper-alpha-miner", "comfy-paper-inductive-miner"]) {
    const r = await page.request.post("/api/factor-analysis/datasets", {
      multipart: { kind: "model", source: "bundled", bundled_id: bundled },
    });
    expect(r.ok()).toBeTruthy();
  }
  await page.goto("/");
  const data = stepSection(page, "data");
  await data.getByRole("button", { name: text("factor.data.compare_start") }).click();
  const picks = data.getByRole("group", { name: text("factor.data.compare_pick_aria") }).getByRole("checkbox");
  await expect(picks).toHaveCount(2);
  for (const pick of await picks.all()) {
    if (!(await pick.isChecked())) await pick.check({ force: true });
  }
  await data.getByRole("link", { name: text("factor.data.compare_go", { n: 2 }) }).click();
  await expect(page).toHaveURL(/\/compare\?cols=[0-9a-f-]{36},[0-9a-f-]{36}&rule=largest$/);
  await expect(matrix(page)).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(matrix(page).locator("thead").getByRole("columnheader")).toHaveCount(3);
  await expect(headerCells(page, text("compare.header.n"))).toHaveText(["288", "288"]);
  // No settings were saved with the copies: each column says it took the standard ones.
  await expect(page.getByText(text("compare.own_standard")).first()).toBeVisible();
});
