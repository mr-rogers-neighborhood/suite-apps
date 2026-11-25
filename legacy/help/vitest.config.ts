import { defineConfig } from "vitest/config";

/**
 * The shell's own tests.
 *
 * The renderer, its tests and the docs generator moved to the Help pack, so this
 * config only owns the Electron main process. The pack's `test` script runs the
 * moved renderer and generator tests in the same gate row.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/main/**/*.test.ts"],
  },
});
