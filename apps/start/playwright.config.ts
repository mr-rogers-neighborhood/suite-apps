import { defineConfig } from "@playwright/test";

/**
 * The launcher's own gate.
 *
 * Serial and without a web server: it launches the real Electron app, which is
 * the only way to check what it does with a handoff from the operating system.
 * A display is required, so a headless machine wraps this in `xvfb-run`.
 *
 * A test tagged `@quarantine` is a known flake: the merge queue sets
 * `SUITE_QUARANTINE_SKIP=1` so it cannot block a merge, while the nightly run
 * leaves it unset and still reports it (C5.4). One retry absorbs a transient
 * timeout; it is not a substitute for quarantining.
 */

const skipQuarantine = process.env.SUITE_QUARANTINE_SKIP === "1";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  // The packaged check needs a built release and the real feed; it has its own
  // config and command so this run stays hermetic and offline.
  testIgnore: ["packaged.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 1,
  grepInvert: skipQuarantine ? /@quarantine/ : undefined,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
});
