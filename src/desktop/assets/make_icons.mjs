// Renders the app's icon (src/frontend/app/icon.svg, the favicon) into the PNGs the desktop
// builds need; make_icons.py packs them into icon.ico (Windows) and icon.icns (macOS).
// Each size is drawn by the browser itself, not scaled down from a large one, so small sizes stay
// sharp. The macOS sizes keep Apple's margin (the shape fills 824 of 1024 px).
//
//   cd src/frontend && node ../desktop/assets/make_icons.mjs && cd ../desktop/assets && python make_icons.py
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require("@playwright/test");

const here = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(here, "..", "..", "frontend", "app", "icon.svg"), "utf8");
const out = join(here, "png");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(file, size, inner) {
  const pad = (size - inner) / 2;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">` +
      `<div style="position:absolute;left:${pad}px;top:${pad}px;width:${inner}px;height:${inner}px">` +
      svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `) +
      `</div></body></html>`,
  );
  await page.screenshot({ path: join(out, file), omitBackground: true });
}
for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) await render(`icon-${size}.png`, size, size);
for (const size of [16, 32, 64, 128, 256, 512, 1024]) await render(`mac-${size}.png`, size, Math.round((size * 824) / 1024));
await browser.close();
console.log(`written to ${out}`);
