import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, stepSection, test, text } from "./fixtures";

// The feedback form: a quiet entry in the header opens a dialog with the kind, a message, an optional
// contact and the technical details that go along. A send closes it with a thank-you; Escape closes it
// and keeps what was typed. The error notices lead to the same dialog as a bug report with the code of
// the error. The server is not reached: the answers are faked, and the requests are collected.

type Sent = Record<string, unknown> & { context: Record<string, string> | null };

const MAIL = { mail: true, version: "1.0.0", commit: "abcdef1234567" };

/** Answers /api/feedback itself (GET: whether mail is set up; POST: a send) and collects what was sent. */
async function fakeFeedback(
  page: Page,
  answer: { status: number; json: unknown } = { status: 200, json: { ok: true } },
  channel: typeof MAIL = MAIL,
) {
  const sent: Sent[] = [];
  await page.route("**/api/feedback", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ status: 200, json: channel });
    sent.push(route.request().postDataJSON());
    await route.fulfill(answer);
  });
  return sent;
}

const headerButton = (page: Page) => page.getByRole("banner").getByRole("button", { name: text("header.feedback_label") });
const dialog = (page: Page) => page.getByRole("dialog", { name: text("feedback.title"), exact: true });
const title = (page: Page) => dialog(page).getByRole("textbox", { name: text("feedback.title_label") });
const message = (page: Page) => dialog(page).getByRole("textbox", { name: text("feedback.message_label") });
const send = (page: Page) => dialog(page).getByRole("button", { name: text("feedback.send"), exact: true });
const kind = (page: Page, which: "bug" | "idea" | "other") =>
  dialog(page).getByRole("radio", { name: text(`feedback.kind.${which}`), exact: true });
const technical = (page: Page) => dialog(page).getByRole("checkbox", { name: text("feedback.technical") });

async function open(page: Page, url = "/log") {
  await page.goto(url);
  await headerButton(page).click();
  await expect(dialog(page)).toBeVisible();
}

test("the entry in the header is an icon on a small screen, with its name from lg on", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto("/settings");
  const button = headerButton(page);
  await expect(button.getByText(text("header.feedback_label"), { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(button.getByText(text("header.feedback_label"), { exact: true })).toBeHidden();
  // Still named, and a target of at least 24 px.
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(24);
  expect(box!.height).toBeGreaterThanOrEqual(24);
  // The header keeps its line: nothing sticks out of the window.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a message is sent with the technical details, the toast thanks and the dialog closes", async ({ page }) => {
  const sent = await fakeFeedback(page);
  await open(page, "/log?step=suitability");
  await expect(message(page)).toBeFocused();
  await expect(kind(page, "bug")).toBeChecked();
  await expect(send(page)).toBeDisabled();
  await expect(dialog(page)).toContainText(text("feedback.anonymous"));
  // A mail takes its subject from the message: no title field.
  await expect(title(page)).toHaveCount(0);

  await kind(page, "idea").click();
  await message(page).fill("Please add a dark map");
  // The numbers of the counter are formatted for the language.
  await expect(dialog(page)).toContainText(text("feedback.counter", { n: "21", max: "4,000" }));
  await dialog(page).getByRole("textbox", { name: text("feedback.contact_label") }).fill("me@example.org");
  await expect(technical(page)).toBeChecked();
  await send(page).click();

  await expect(page.getByRole("status").getByText(text("feedback.thanks"))).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  await expect(headerButton(page)).toBeFocused();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ kind: "idea", message: "Please add a dark map", contact: "me@example.org", website: "" });
  // Only what the list in the dialog promises, and no query beyond the step.
  expect(sent[0].context).toMatchObject({ route: "/log", step: "suitability", language: "en" });
  expect(Object.keys(sent[0].context!).sort()).toEqual(["language", "route", "step", "user_agent"]);

  // What was sent is gone from the form.
  await headerButton(page).click();
  await expect(message(page)).toHaveValue("");
  await expect(kind(page, "idea")).toBeChecked();
});

test("without mail on the server the form opens a filled-in issue on GitHub", async ({ page, context }) => {
  const sent = await fakeFeedback(page, undefined, { ...MAIL, mail: false });
  await context.route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>GitHub</title>" }));
  await open(page, "/log?step=suitability");
  await expect(dialog(page)).toContainText(text("feedback.github_note"));
  // The GitHub account answers for the contact.
  await expect(dialog(page).getByRole("textbox", { name: text("feedback.contact_label") })).toHaveCount(0);
  await kind(page, "idea").click();
  // Without a typed title the title is a short summary of the message; the message stays whole.
  await expect(title(page)).toBeVisible();
  await message(page).fill("Please add a dark map\nand a legend");

  const opened = context.waitForEvent("page");
  await dialog(page).getByRole("button", { name: text("feedback.github_send"), exact: true }).click();
  const issue = await opened;
  await issue.waitForLoadState();
  const url = new URL(issue.url());
  expect(`${url.origin}${url.pathname}`).toBe("https://github.com/Magiertx/complexity-factor-analysis/issues/new");
  expect(url.searchParams.get("template")).toBe("feedback.yml");
  expect(url.searchParams.get("title")).toBe("Idea: Please add a dark map");
  expect(url.searchParams.get("message")).toBe("Please add a dark map\nand a legend");
  const details = url.searchParams.get("details")!.split("\n");
  expect(details).toEqual(expect.arrayContaining(["version: 1.0.0", "commit: abcdef1234567", "route: /log", "step: suitability"]));

  await expect(page.getByRole("status").getByText(text("feedback.github_opened"))).toBeVisible();
  await expect(dialog(page)).toBeHidden();
  expect(sent).toHaveLength(0); // nothing kept on a server where nobody would read it
});

test("a typed title becomes the title of the GitHub issue", async ({ page, context }) => {
  await fakeFeedback(page, undefined, { ...MAIL, mail: false });
  await context.route("https://github.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>GitHub</title>" }));
  await open(page, "/settings");
  await title(page).fill("Dark map");
  await message(page).fill("Please add a dark map. It would help at night.");

  const opened = context.waitForEvent("page");
  await dialog(page).getByRole("button", { name: text("feedback.github_send"), exact: true }).click();
  const issue = await opened;
  await issue.waitForLoadState();
  const url = new URL(issue.url());
  expect(url.searchParams.get("title")).toBe("Bug: Dark map");
  expect(url.searchParams.get("message")).toBe("Please add a dark map. It would help at night.");
});

test("the technical details can be turned off, and the dialog lists what goes along", async ({ page }) => {
  const sent = await fakeFeedback(page);
  await open(page, "/settings");
  const info = dialog(page).getByRole("button", { name: text("common.info_aria", { topic: text("feedback.technical_topic") }) });
  await info.click();
  const popover = page.getByRole("dialog", { name: text("feedback.technical_topic"), exact: true });
  await expect(popover).toContainText("/settings");
  await expect(popover).toContainText(text("feedback.technical_version_value"));
  await expect(popover).toContainText(text("feedback.technical_error"));
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(dialog(page)).toBeVisible();

  await technical(page).uncheck({ force: true });
  await message(page).fill("Without details");
  await send(page).click();
  await expect(dialog(page)).toBeHidden();
  expect(sent[0].context).toBeNull();
});

test("Escape closes the dialog, the focus returns to the entry and the draft is kept", async ({ page }) => {
  await fakeFeedback(page);
  await open(page, "/settings");
  await message(page).fill("Not finished yet");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(headerButton(page)).toBeFocused();
  await headerButton(page).click();
  await expect(message(page)).toHaveValue("Not finished yet");
  // The close button and a click beside the dialog close it too.
  await dialog(page).getByRole("button", { name: text("common.close") }).click();
  await expect(dialog(page)).toBeHidden();
});

test("the honeypot is out of sight and out of the tab order, and Tab stays in the dialog", async ({ page }) => {
  const sent = await fakeFeedback(page);
  await open(page, "/settings");
  const trap = dialog(page).locator('input[name="website"]');
  await expect(trap).toHaveAttribute("tabindex", "-1");
  await expect(dialog(page).locator('[aria-hidden="true"] input[name="website"]')).toHaveCount(1);
  expect((await trap.boundingBox())!.x).toBeLessThan(0);

  await message(page).fill("Hello");
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.name)).not.toBe("website");
    await expect(dialog(page).locator(":focus")).toHaveCount(1);
  }
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Shift+Tab");
    await expect(dialog(page).locator(":focus")).toHaveCount(1);
  }

  // A bot that fills every field is recognised by the server through this value.
  await trap.fill("https://spam.example", { force: true });
  await send(page).click();
  await expect(dialog(page)).toBeHidden();
  expect(sent[0].website).toBe("https://spam.example");
});

test("an answer of the server is said in plain words, and the form stays", async ({ page }) => {
  await fakeFeedback(page, { status: 429, json: { detail: "Too many requests (5 per 1 hour). Try again later.", code: "rate_limited" } });
  await open(page, "/settings");
  await message(page).fill("Again");
  await send(page).click();
  const alert = dialog(page).getByRole("alert");
  await expect(alert).toContainText(text("errors.feedback_rate_limited"));
  await expect(dialog(page)).toBeVisible();
  await expect(message(page)).toHaveValue("Again");
});

test("an error notice leads to the dialog as a bug report with the code of the error", async ({ page }) => {
  const sent = await fakeFeedback(page);
  await page.route("**/api/factor-analysis/datasets", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 400, json: { detail: "The file is empty.", code: "empty_file" } });
  });
  // Before any error the details name none.
  await open(page, "/");
  await dialog(page).getByRole("button", { name: text("common.info_aria", { topic: text("feedback.technical_topic") }) }).click();
  const popover = page.getByRole("dialog", { name: text("feedback.technical_topic"), exact: true });
  await expect(popover.getByText(text("feedback.technical_none"), { exact: true })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();

  const data = stepSection(page, "data");
  await data.getByRole("radio", { name: "Inductive miner", exact: true }).check({ force: true });
  await data.getByRole("button", { name: text("factor.data.submit_bundled") }).click();
  const notice = page.getByRole("alert").filter({ hasText: text("errors.empty_file") });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: text("feedback.report"), exact: true }).click();

  await expect(dialog(page)).toBeVisible();
  await expect(kind(page, "bug")).toBeChecked();
  await message(page).fill("The upload says the file is empty");
  await send(page).click();
  await expect(dialog(page)).toBeHidden();
  expect(sent[0]).toMatchObject({ kind: "bug" });
  expect(sent[0].context).toMatchObject({ route: "/", step: "data", error_code: "empty_file" });
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no serious problem in the open dialog (${scheme})`, async ({ page }) => {
    await fakeFeedback(page);
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, "/settings");
    await message(page).fill("Something");
    const problems = async () => {
      // A button that just became enabled fades in; axe would measure it half way.
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
      const results = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      return results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
    };
    expect(await problems()).toEqual([]);
    await dialog(page).getByRole("button", { name: text("common.info_aria", { topic: text("feedback.technical_topic") }) }).click();
    expect(await problems()).toEqual([]);
  });
}
