import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { expect, test } from "@playwright/test";

// Only against a desktop app (CFA_TOKEN set, see desktop-access.ts): the way a user gets in. The
// launcher opens /?token=<one-time code>; the app trades the code for a session cookie and
// redirects to the address without it.
const token = process.env.CFA_TOKEN?.trim();
test.skip(!token, "needs a desktop app and its token");

async function code(request: import("@playwright/test").APIRequestContext): Promise<string> {
  const response = await request.get("/_desktop/login", { headers: { "X-Desktop-Instance": token! } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).code;
}

test("a one-time code opens the app once, in exchange for a session cookie", async ({ browser, baseURL, request }) => {
  const first = await code(request);
  const context = await browser.newContext({ baseURL, locale: "en-US", storageState: { cookies: [], origins: [] } }); // no cookie: the browser's own way in
  try {
    const page = await context.newPage();
    // Without credentials nothing but a note, and the API refuses.
    const refused = await page.goto("/");
    expect(refused?.status()).toBe(401);
    expect((await context.request.get("/api/factor-analysis/datasets")).status()).toBe(401);

    const response = await page.goto(`/?token=${first}`);
    expect(response?.status()).toBe(200);
    expect(page.url()).not.toContain("token=");
    expect(page.url()).not.toContain(first);
    const cookie = (await context.cookies()).find((c) => c.name.startsWith("desktop_access_"));
    expect(cookie).toBeTruthy();
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", expires: -1 });
    expect(cookie!.value).not.toBe(token); // a value of its own, not the token
    expect((await context.request.get("/api/factor-analysis/datasets")).ok()).toBeTruthy();

    // The code is used up.
    const other = await browser.newContext({ baseURL, locale: "en-US", storageState: { cookies: [], origins: [] } });
    try {
      const reused = await (await other.newPage()).goto(`/?token=${first}`);
      expect(reused?.status()).toBe(401);
    } finally {
      await other.close();
    }
  } finally {
    await context.close();
  }
});

// The way the launcher and its "Open in browser" button go: the login file (file://), whose meta
// refresh leads to /?token=<code>. With a SameSite=Strict cookie Chrome and Edge counted the
// redirect as cross-site, left the cookie off and showed the landing page.
test("the login file the launcher opens leads into the app", async ({ browser, baseURL, request }) => {
  const response = await request.get("/_desktop/login", { headers: { "X-Desktop-Instance": token! } });
  expect(response.ok()).toBeTruthy();
  const { file } = (await response.json()) as { file?: string };
  test.skip(!file || !existsSync(file), "the app's data directory is not on this machine");
  const context = await browser.newContext({ baseURL, locale: "en-US", storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await page.goto(pathToFileURL(file!).href);
    await page.waitForURL((url) => url.protocol === "http:" && !url.search.includes("token="));
    await expect(page.getByText("This address needs the app")).toHaveCount(0);
    expect((await context.request.get("/api/factor-analysis/datasets")).ok()).toBeTruthy();
    expect(existsSync(file!)).toBeFalsy(); // the file goes once its code is used
  } finally {
    await context.close();
  }
});
