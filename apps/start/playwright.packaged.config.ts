import { defineConfig } from "@playwright/test";

/**
 * The packaged hub's own check, run on request.
 *
 * Same rules as `playwright.config.ts`, with a longer timeout because it starts
 * a packaged binary and reads the published feed over the network. Kept apart so
 * `pnpm e2e` and the gate stay hermetic and offline.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  testMatch: ["packaged.spec.ts"],
});
