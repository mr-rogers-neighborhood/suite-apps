import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const reactDir = dirname(require.resolve("react/package.json"));
const reactDomDir = dirname(require.resolve("react-dom/package.json"));
const graph = fileURLToPath(
  new URL("../packages/graph/src/index.ts", import.meta.url),
);
const importer = fileURLToPath(
  new URL("../packages/import-obsidian/src/index.ts", import.meta.url),
);
const runtime = fileURLToPath(
  new URL("../../../packages/pack-runtime/src/index.ts", import.meta.url),
);
const sync = fileURLToPath(
  new URL("../../../services/relay/packages/protocol/src/index.ts", import.meta.url),
);
const ui = fileURLToPath(new URL("../../../packages/ui/src/index.ts", import.meta.url));

export default defineConfig({
  // The config lives with the pack, but the command runs from the app so no `node_modules`
  // appears under `pack/`. Pin the root so `include` stays pack-only, and keep Vitest's cache with
  // the build output.
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../.dev/vitest", import.meta.url)),
  server: { fs: { allow: [fileURLToPath(new URL("../../..", import.meta.url))] } },
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: join(reactDir, "index.js") },
      { find: /^react\/(.*)$/, replacement: join(reactDir, "$1") },
      { find: /^react-dom$/, replacement: join(reactDomDir, "index.js") },
      { find: /^react-dom\/(.*)$/, replacement: join(reactDomDir, "$1") },
      { find: "@suite/graph", replacement: graph },
      { find: "@suite/import-obsidian", replacement: importer },
      { find: "@suite/pack-runtime", replacement: runtime },
      { find: "@suite/sync", replacement: sync },
      { find: "@suite/ui", replacement: ui },
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}", "../src/**/*.test.{ts,tsx}"],
    setupFiles: ["../src/test/setup.ts"],
    testTimeout: 30_000,
  },
});
