import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, pattern, test, text } from "./fixtures";

// The History tab says what runs without opening the page ("1 running · 37%", a spinner), has a
// red dot for a failure nobody has looked at, and a dataset that has just been computed raises a
// notice "<dataset> is ready · Open" on any page. The jobs of the server are replaced here by a list of the
// spec's own, so that a run stays at 37% as long as the spec wants; e2e/dataset-logs.spec.ts
// computes a real dataset and waits for its notice.

const DATASET = "0b7a3e9c-5b47-4a37-9d8e-0f2f6a0c1d11";

function job(status: "pending" | "running" | "completed" | "failed" | "aborted", extra: Record<string, unknown> = {}) {
  return {
    id: "6c1f1c1e-61b7-4ac3-8b7d-0d1d9d3c0a01",
    algorithm_id: "_dataset:model",
    algorithm_name: "Factor analysis dataset (model measures)",
    filename: "4 log(s)",
    params: { dataset_id: DATASET, source: "logs", dataset_name: "Nets of April", miners: ["Inductive miner"], measures: ["Size"] },
    status,
    percentage: status === "completed" ? 100 : status === "running" ? 37 : 0,
    progress_status: status === "running" ? "Mining…" : "",
    created_at: Date.now() / 1000,
    ...extra,
  };
}

/** Serves the list of the spec instead of the server's, and makes the page read it again. */
async function serve(page: Page, jobs: () => unknown[]) {
  await page.route("**/api/jobs", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    return route.fulfill({ json: { jobs: jobs() } });
  });
}

async function refresh(page: Page) {
  // The page reads the list again when the tab becomes visible.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
}

/** The History tab of the mode bar. */
function tab(page: Page, language: "en" | "de" = "en") {
  return page
    .getByRole("navigation", { name: text("mode_bar.aria_label", {}, language) })
    .getByRole("link", { name: pattern(text("mode_bar.history_label", {}, language)) });
}

test("the tab says how many runs run and how far they are, and goes back when they are done", async ({ page }) => {
  let list: unknown[] = [job("running")];
  await serve(page, () => list);
  await page.goto("/");
  await expect(tab(page)).toContainText(text("mode_bar.jobs_running", { n: 1, pct: "37%" }));
  // A spinner stands before it. History is a tool of the app: its line is there only while something runs.
  await expect(tab(page).locator("svg.animate-spin")).toBeVisible();
  await expect(tab(page)).not.toContainText(text("mode_bar.history_desc"));

  // A second run that waits: two are active, the one that runs sets the progress.
  list = [job("running"), job("pending", { id: "6c1f1c1e-61b7-4ac3-8b7d-0d1d9d3c0a02" })];
  await refresh(page);
  await expect(tab(page)).toContainText(text("mode_bar.jobs_running", { n: 2, pct: "37%" }));

  // Only a run that waits: no percentage to show.
  list = [job("pending")];
  await refresh(page);
  await expect(tab(page)).toContainText(text("mode_bar.jobs_waiting", { n: 1 }));

  // Nothing runs: the tab is its name alone again.
  list = [job("aborted")];
  await refresh(page);
  await expect(tab(page)).not.toContainText(text("mode_bar.jobs_waiting", { n: 1 }));
  await expect(tab(page)).toHaveAccessibleName(text("mode_bar.history_label"));
  await expect(tab(page).locator("svg.animate-spin")).toHaveCount(0);
});

test("a failed run has a red dot that goes once the History has shown it, and stays gone", async ({ page }) => {
  const failed = job("failed", { error: "The miner broke down." });
  await serve(page, () => [failed]);
  await page.goto("/");
  await expect(tab(page)).toContainText(text("mode_bar.jobs_failed"));
  await expect(tab(page).locator("span.bg-danger")).toBeVisible();

  // The tab leads to the History, which lists the failure; there is no drawer any more.
  await tab(page).click();
  await expect(page).toHaveURL(/\/runs$/);
  await expect(page.getByRole("main")).toContainText("The miner broke down.");
  await expect(tab(page)).not.toContainText(text("mode_bar.jobs_failed"));
  await page.goto("/");
  await expect(tab(page)).not.toContainText(text("mode_bar.jobs_failed"));
  await expect(tab(page).locator("span.bg-danger")).toHaveCount(0);
  await page.reload();
  await expect(tab(page)).toBeVisible();
  await expect(tab(page)).not.toContainText(text("mode_bar.jobs_failed"));

  // Another failure raises the dot again.
  await page.unroute("**/api/jobs");
  await serve(page, () => [failed, job("failed", { id: "6c1f1c1e-61b7-4ac3-8b7d-0d1d9d3c0a09" })]);
  await refresh(page);
  await expect(tab(page)).toContainText(text("mode_bar.jobs_failed"));
});

test("a dataset that has been computed raises a notice with a link to it", async ({ page }) => {
  let list: unknown[] = [job("running")];
  await serve(page, () => list);
  await page.goto("/runs");
  await page.waitForLoadState("networkidle");
  const notice = page.getByRole("status").filter({ hasText: text("jobs.ready", { name: "Nets of April" }) });
  await expect(notice).toHaveCount(0);

  list = [job("completed")];
  await refresh(page);
  await expect(notice).toBeVisible();
  await expect(notice.getByRole("link", { name: pattern(text("jobs.ready_open")) })).toHaveAttribute("href", `/?dataset=${DATASET}`);
  // The same list again does not raise it a second time, and the notice stays until it is closed.
  await notice.getByRole("button", { name: text("common.close") }).click();
  await expect(notice).toHaveCount(0);
  await refresh(page);
  await page.waitForTimeout(300);
  await expect(notice).toHaveCount(0);

  // A dataset of log measures opens on the log tab; several at once are counted.
  list = [job("running", { id: "a1", algorithm_id: "_dataset:log", params: { dataset_id: DATASET, source: "logs" } })];
  await refresh(page);
  list = [job("completed", { id: "a1", algorithm_id: "_dataset:log", params: { dataset_id: DATASET, source: "logs" } })];
  await refresh(page);
  const log = page.getByRole("status").filter({ hasText: /is ready|ist fertig/ });
  await expect(log.getByRole("link", { name: pattern(text("jobs.ready_open")) })).toHaveAttribute("href", `/log?dataset=${DATASET}`);
});

test("a dataset started while the page was open is announced even if no list saw it running", async ({ page }) => {
  let list: unknown[] = [job("completed", { id: "old-one" })];
  await serve(page, () => list);
  await page.goto("/runs");
  await page.waitForLoadState("networkidle");
  const notice = page.getByRole("status").filter({ hasText: text("jobs.ready", { name: "Nets of April" }) });
  await expect(notice).toHaveCount(0);
  // The finished run of the first list says nothing; one that appears finished already does, as the
  // job of a few logs that is computed between two requests for the list.
  list = [job("completed", { id: "old-one" }), job("completed", { id: "quick-one" })];
  await refresh(page);
  await expect(notice).toBeVisible();
});

test("the notice is read out, takes the keyboard and closes with Escape", async ({ page }) => {
  let list: unknown[] = [job("running")];
  await serve(page, () => list);
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  list = [job("completed")];
  await refresh(page);
  const live = page.locator(".toast-region");
  // The region is a polite live region that was there before its text came.
  await expect(live).toHaveAttribute("role", "status");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toContainText(text("jobs.ready", { name: "Nets of April" }));
  await live.getByRole("link", { name: pattern(text("jobs.ready_open")) }).focus();
  await page.keyboard.press("Escape");
  await expect(live).not.toContainText("Nets of April");
});

test.describe("German", () => {
  test.use({ language: "de" });

  test("the tab and the notice speak German", async ({ page }) => {
    let list: unknown[] = [job("running")];
    await serve(page, () => list);
    await page.goto("/");
    await expect(tab(page, "de")).toContainText(
      // The German percentage has a no-break space before the sign.
      text("mode_bar.jobs_running", { n: 1, pct: "37 %" }, "de"),
    );
    list = [job("completed")];
    await refresh(page);
    await expect(page.getByRole("status").filter({ hasText: text("jobs.ready", { name: "Nets of April" }, "de") })).toBeVisible();
  });
});

for (const scheme of ["light", "dark"] as const) {
  test(`axe finds no serious problem with a running run, a failure and a notice (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    let list: unknown[] = [job("running"), job("failed", { id: "6c1f1c1e-61b7-4ac3-8b7d-0d1d9d3c0a05" })];
    await serve(page, () => list);
    await page.goto("/");
    await expect(tab(page)).toContainText(text("mode_bar.jobs_failed"));
    list = [job("completed"), job("failed", { id: "6c1f1c1e-61b7-4ac3-8b7d-0d1d9d3c0a05" })];
    await refresh(page);
    await expect(page.locator(".toast-region")).toContainText("Nets of April");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`);
    expect(serious).toEqual([]);
  });
}
