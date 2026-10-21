// Fails when the two languages of the UI drift apart or the code asks for a text that is missing:
//
// - en.json and de.json have the same keys, each a text in both or a group in both;
// - each text has the same {placeholders} in both languages;
// - the German texts address the reader informally ("Öffne", not "Öffnen Sie"), as the app does;
// - every key the code names literally, as t("..."), tMaybe("...") or countText(t, "..."),
//   exists, countText's with its "_plural" form;
// - for a key built at runtime, e.g. t(`factor.steps.${id}`), the fixed part names a group.
//
// Run from src/frontend: node scripts/check-i18n.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const locales = Object.fromEntries(
  ["en", "de"].map((lang) => [lang, JSON.parse(readFileSync(join(root, "lib/i18n/locales", `${lang}.json`), "utf8"))]),
);
const problems = [];

/** Every text of a dictionary by its dotted key, and every group. */
function flatten(dict, prefix = "", texts = new Map(), groups = new Set()) {
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") texts.set(path, value);
    else if (value && typeof value === "object") {
      groups.add(path);
      flatten(value, path, texts, groups);
    } else problems.push(`${path}: neither a text nor a group`);
  }
  return { texts, groups };
}

const placeholders = (text) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(", ");

const en = flatten(locales.en);
const de = flatten(locales.de);
for (const [key, text] of en.texts) {
  if (!de.texts.has(key)) {
    problems.push(de.groups.has(key) ? `${key}: a text in en.json, a group in de.json` : `${key}: missing in de.json`);
  } else if (placeholders(text) !== placeholders(de.texts.get(key))) {
    problems.push(`${key}: placeholders {${placeholders(text)}} in en.json, {${placeholders(de.texts.get(key))}} in de.json`);
  }
}
for (const key of de.texts.keys()) {
  if (!en.texts.has(key) && !en.groups.has(key)) problems.push(`${key}: missing in en.json`);
}
// A verb in the polite imperative: "Wählen Sie", "können Sie". "Sie" and "Ihre" for a thing are fine.
const FORMAL = /\b[A-Za-zÄÖÜäöüß]+en Sie\b/;
for (const [key, text] of de.texts) {
  const formal = FORMAL.exec(text);
  if (formal) problems.push(`${key}: formal address "${formal[0]}" in de.json, the app says du`);
}
for (const key of de.groups) {
  if (!en.groups.has(key) && !en.texts.has(key)) problems.push(`${key}: group missing in en.json`);
}

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

// t("key"), tMaybe("key"), countText(t, "key"); the key in double or single quotes or backticks.
const CALL = /\b(t|tMaybe|countText\(\s*t\s*,)\s*\(?\s*(["'`])((?:(?!\2).)*)\2/g;
let checked = 0;
for (const dir of ["app", "components", "lib"]) {
  for (const file of sources(join(root, dir))) {
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(CALL)) {
      const [, fn, quote, key] = match;
      const where = `${relative(root, file).replaceAll("\\", "/")}:${code.slice(0, match.index).split("\n").length}`;
      if (quote === "`" && key.includes("${")) {
        const fixed = key.slice(0, key.indexOf("${"));
        // Only a whole leading group can be checked, e.g. "factor.steps." of `factor.steps.${id}`.
        if (fixed.endsWith(".") && !en.groups.has(fixed.slice(0, -1))) {
          problems.push(`${where}: no group ${fixed.slice(0, -1)} for ${quote}${key}${quote}`);
        }
        checked++;
        continue;
      }
      if (!/^[a-z0-9_]+(\.[a-z0-9_]+)+$/.test(key)) continue; // not a key, e.g. t("a", ...) of another function
      checked++;
      const keys = fn.startsWith("countText") ? [key, `${key}_plural`] : [key];
      for (const k of keys) {
        if (!en.texts.has(k)) problems.push(`${where}: ${k} is not in en.json`);
      }
    }
  }
}

if (problems.length) {
  console.error(`i18n check failed with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`i18n check passed: ${en.texts.size} texts in en.json and de.json, ${checked} keys used in the code.`);
