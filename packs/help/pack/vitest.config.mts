import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vitest/config";

const packRoot = fileURLToPath(new URL(".", import.meta.url));
const renderer = fileURLToPath(new URL("../../../legacy/help/src/renderer/src", import.meta.url));

export default defineConfig({
  // The config lives with the pack, but the command runs from the app so no `node_modules` appears
  // under `pack/`. Pin the root so `include` stays pack-only, and keep Vitest's cache with the build
  // output.
  root: packRoot,
  cacheDir: fileURLToPath(new URL("../../../legacy/help/.dev/vitest", import.meta.url)),
  plugins: [fumadocsMdx(), react()],
  resolve: {
    alias: [
      {
        find: /^@\/lib\/source$/,
        replacement: fileURLToPath(new URL("./src/source.ts", import.meta.url)),
      },
      { find: /^@\//, replacement: `${renderer}/` },
      { find: /^@renderer\//, replacement: `${renderer}/` },
    ],
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    testTimeout: 20_000,
  },
});
