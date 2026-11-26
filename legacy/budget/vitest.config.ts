import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const renderer = fileURLToPath(new URL("../../packs/budget/pack/src/renderer", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

// `@suite/budget-core` is a workspace package now, so its tests run with the
// pack that owns it. The renderer and its tests are the pack's source too; this
// config covers the frozen shell's own main tests and runs the moved renderer
// tests in the same gate row.
export default defineConfig({
  // The renderer lives in the pack now; the test server must be allowed to read it.
  server: { fs: { allow: [repoRoot] } },
  test: {
    testTimeout: 20_000,
    projects: [
      {
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { "@renderer": renderer } },
        test: {
          name: "renderer",
          environment: "jsdom",
          include: ["../../packs/budget/pack/src/renderer/**/*.test.{ts,tsx}"],
          setupFiles: ["../../packs/budget/pack/src/renderer/test/setup.ts"],
        },
      },
    ],
  },
});
