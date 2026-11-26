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
const browserNode = fileURLToPath(new URL("./src/sync/browserNode.ts", import.meta.url));
const browserSyncDesktop = fileURLToPath(
  new URL("./src/sync/browserSyncDesktop.ts", import.meta.url),
);

export default defineConfig({
  // The config lives with the pack, but the command runs from the app so no
  // `node_modules` appears under `pack/`. Pin the root so `include` stays pack-only,
  // and keep Vitest's cache with the build output.
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../.dev/vitest", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      "@suite/document-runtime": documentRuntime,
      "@suite/pack-runtime": runtime,
      "@suite/sync-desktop": browserSyncDesktop,
      "@suite/sync/node": browserNode,
      "@suite/ui": ui,
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/renderer/test/setup.ts"],
    testTimeout: 20_000,
  },
});
