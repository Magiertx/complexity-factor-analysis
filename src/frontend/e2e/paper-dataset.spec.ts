import {
  chooseDownload,
  deleteSessionDatasets,
  downloaded,
  expect,
  expectStep,
  goToStep,
  interpretationOpens,
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
  // Step 6 offers an interpretation (with an API key on the server) or shows a stored one; without
  // either the list of steps says it is not available here, and why. It is never "not available
  // yet" once the analysis is there. The test never starts an interpretation, which would cost money.
  const step6 = stepLink(page, "interpretation");
  await expect(step6).not.toHaveAccessibleName(pattern(`(${text("factor.state.locked")})`));
  if (!(await interpretationOpens(page))) {
    await expect(step6).toHaveAccessibleName(pattern(`(${text("factor.state.unavailable")})`));
    await expect(step6).toContainText(/API key/);
  } else {
    await goToStep(page, "interpretation");
    const interpretation = stepSection(page, "interpretation");
    await expect(interpretation.getByRole("button", { name: text("factor.interpretation.button") }).or(
      interpretation.getByText(text("factor.interpretation.precomputed"), { exact: true }),
    ).first()).toBeVisible();
  }

  // Step 2: 288 logs, 12 of the 13 measures (one is constant).
  await goToStep(page, "dataset");
  const dataset = stepSection(page, "dataset");
  await expect(dataset).toContainText("288");
  await expect(dataset).toContainText(text("factor.dataset.reason.constant"));

  // Step 3: the numbers of ComFy's report, KMO 0.7467 and chi-square 6822.44.
  await goToStep(page, "suitability");
  const suitability = stepSection(page, "suitability");
  await expect(suitability).toContainText("0.75");
  await expect(suitability).toContainText("6,822.4");
  await expect(suitability).toContainText(text("factor.suitability.removed_summary_plural", { n: 2 }));

  // Step 4: Kaiser suggests 2 factors.
  await goToStep(page, "factors");
  const factors = stepSection(page, "factors");
  await expect(factors.locator("output")).toHaveText("2");
  await expect(factors).toContainText(text("factor.factors.following_suggestion"));

  // The ZIP of the toolbar holds the result and a manifest with the parameters and the provenance.
  const [download] = await Promise.all([page.waitForEvent("download"), chooseDownload(page, "factor.toolbar.export_zip")]);
  expect(download.suggestedFilename()).toBe("Important-Factors-Inductive-miner-factor-analysis.zip");
  const files = unzip(await downloaded(download));
  for (const name of ["manifest.json", "README.txt", "analysis.json", "dataset.csv", "loadings.csv", "msa.csv"]) {
    expect(files.has(name), name).toBeTruthy();
  }
  const manifest = JSON.parse(files.get("manifest.json")!.toString("utf8"));
  expect(manifest.dataset.bundled_id).toBe("comfy-paper-inductive-miner");
  expect(manifest.analysis_params).toMatchObject({ n_factors: 2, rotation: "varimax", msa_threshold: 0.6 });
  // The tool standard, with the seed of the parallel analysis next to the Kaiser suggestion.
  expect(manifest.analysis.assignment_rule).toBe("largest");
  expect(manifest.analysis.factor_count).toMatchObject({ used: 2, kaiser: 2, parallel_analysis: 2, seed: 20261012 });
  expect(manifest.dataset.provenance.bundled.copied_from.commit).toBe("1dd6ea610017cbca65bb54735ac6db922af00e8d");
  expect(Object.keys(manifest.tool)).toEqual(["name", "version", "commit"]);
  const analysis = JSON.parse(files.get("analysis.json")!.toString("utf8"));
  expect(analysis.kmo.overall).toBeCloseTo(0.7466686435594551, 9);
});

test("without a key a stored interpretation comes with no follow-up questions, and says why", async ({ page }) => {
  const status = await (await page.request.get("/api/factor-analysis/interpretation/status")).json();
  test.skip(status.chat, "the server has a key, so follow-up questions are offered");
  test.skip(!status.precomputed_only, "no stored interpretation to show");
  await page.goto("/");
  await openBundled(page, "Inductive miner");
  test.skip(!(await interpretationOpens(page)), "none is stored for these settings");
  await goToStep(page, "interpretation");
  const interpretation = stepSection(page, "interpretation");
  await expect(interpretation.getByText(text("factor.interpretation.precomputed"), { exact: true })).toBeVisible();
  // One muted line instead of the section; nothing to type into.
  await expect(interpretation.getByText(text("factor.interpretation.chat.needs_key"))).toBeVisible();
  await expect(interpretation.getByRole("heading", { name: text("factor.interpretation.chat.title") })).toHaveCount(0);
  await expect(interpretation.getByRole("textbox")).toHaveCount(0);
  await expect(interpretation.getByRole("log")).toHaveCount(0);
});
