import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { expect, test as base, type Browser, type BrowserContext, type Download, type Locator, type Page } from "@playwright/test";
import de from "../lib/i18n/locales/de.json";
import en from "../lib/i18n/locales/en.json";

type Messages = typeof en;
export const messages: Record<"en" | "de", Messages> = { en, de: de as Messages };

/** A UI text by its i18n key, with {placeholders} filled in, so the specs follow rewording. */
export function text(key: string, params: Record<string, string | number> = {}, locale: "en" | "de" = "en"): string {
  let value: unknown = messages[locale];
  for (const part of key.split(".")) value = (value as Record<string, unknown>)?.[part];
  if (typeof value !== "string") throw new Error(`no text for ${key}`);
  return value.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m));
}

/** The literal text as a regular expression, e.g. to find it inside a longer label. */
export function pattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** No welcome tour, and the UI language fixed whatever the browser's. */
export async function seedStorage(page: Page, language: "en" | "de" = "en") {
  await page.addInitScript((lang) => {
    try {
      if (!localStorage.getItem("app.e2e-init")) {
        localStorage.setItem("app.e2e-init", "1");
        localStorage.setItem("app.onboarding-completed", "1");
        localStorage.setItem("app.locale", lang);
      }
    } catch {
      /* storage blocked; the tests then see the tour */
    }
  }, language);
}

/**
 * Prepares a page like the fixture does: no welcome tour, the UI language. The session cookie
 * needs no preparing: the server sends it with the page itself (middleware.ts), before the
 * page fires its first requests; session.spec.ts checks that.
 */
async function preparePage(page: Page, language: "en" | "de") {
  await seedStorage(page, language);
}

export const test = base.extend<{ language: "en" | "de" }>({
  // The UI language; "locale" is the browser's, which Playwright already names so.
  language: ["en", { option: true }],
  // "provide", not "use": the React hooks lint rule takes any call of use() for a hook.
  page: async ({ page, language }, provide) => {
    await preparePage(page, language);
    await provide(page);
  },
});

/**
 * A page in a browser context of its own, so in a session of its own, e.g. to open a copied
 * link as someone else would. Close the context when done.
 */
export async function freshPage(
  browser: Browser,
  baseURL: string | undefined,
  language: "en" | "de" = "en",
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, locale: "en-US", acceptDownloads: true });
  const page = await context.newPage();
  await preparePage(page, language);
  return { context, page };
}

export { expect };

/** The link of a step in the step rail, whose name ends with the state in brackets. */
export function stepLink(page: Page, step: string, locale: "en" | "de" = "en"): Locator {
  return page
    .getByRole("navigation", { name: text("factor.steps.aria", {}, locale) })
    // Anchored: "Data" must not match "Dataset".
    .getByRole("link", { name: new RegExp("^" + pattern(text(`factor.steps.${step}`, {}, locale)).source + "\\b") });
}

/** Waits until a step has a state, e.g. "done"; several states may be given as "done|warn". */
export async function expectStep(
  page: Page,
  step: string,
  state: string,
  locale: "en" | "de" = "en",
  timeout?: number,
) {
  const labels = state.split("|").map((s) => pattern(`(${text(`factor.state.${s}`, {}, locale)})`).source);
  await expect(stepLink(page, step, locale)).toHaveAccessibleName(new RegExp(labels.join("|")), { timeout });
}

/**
 * Whether the step of the interpretation can be opened. Asks the server, since the rail only knows
 * once its own request is back; with stored interpretations only, the answer depends on the settings.
 */
export async function interpretationOpens(page: Page): Promise<boolean> {
  const status = await (await page.request.get("/api/factor-analysis/interpretation/status")).json();
  const link = stepLink(page, "interpretation");
  if (status.available) {
    await expect(link).not.toHaveAttribute("aria-disabled", "true");
    return true;
  }
  if (!status.precomputed_only) {
    await expect(link).toHaveAttribute("aria-disabled", "true");
    return false;
  }
  await page.waitForLoadState("networkidle");
  return (await link.getAttribute("aria-disabled")) !== "true";
}

/**
 * Opens a step from the step rail and waits until it is on screen: one step is shown at a time,
 * so a spec opens the step whose content it reads.
 */
export async function goToStep(page: Page, step: string, locale: "en" | "de" = "en") {
  const link = stepLink(page, step, locale);
  await expect(link).not.toHaveAttribute("aria-disabled", "true");
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "step");
  await expect(stepSection(page, step)).toBeVisible();
}

/**
 * A dataset computed by a job (feeed, ComFy) takes longer than one loaded from a file: the log
 * sample with the default feeed groups two minutes on a fast CI runner and over four on a slow
 * one, whose two CPUs the specs of the other worker share meanwhile. A spec that waits for one
 * gives itself a minute more for the steps after it.
 */
export const COMPUTE_TIMEOUT = 360_000;

/**
 * A factor fit of the bundled log measures (over a hundred) takes three seconds on a desktop and
 * half a minute on a slow CI runner of two CPUs, whose backend computes the feeed job of another
 * spec in the same process meanwhile. The backend keeps the fit for the next analysis of the
 * same data, but not one given up because its page closed: a spec that stops waiting too early
 * leaves the next one to start the fit over.
 */
export const FIT_TIMEOUT = 90_000;

/** The section of a step, e.g. "suitability"; only the step on screen has one (the data step is kept, hidden). */
export function stepSection(page: Page, step: string): Locator {
  return page.locator(`#fa-step-${step}`);
}

/** The loadings open on the dimensions; a test that reads the matrix asks for it. */
export async function showMatrix(page: Page, locale: "en" | "de" = "en") {
  const matrix = stepSection(page, "loadings").getByRole("radio", { name: text("factor.loadings.look_matrix", {}, locale) });
  await matrix.click();
  await expect(matrix).toBeChecked();
}

/**
 * Loads a bundled dataset of the data step by its label, e.g. "Inductive miner". The data step stays
 * on screen with what was loaded; its button leads on to the dataset step.
 */
export async function loadBundled(page: Page, label: string, locale: "en" | "de" = "en") {
  const data = stepSection(page, "data");
  await data.getByRole("radio", { name: label, exact: true }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_bundled", {}, locale) }).click();
  await expectStep(page, "dataset", "done", locale);
  await expect(data).toBeVisible();
  await expect(data).toContainText(text("factor.data.loaded", { name: `Important Factors: ${label}` }, locale).split(":")[0]);
}

/** The button of a loaded dataset in the data step that leads on to the dataset step. */
export function nextFromData(page: Page, locale: "en" | "de" = "en"): Locator {
  return stepSection(page, "data").getByRole("button", {
    name: text("factor.nav.next_to", { step: text("factor.steps.dataset", {}, locale) }, locale),
  });
}

/** Opens a bundled dataset of the data step by its label, e.g. "Inductive miner", and goes on to the dataset step. */
export async function openBundled(page: Page, label: string, locale: "en" | "de" = "en") {
  await loadBundled(page, label, locale);
  await nextFromData(page, locale).click();
  await expect(stepSection(page, "dataset")).toBeVisible();
}

/** Chooses the settings a bundled dataset with published settings opens with, in the data step. */
export async function chooseOpenWith(page: Page, preset: "standard" | "published", locale: "en" | "de" = "en") {
  await stepSection(page, "data")
    .getByRole("radiogroup", { name: text("factor.data.preset_label", {}, locale) })
    .getByRole("radio", { name: text(`factor.data.preset.${preset}`, {}, locale) })
    .click();
}

/** The download menu of the toolbar, opened, and one of its entries chosen by its text key. */
export async function chooseDownload(page: Page, key: string, locale: "en" | "de" = "en") {
  await page.getByRole("button", { name: text("factor.toolbar.export", {}, locale), exact: true }).click();
  await page.getByRole("menuitem", { name: pattern(text(key, {}, locale)) }).click();
}

/** Chooses a source of the data step, e.g. "csv". */
export async function chooseSource(page: Page, source: string) {
  await stepSection(page, "data")
    .getByRole("radiogroup", { name: text("factor.data.source_aria") })
    .getByRole("radio", { name: text(`factor.data.source.${source}`) })
    .click();
}

/** The files of a ZIP archive by name, read with nothing but zlib. */
export function unzip(path: string): Map<string, Buffer> {
  const zip = readFileSync(path);
  // End of central directory: the last record with this signature.
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a ZIP archive");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

export async function downloaded(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error(`download ${download.suggestedFilename()} failed`);
  return path;
}

/** Deletes every dataset of the page's session through the API, so a test leaves nothing behind. */
export async function deleteSessionDatasets(page: Page) {
  const response = await page.request.delete("/api/factor-analysis/datasets");
  expect(response.ok()).toBeTruthy();
}
