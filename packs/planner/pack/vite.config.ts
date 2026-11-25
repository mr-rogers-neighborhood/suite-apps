import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

/**
 * Builds Planner's own renderer and its bridge into `packs/planner/.dev/pack`.
 *
 * The renderer under `src/renderer/` is the pack's source; the frozen Electron shell builds that
 * same tree and keeps no copy of its own. The shell writes its own `out/`, so this config owns a
 * directory of its own and never repoints `electron-vite`. The entry is the pack's page: it loads
 * `src/main.ts`, which installs the bridge over the host's `window.suite` and then imports the
 * renderer. One entry, so no script-injection step is needed after Vite writes the page.
 *
 * The output and Vite's cache sit outside `pack/` on purpose: `pack/` is source, and
 * `scripts/pack-shape.mjs` fails the gate if a generated directory appears in it.
 */
const packRoot = fileURLToPath(new URL(".", import.meta.url));
const outputRoot = new URL("../.dev/", import.meta.url);

export default defineConfig({
  root: packRoot,
  base: "./",
  cacheDir: fileURLToPath(new URL("vite", outputRoot)),
  plugins: [react(), tailwindcss(), wasm()],
  optimizeDeps: {
    // Loro ships a wasm-bindgen entry; pre-bundling it breaks the wasm URL.
    exclude: ["loro-crdt"],
  },
  build: {
    outDir: fileURLToPath(new URL("pack", outputRoot)),
    emptyOutDir: true,
    target: "es2022",
    // The pack's CSP allows its own assets and no `data:` script or asset. A plain file beside the
    // module is what the policy can fetch.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
