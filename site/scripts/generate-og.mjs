// Render site/scripts/og.html to site/public/og.png (1200x630 social card).
// Chromium renders the real Geist webfonts; we shoot at 2x and downscale with
// sharp so the thin display type stays crisp. Run from site/: `node scripts/generate-og.mjs`
// (Playwright resolves from the repo-root node_modules; uses system Chrome so no
// browser download is needed.)

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const htmlPath = resolve(here, "og.html");
const outPath = resolve(here, "../public/og.png");

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
  });
  await page.goto(`file://${htmlPath}`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const shot = await page.screenshot({
    clip: { x: 0, y: 0, width: 1200, height: 630 },
  });
  await sharp(shot).resize(1200, 630).png().toFile(outPath);
  console.log(`Wrote ${outPath}`);
} finally {
  await browser.close();
}
