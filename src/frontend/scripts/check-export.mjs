// Checks the static export in out/ (npm run build:export): every page as HTML and as the
// .txt payload that client-side navigation requests, the assets, and the page headers.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const pages = ["index", "log", "compare", "inspect", "print", "runs", "settings", "guide"];

const expected = [
  ...pages.map((p) => `${p}.html`),
  ...pages.map((p) => `${p}.txt`),
  "404.html",
  "_headers.json",
  "_next/static",
];
const missing = expected.filter((f) => !existsSync(join(out, f)));

const problems = missing.map((f) => `missing: out/${f}`);
if (missing.length === 0) {
  if (readdirSync(join(out, "_next/static/chunks")).filter((f) => f.endsWith(".js")).length === 0) {
    problems.push("out/_next/static/chunks has no scripts");
  }
  const headers = JSON.parse(readFileSync(join(out, "_headers.json"), "utf8"));
  for (const key of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]) {
    if (!headers[key]) problems.push(`_headers.json has no ${key}`);
  }
  // The API is same-origin; nothing may point at the Docker service name.
  for (const page of pages) {
    if (readFileSync(join(out, `${page}.html`), "utf8").includes("algoservice")) {
      problems.push(`${page}.html contains the address of the Docker service`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Export ok: ${pages.length} pages, 404, _headers.json, _next/static.`);
