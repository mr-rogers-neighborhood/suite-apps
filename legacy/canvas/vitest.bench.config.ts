import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["../packs/canvas/packages/graph/bench/**/*.bench.ts"],
    benchmark: {
      include: ["../packs/canvas/packages/graph/bench/**/*.bench.ts"],
    },
  },
});
