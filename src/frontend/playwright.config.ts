import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a running stack, by default the Docker stack on port 3000.
//
//   BASE_URL     the frontend to test (default http://localhost:3000)
//   PW_CHANNEL   a browser installed on the machine instead of Playwright's Chromium, e.g.
//                "msedge"; CI installs Chromium and leaves it unset
//   E2E_PROM=1   the stack has ProM: runs the specs tagged @prom and skips those tagged
//                @no-prom, which expect ProM to be missing (as in CI)
//
// No pixel snapshots: the specs check text, roles and downloads.
const prom = process.env.E2E_PROM === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Each test has a browser context and so a session of its own; two at a time keep the
  // analysis slots of the backend free enough.
  workers: 2,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  grepInvert: prom ? /@no-prom/ : /@prom\b/,
  use: {
    ...devices["Desktop Chrome"],
    channel: process.env.PW_CHANNEL || undefined,
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    locale: "en-US",
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
});
