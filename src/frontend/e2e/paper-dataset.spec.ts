import {
  deleteSessionDatasets,
  downloaded,
  expect,
  expectStep,
  openBundled,
  pattern,
  stepLink,
  stepSection,
  test,
  text,
  unzip,
} from "./fixtures";

test.afterEach(async ({ page }) => deleteSessionDatasets(page));

test("IF Inductive goes through all six steps and exports the analysis as ZIP", async ({ page }) => {
  await page.goto("/");
  await expectStep(page, "data", "active");
  await expectStep(page, "suitability", "locked");

  await openBundled(page, "Inductive miner");
  for (const step of ["data", "dataset", "suitability", "loadings"]) {
    await expectStep(page, step, "done");
  }
  // Kaiser's two factors leave a measure at the bound of the fit (a possible Heywood case),
  // which step 4 points out.
  await expectStep(page, "factors", "done|warn");
  // Step 6 is reached: it asks for Claude (with an API key on the server), shows a
  // precomputed interpretation, or says that the key is missing. It is never "not available
  // yet" once the analysis is there. The test never asks Claude.
  await expect(stepLink(page, "interpretation")).not.toHaveAccessibleName(pattern(`(${text("factor.state.locked")})`));
  const interpretation = stepSection(page, "interpretation");
  await expect(interpretation.getByRole("button", { name: text("factor.interpretation.button") }).or(
    interpretation.getByText(text("factor.interpretation.precomputed"), { exact: true }),
  ).first()).toBeVisible();

  // Step 2: 288 logs, 12 of the 13 measures (one is constant).
  const dataset = stepSection(page, "dataset");
  await expect(dataset).toContainText("288");
  await expect(dataset).toContainText(text("factor.dataset.reason.constant"));

  // Step 3: the numbers of ComFy's report, KMO 0.7467 and chi-square 6822.44.
  const suitability = stepSection(page, "suitability");
  await expect(suitability).toContainText("0.75");
  await expect(suitability).toContainText("6,822.4");
  await expect(suitability).toContainText(text("factor.suitability.removed_heading_plural", { n: 2 }));

  // Step 4: Kaiser suggests 2 factors.
  const factors = stepSection(page, "factors");
  await expect(factors.locator("output")).toHaveText("2");
  await expect(factors).toContainText(text("factor.factors.following_suggestion"));

  // Step 5: the ZIP holds the result and a manifest with the parameters and the provenance.
  const loadings = stepSection(page, "loadings");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    loadings.getByRole("button", { name: text("factor.loadings.export_zip") }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("ComFy-paper-scores-Inductive-miner-factor-analysis.zip");
  const files = unzip(await downloaded(download));
  for (const name of ["manifest.json", "README.txt", "analysis.json", "dataset.csv", "loadings.csv", "msa.csv"]) {
    expect(files.has(name), name).toBeTruthy();
  }
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  expect(manifest.dataset.bundled_id).toBe("comfy-paper-inductive-miner");
  expect(manifest.analysis_params).toMatchObject({ n_factors: 2, rotation: "varimax", msa_threshold: 0.6 });
  expect(manifest.analysis.assignment_rule).toBe("largest_loading");
  expect(manifest.dataset.provenance.bundled.copied_from.commit).toBe("1dd6ea610017cbca65bb54735ac6db922af00e8d");
  expect(Object.keys(manifest.tool)).toEqual(["name", "version", "commit"]);
  const analysis = JSON.parse(files.get("analysis.json")!.toString("utf8"));
  expect(analysis.kmo.overall).toBeCloseTo(0.7466686435594551, 9);
});
