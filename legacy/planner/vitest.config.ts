import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const core = fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url));
const renderer = fileURLToPath(new URL("./src/renderer/src", import.meta.url));

export default defineConfig({
  test: {
    testTimeout: 15_000,
    projects: [
      {
        resolve: { alias: { "@suite/planner-core": core } },
        test: {
          name: "core",
          environment: "node",
          include: ["packages/core/src/**/*.test.ts"],
        },
      },
      {
        // The shared runtime has no app of its own, so Planner's gate runs its contract tests:
        // the replica and the store are the pieces both apps depend on.
        test: {
          name: "document-runtime",
          environment: "node",
          include: ["../../packages/document-runtime/src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias: { "@suite/planner-core": core } },
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.test.ts"],
        },
      },
      {
        // The desktop sync core Planner and Canvas share. It lives in its own package,
        // and Planner's gate is where it runs: the package's consumers are the proof.
        test: {
          name: "sync-desktop",
          environment: "node",
          include: ["../../packages/sync-desktop/src/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { "@suite/planner-core": core, "@renderer": renderer } },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["src/renderer/src/**/*.test.{ts,tsx}"],
          setupFiles: ["src/renderer/src/test/setup.ts"],
        },
      },
    ],
  },
});
