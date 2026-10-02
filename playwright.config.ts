import { defineConfig } from "@playwright/test";

/**
 * Browser smoke tests for the primary journey.
 *
 * Runs against the live deployment when PLANT_PACT_URL is set, and otherwise
 * starts the production build locally. The local run uses the embedded PGlite
 * store and the sealed offline weather sample, so the whole journey is
 * deterministic and needs no network and no environment variables.
 */
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 180000,
  expect: { timeout: 20000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLANT_PACT_URL || "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: process.env.PLANT_PACT_URL
    ? undefined
    : {
        // The dev server is used deliberately: the embedded PGlite store
        // recompiles its WebAssembly module per request under `next start`,
        // which makes local production-build smoke runs unusably slow. The
        // authoritative browser pass runs against the deployed Neon deployment.
        command: "npm run dev",
        url: "http://localhost:3000/api/health",
        reuseExistingServer: false,
        timeout: 600000,
        env: {
          NODE_ENV: "development",
          PLANT_PACT_OFFLINE: "1",
          PGLITE_DIR: ".pglite-smoke",
        },
      },
});