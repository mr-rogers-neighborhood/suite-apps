import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const renderer = fileURLToPath(new URL("./src/renderer/src", import.meta.url));

// `@suite/budget-core` is a workspace package now, so its tests run with the
// pack that owns it. This config covers the frozen shell's own main and
// renderer tests.
export default defineConfig({
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
          include: ["src/renderer/src/**/*.test.{ts,tsx}"],
          setupFiles: ["src/renderer/src/test/setup.ts"],
        },
      },
    ],
  },
});
