import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const core = fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@suite/budget-core": core } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
