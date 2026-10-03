import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.PLANT_PACT_URL || "https://plant-pact.vercel.app";
mkdirSync("docs", { recursive: true });

const browser = await chromium.launch();

/** Desktop: the advisor mid-decision, with a real verdict on screen. */
const desktop = await browser.newPage({
  viewport: { width: 1440, height: 1150 },
  deviceScaleFactor: 2,
});
await desktop.goto(`${BASE}/advisor`, { waitUntil: "domcontentloaded" });
await desktop.selectOption("#species", "fiddle-leaf-fig");
await desktop.fill("#plant-label", "the hallway one");
await desktop.fill("#friend", "Maya");
await desktop.selectOption("#city", { label: "Reykjavík, Iceland" });
await desktop.fill("#windowLabel", "bedroom, first floor");
await desktop.selectOption("#aspect", "north");
await desktop.waitForSelector('[data-testid="advisor-verdict"]', { timeout: 60000 });
await desktop.waitForTimeout(3500);
// Open one factor so the evidence expansion is visible, then frame the verdict.
await desktop.locator('[data-testid="factor-coldShare"]').click();
await desktop.waitForTimeout(800);
await desktop.locator('[data-testid="verdict-dial"]').scrollIntoViewIfNeeded();
await desktop.evaluate(() => window.scrollBy(0, -140));
await desktop.waitForTimeout(600);
await desktop.screenshot({ path: "docs/screenshot.png" });
console.log("captured docs/screenshot.png (desktop advisor)");

/** Mobile: the same product on a phone, to show it is not a desktop layout shrunk. */
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
await mobile.goto(`${BASE}/advisor`, { waitUntil: "domcontentloaded" });
await mobile.waitForSelector('[data-testid="advisor-verdict"]', { timeout: 60000 });
await mobile.waitForTimeout(3500);
await mobile.screenshot({ path: "docs/screenshot-mobile.png" });
console.log("captured docs/screenshot-mobile.png");

await browser.close();