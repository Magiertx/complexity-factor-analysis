import { desktopAccess } from "./desktop-access";
import type { Page } from "@playwright/test";
import { expect, expectStep, seedStorage, test } from "./fixtures";

/**
 * The session ids of the session cookies a page is sent, in the order they arrive, and the
 * answers of the API that were server errors: requests of one new session that arrive together
 * must not trip over each other where the session is stored.
 */
function trackSessions(page: Page): { ids: string[]; errors: string[] } {
  const ids: string[] = [];
  const errors: string[] = [];
  page.on("response", async (response) => {
    if (response.status() >= 500) errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    for (const header of await response.headersArray().catch(() => [])) {
      if (header.name.toLowerCase() !== "set-cookie") continue;
      const cookie = /^session_id=([^;]+)/.exec(header.value);
      // The value is the signed session: base64 of the JSON, then timestamp and signature.
      if (cookie) ids.push(JSON.parse(Buffer.from(cookie[1].split(".")[0], "base64").toString()).session_id);
    }
  });
  return { ids, errors };
}

test("a first visit without a cookie gets one session, and the run it starts survives", async ({ browser, baseURL }) => {
  // A browser that has never been here, and no cookie request beforehand: the page fires its
  // first requests (catalog, datasets, the dataset the link opens) at once.
  const context = await browser.newContext({ baseURL, locale: "en-US", ...desktopAccess() });
  try {
    const page = await context.newPage();
    await seedStorage(page);
    const { ids, errors } = trackSessions(page);

    await page.goto("/?bundled=comfy-paper-inductive-miner&preset=published");
    await expectStep(page, "loadings", "done");

    // Every session cookie the server sent names the same session, ...
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    expect(errors).toEqual([]);
    // ... so the dataset the first request created is in the session the browser keeps.
    const listed = await page.request.get("/api/factor-analysis/datasets");
    expect(listed.ok()).toBeTruthy();
    expect((await listed.json()).datasets).toHaveLength(1);
    expect((await page.request.delete("/api/factor-analysis/datasets")).ok()).toBeTruthy();
  } finally {
    await context.close();
  }
});

test("a cookie the server cannot read is replaced on the next page load", async ({ browser, baseURL }) => {
  // E.g. after the server's secret changed: the cookie is there, but every request would start
  // a session of its own, as without a cookie.
  const context = await browser.newContext({ baseURL, locale: "en-US", ...desktopAccess() });
  try {
    await context.addCookies([{ name: "session_id", value: "e30=.AAAAAA.not-a-signature", url: baseURL ?? "http://localhost:3000" }]);
    const page = await context.newPage();
    await seedStorage(page);
    const { ids, errors } = trackSessions(page);

    await page.goto("/?bundled=comfy-paper-inductive-miner&preset=published");
    await expectStep(page, "loadings", "done");
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(1);
    expect(errors).toEqual([]);
    expect((await (await page.request.get("/api/factor-analysis/datasets")).json()).datasets).toHaveLength(1);
    expect((await page.request.delete("/api/factor-analysis/datasets")).ok()).toBeTruthy();
  } finally {
    await context.close();
  }
});
