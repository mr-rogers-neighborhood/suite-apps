import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const core = fileURLToPath(new URL("../../../legacy/budget/packages/core/src/index.ts", import.meta.url));
const renderer = fileURLToPath(new URL("../../../legacy/budget/src/renderer/src", import.meta.url));
const runtime = fileURLToPath(
  new URL("../../../packages/pack-runtime/src/index.ts", import.meta.url),
);

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  // The config lives with the pack, but the command runs from the app so no
  // `node_modules` appears under `pack/`. Pin the root so `include` stays pack-only,
  // and keep Vitest's cache with the build output.
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { fs: { allow: [repoRoot] } },
  cacheDir: fileURLToPath(new URL("../.dev/vitest", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@suite/budget-core": core,
      "@suite/pack-runtime": runtime,
      "@renderer": renderer,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["../../../legacy/budget/src/renderer/src/test/setup.ts"],
    testTimeout: 20_000,
  },
});
