import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const reactDir = dirname(require.resolve("react/package.json"));
const reactDomDir = dirname(require.resolve("react-dom/package.json"));
const graph = fileURLToPath(new URL("../../../legacy/canvas/packages/graph/src/index.ts", import.meta.url));
const runtime = fileURLToPath(
  new URL("../../../packages/pack-runtime/src/index.ts", import.meta.url),
);

export default defineConfig({
  // The config lives with the pack, but the command runs from the app so no `node_modules`
  // appears under `pack/`. Pin the root so `include` stays pack-only, and keep Vitest's cache with
  // the build output.
  root: fileURLToPath(new URL(".", import.meta.url)),
  cacheDir: fileURLToPath(new URL("../.dev/vitest", import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: join(reactDir, "index.js") },
      { find: /^react\/(.*)$/, replacement: join(reactDir, "$1") },
      { find: /^react-dom$/, replacement: join(reactDomDir, "index.js") },
      { find: /^react-dom\/(.*)$/, replacement: join(reactDomDir, "$1") },
      { find: "@suite/graph", replacement: graph },
      { find: "@suite/pack-runtime", replacement: runtime },
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["../../../legacy/canvas/src/test/setup.ts"],
    testTimeout: 30_000,
  },
});
