import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  COMPUTE_TIMEOUT,
  FIT_TIMEOUT,
  chooseSource,
  deleteSessionDatasets,
  expect,
  expectStep,
  goToStep,
  pattern,
  stepLink,
  stepSection,
  test,
  text,
} from "./fixtures";

// A model dataset of nets that several miners discovered from the same logs: all miners together
// or one at a time, as Important Factors analyses them, and the comparison of the miners. The
// nets are those of three miners of the bundled data, uploaded as a CSV with a row per log and
// miner, as the tool names the rows of a dataset it computes from logs.

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

const MINERS = ["Alpha miner", "Inductive miner", "Heuristics miner"];
const FILES: Record<string, string> = {
  "Alpha miner": "complexity_scores-alpha-miner.csv",
  "Inductive miner": "complexity_scores-inductive-miner.csv",
  "Heuristics miner": "complexity_scores-heuristics-miner.csv",
};

/** The first `logs` logs of the bundled data that every one of the three miners has, a row per log and miner. */
function threeMiners(logs: number): Buffer {
  const tables = new Map<string, Map<string, string>>();
  let header = "";
  for (const miner of MINERS) {
    const lines = readFileSync(join(__dirname, "../../AlgoService/datasets/model", FILES[miner]), "utf8").trim().split(/\r?\n/);
    header = lines[0];
    const rows = new Map<string, string>();
    for (const line of lines.slice(1)) {
      // "(log.xes,Miner)",values…
      const match = /^"\((.*),[^,]*\)",(.*)$/.exec(line);
      if (match) rows.set(match[1], match[2]);
    }
    tables.set(miner, rows);
  }
  const common = [...tables.get(MINERS[0])!.keys()].filter((log) => MINERS.every((m) => tables.get(m)!.has(log)));
  const out = [`observation${header}`];
  for (const log of common.slice(0, logs)) {
    for (const miner of MINERS) out.push(`${log} / ${miner},${tables.get(miner)!.get(log)}`);
  }
  return Buffer.from(out.join("\n") + "\n");
}

async function uploadMiners(page: Page, logs: number) {
  await page.goto("/");
  await chooseSource(page, "csv");
  const data = stepSection(page, "data");
  await data.locator('input[type="file"]').setInputFiles({ name: `miners-${logs}.csv`, mimeType: "text/csv", buffer: threeMiners(logs) });
  await data.getByRole("button", { name: text("factor.data.submit_csv") }).click();
  await expectStep(page, "dataset", "done");
}

function minerTiles(page: Page) {
  return stepSection(page, "dataset").getByRole("radiogroup", { name: text("factor.miners.label") });
}

test("a dataset of three miners is analysed per miner and the miners are compared", async ({ page }) => {
  test.setTimeout(FIT_TIMEOUT * 3);
  await uploadMiners(page, 50);
  const tiles = minerTiles(page);
  await expect(tiles.getByRole("radio")).toHaveCount(4);
  const together = tiles.getByRole("radio", { name: text("factor.miners.together") });
  await expect(together).toBeChecked();
  await expect(together).toHaveAccessibleDescription(pattern(text("factor.miners.size", { n: 150, p: 13 })));
  // Each miner has its 50 nets; within them one measure has no variance, so 12 are left, and
  // 50 rows for 12 measures are below the 5 per measure the analysis recommends.
  for (const miner of MINERS) {
    const tile = tiles.getByRole("radio", { name: miner });
    await expect(tile).toHaveAccessibleDescription(pattern(text("factor.miners.size", { n: 50, p: 12 })));
    await expect(tile).toHaveAccessibleDescription(pattern(text("factor.miners.few", { min: 60 })));
  }
  await expect(stepSection(page, "dataset")).toContainText(text("factor.miners.hint_together", { miners: 3 }));

  // One miner: the settings row names it, the analysis has its 50 rows.
  await tiles.getByRole("radio", { name: "Inductive miner" }).check({ force: true });
  const settings = page.getByRole("region", { name: text("factor.settings.aria") });
  await expect(settings.getByRole("button", { name: /^Inductive miner/ })).toBeVisible();
  await expect(stepSection(page, "dataset")).toContainText(text("factor.miners.hint_one", { miner: "Inductive miner", n: 50 }));
  const analysed = page.waitForResponse(
    (r) => r.url().endsWith("/analyze") && (r.request().postData() ?? "").includes('"miner":"Inductive miner"'),
    { timeout: FIT_TIMEOUT },
  );
  const result = await (await analysed).json();
  expect(result.n_observations).toBe(50);
  expect(result.miner.dropped).toEqual([{ measure: "Number of empty sequence flows", reason: "constant" }]);
  await goToStep(page, "suitability");
  const row = stepSection(page, "suitability").getByRole("row", { name: /Number of empty sequence flows/ });
  await expect(row).toContainText(text("factor.measures.status_miner"));

  // The fact sheet of a measure describes the rows of the miner: its 50 nets, not all 150.
  await stepSection(page, "suitability").locator("#fa-msa-table").getByRole("button", { name: "Size", exact: true }).click();
  const fact = page.getByRole("dialog", { name: "Size", exact: true });
  await expect(fact).toContainText(text("factor.sheet.values_miner", { n: 50, miner: "Inductive miner" }));
  await expect(fact.getByText("n", { exact: true }).locator("xpath=..")).toContainText("50");
  await page.keyboard.press("Escape");
  await expect(fact).toBeHidden();

  // The miner is kept with the dataset: a reload opens it with the same rows.
  await page.reload();
  await goToStep(page, "dataset");
  await expect(minerTiles(page).getByRole("radio", { name: "Inductive miner" })).toBeChecked();

  // Compare the miners: one column of the dataset per miner.
  await stepSection(page, "dataset").getByRole("link", { name: text("factor.miners.compare") }).click();
  await expect(page).toHaveURL(/\/compare\?cols=[0-9a-f-]{36}~mAlpha%20miner,[0-9a-f-]{36}~mInductive%20miner,[0-9a-f-]{36}~mHeuristics%20miner&rule=largest$/);
  const matrix = page.getByRole("table", { name: pattern(text("compare.matrix_caption", { rule: "", columns: "" }).split(":")[0]) });
  await expect(matrix).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(matrix.locator("thead").getByRole("columnheader")).toHaveText([
    text("factor.loadings.col_measure"),
    ...MINERS.map((m) => `miners-50.csv · ${m}`),
  ]);
  await expect(matrix.getByRole("row", { name: new RegExp(`^${text("compare.header.n")}\\b`) }).getByRole("cell")).toHaveText(["50", "50", "50"]);
  // A measure constant for the Alpha miner is no analysis there, but is one for the others.
  const dup = matrix.getByRole("row", { name: /^Number of duplicate tasks/ }).getByRole("cell");
  await expect(dup.first()).toHaveText(text("compare.cell.constant"));
});

test("the four sample logs mined twice offer the miners, blocked for too few nets", { tag: "@prom" }, async ({ page }) => {
  test.setTimeout(COMPUTE_TIMEOUT + 60_000);
  await page.goto("/");
  await chooseSource(page, "logs");
  const data = stepSection(page, "data");
  await data.getByRole("checkbox", { name: new RegExp(text("factor.data.sample_label")) }).check({ force: true });
  // The Inductive miner is chosen by default; the Alpha miner makes it two.
  await data.getByRole("checkbox", { name: "Alpha miner", exact: true }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_compute") }).click();
  await expectStep(page, "dataset", "done", "en", COMPUTE_TIMEOUT);
  await goToStep(page, "dataset");
  const tiles = minerTiles(page);
  for (const miner of ["Alpha miner", "Inductive miner"]) {
    const tile = tiles.getByRole("radio", { name: miner });
    await expect(tile).toHaveAttribute("aria-disabled", "true");
    await expect(tile).toHaveAccessibleDescription(pattern(text("factor.miners.blocked")));
    await expect(tiles.locator("label").filter({ hasText: miner })).toHaveAttribute(
      "aria-description",
      pattern(text("factor.miners.blocked_reason", { n: 4, p: "" }).split(" for ")[0]),
    );
  }
});

test("with four logs every miner has too few nets: its tile is blocked and says why", async ({ page }) => {
  await uploadMiners(page, 4);
  const tiles = minerTiles(page);
  for (const miner of MINERS) {
    const tile = tiles.getByRole("radio", { name: miner });
    await expect(tile).toHaveAttribute("aria-disabled", "true");
    await expect(tile).toHaveAccessibleDescription(pattern(text("factor.miners.blocked")));
    // The tooltip of the tile has the numbers.
    await expect(tiles.locator("label").filter({ hasText: miner })).toHaveAttribute(
      "aria-description",
      pattern(text("factor.miners.blocked_reason", { n: 4, p: 12 })),
    );
  }
  // A click on a blocked tile changes nothing; the comparison is blocked as well.
  await tiles.locator("label").filter({ hasText: "Alpha miner" }).click({ force: true });
  await expect(tiles.getByRole("radio", { name: text("factor.miners.together") })).toBeChecked();
  const compare = stepSection(page, "dataset").getByRole("link", { name: text("factor.miners.compare") });
  await expect(compare).toHaveAttribute("aria-disabled", "true");
  await expect(compare).toHaveAttribute("aria-description", pattern(text("factor.miners.compare_none")));
});

test("another miner clears the names of the factors, and Undo brings back both", async ({ page }) => {
  test.setTimeout(FIT_TIMEOUT + 120_000);
  await uploadMiners(page, 50);
  const tiles = minerTiles(page);
  await tiles.getByRole("radio", { name: "Inductive miner" }).check({ force: true });
  await expectStep(page, "loadings", "done", "en", FIT_TIMEOUT);
  await goToStep(page, "loadings");
  const loadings = stepSection(page, "loadings");
  await loadings.getByRole("button", { name: text("factor.loadings.look_matrix") }).click();
  await loadings
    .locator("thead")
    .first()
    .getByRole("button", { name: new RegExp(`^${text("factor.loadings.factor_n", { i: 1 })}\\b`) })
    .click();
  const field = loadings.getByRole("textbox", { name: text("factor.names.field", { i: 1 }) });
  await field.fill("Size");
  await field.press("Enter");
  await expect(stepLink(page, "loadings")).toContainText("Size");

  // The names of one miner's factors do not name the factors of another miner.
  await goToStep(page, "dataset");
  await tiles.getByRole("radio", { name: "Alpha miner" }).check({ force: true });
  const toast = page.getByRole("status").filter({ hasText: text("factor.names.cleared") });
  await expect(toast).toBeVisible({ timeout: FIT_TIMEOUT });
  await expect(stepLink(page, "loadings")).not.toContainText("Size");
  await toast.getByRole("button", { name: text("common.undo") }).click();
  await expect(tiles.getByRole("radio", { name: "Inductive miner" })).toBeChecked();
  await expect(stepLink(page, "loadings")).toContainText("Size", { timeout: FIT_TIMEOUT });
});

/** The serious and critical problems axe finds on the page, one line each. */
async function seriousProblems(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
}

for (const scheme of ["light", "dark"] as const) {
  // 50 nets per miner: every tile can be chosen, with the note on the sample size; 4 nets: every
  // tile is blocked, with its reason.
  for (const logs of [50, 4]) {
    test(`axe finds no serious problem with the miner tiles of ${logs} nets per miner (${scheme})`, async ({ page }) => {
      test.setTimeout(FIT_TIMEOUT * 2);
      await page.emulateMedia({ colorScheme: scheme });
      await uploadMiners(page, logs);
      await goToStep(page, "dataset");
      const tiles = minerTiles(page);
      await expect(tiles.getByRole("radio")).toHaveCount(4);
      if (logs === 50) {
        await tiles.getByRole("radio", { name: "Inductive miner" }).check({ force: true });
        await expect(stepSection(page, "dataset")).toContainText(text("factor.miners.hint_one", { miner: "Inductive miner", n: 50 }));
      } else {
        await expect(tiles.getByRole("radio", { name: "Alpha miner" })).toHaveAttribute("aria-disabled", "true");
      }
      await page.waitForLoadState("networkidle");
      expect(await seriousProblems(page)).toEqual([]);
    });
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no serious problem in the comparison of the miners of a dataset (${scheme})`, async ({ page }) => {
    test.setTimeout(FIT_TIMEOUT * 3);
    await page.emulateMedia({ colorScheme: scheme });
    await uploadMiners(page, 50);
    await goToStep(page, "dataset");
    await stepSection(page, "dataset").getByRole("link", { name: text("factor.miners.compare") }).click();
    await expect(page.locator("table.data-table").first()).toBeVisible({ timeout: FIT_TIMEOUT });
    await expect(page.getByRole("status").filter({ hasText: text("compare.computing") })).toHaveCount(0, { timeout: FIT_TIMEOUT });
    for (const look of ["matrix", "dimensions", "pairs"]) {
      await page.getByRole("button", { name: text(`compare.look.${look}`) }).click();
      await expect(page.locator("table.data-table").first()).toBeVisible();
      expect(await seriousProblems(page), look).toEqual([]);
    }
  });
}
