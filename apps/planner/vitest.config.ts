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
        resolve: { alias: { "@suite/planner-core": core } },
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.test.ts"],
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
      {
        // The pack's bridge adapter. Node, because it is about persistence and ownership, not DOM:
        // a jsdom document here would only make the boundary harder to see.
        resolve: { alias: { "@suite/planner-core": core } },
        test: {
          name: "pack",
          environment: "node",
          include: ["pack/src/**/*.test.ts"],
        },
      },
    ],
  },
});
