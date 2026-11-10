// Static export of the frontend into out/ for a server that serves the pages and /api itself
// (desktop app). Run it with `npm run build:export`.
//
// - Sets NEXT_OUTPUT=export, which next.config.mjs reads (no rewrites, headers or proxy settings).
// - middleware.ts (session cookie) needs a server and is not part of an export: Next.js builds
//   it into nothing, without a warning. The server that serves the files has to set the cookie.
//   The check below fails the build if a Next.js update ever changes that.
// - Writes the security headers of the pages to out/_headers.json, from the same module that
//   next.config.mjs uses for the Docker build.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSecurityHeaders } from "../security-headers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const build = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NEXT_OUTPUT: "export" },
});
if (build.status !== 0) process.exit(build.status ?? 1);

const manifest = JSON.parse(readFileSync(join(root, ".next/server/middleware-manifest.json"), "utf8"));
if (Object.keys(manifest.middleware ?? {}).length > 0) {
  console.error("The export contains a middleware, which a static server cannot run.");
  process.exit(1);
}

const out = join(root, "out");
if (!existsSync(join(out, "index.html"))) {
  console.error("out/index.html is missing: the export did not run.");
  process.exit(1);
}
const headers = Object.fromEntries(buildSecurityHeaders("production").map((h) => [h.key, h.value]));
writeFileSync(join(out, "_headers.json"), JSON.stringify(headers, null, 2) + "\n");
console.log("Wrote out/_headers.json");
