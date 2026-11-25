import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const runtime = fileURLToPath(
  new URL("../../../packages/pack-runtime/src/index.ts", import.meta.url),
);
const ui = fileURLToPath(new URL("../../../packages/ui/src/index.ts", import.meta.url));
const documentRuntime = fileURLToPath(
  new URL("../../../packages/document-runtime/src/index.ts", import.meta.url),
);

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  // The config lives with the pack, but the command runs from the package so no
  // `node_modules` appears under `pack/`. Pin the root so each project's
  // `include` is read from the pack directory, and keep Vitest's cache with the
  // build output. The core project points one level up at the pack-owned
  // `@suite/budget-core`, so its tests run with the pack that owns them.
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { fs: { allow: [repoRoot] } },
  cacheDir: fileURLToPath(new URL("../.dev/vitest", import.meta.url)),
  test: {
    testTimeout: 20_000,
    projects: [
      {
        test: {
          name: "core",
          environment: "node",
          include: ["../packages/core/src/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: {
            "@suite/pack-runtime": runtime,
            "@suite/ui": ui,
            "@suite/document-runtime": documentRuntime,
          },
        },
        test: {
          name: "pack",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["./src/renderer/test/setup.ts"],
        },
      },
    ],
  },
});
