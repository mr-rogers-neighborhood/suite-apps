import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const core = fileURLToPath(new URL("../packages/core/src/index.ts", import.meta.url));
const runtime = fileURLToPath(
  new URL("../../../packages/pack-runtime/src/index.ts", import.meta.url),
);

export default defineConfig({
  // The config lives with the pack, but the command runs from the app so no
  // `node_modules` appears under `pack/`. Pin the root so `include` stays pack-only,
  // and keep Vitest's cache with the build output.
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../.dev/vitest", import.meta.url)),
  resolve: { alias: { "@suite/budget-core": core, "@suite/pack-runtime": runtime } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
