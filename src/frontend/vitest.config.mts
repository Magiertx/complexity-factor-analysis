import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests of the helpers in lib/ that need no browser. The end-to-end tests in e2e/ run
// with Playwright instead.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
