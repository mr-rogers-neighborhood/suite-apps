import { defineConfig } from "vitest/config";

/**
 * The host's own gate. The workspace store, the pack resolver and the document
 * scoping are pure enough to test in Node; no window and no Electron runtime.
 */
export default defineConfig({
  resolve: {
    conditions: ["development", "import", "default"],
  },
  test: {
    environment: "node",
    testTimeout: 15_000,
    projects: [
      {
        test: {
          name: "desk",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "pack",
          environment: "node",
          include: ["../../packages/pack/src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "host",
          environment: "node",
          include: ["../../packages/pack-host/src/**/*.test.ts"],
        },
      },
    ],
  },
});
