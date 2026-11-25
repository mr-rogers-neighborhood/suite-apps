import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Builds Budget's renderer and the pack prelude into `packs/budget/.dev/pack`.
 *
 * The renderer under `pack/src/renderer/` is the one source: the frozen Electron
 * shell in `legacy/budget/` builds this same source and keeps the last artifact.
 * Both the renderer and the prelude are entries of one build: Rollup emits
 * `prelude.js` beside Vite's hashed assets, and `scripts/budget-pack.mjs` puts
 * that script in front of the app script in the generated page.
 *
 * The output and Vite's cache sit outside `pack/` on purpose: `pack/` is source,
 * and `scripts/pack-shape.mjs` fails the gate if a generated directory appears
 * in it.
 */
const packRoot = fileURLToPath(new URL(".", import.meta.url));
const outputRoot = new URL("../.dev/", import.meta.url);

export default defineConfig({
  root: packRoot,
  base: "./",
  cacheDir: fileURLToPath(new URL("vite", outputRoot)),
  plugins: [react(), tailwindcss()],
  // The pack has no static directory of its own; the entry is the only document.
  publicDir: false,
  optimizeDeps: {
    // Loro ships a wasm-bindgen entry; pre-bundling it breaks the wasm URL.
    exclude: ["loro-crdt"],
  },
  build: {
    outDir: fileURLToPath(new URL("pack", outputRoot)),
    emptyOutDir: true,
    target: "es2022",
    // The pack's CSP allows its own assets and no `data:` script or asset. A
    // plain file beside the module is what the policy can fetch.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        prelude: fileURLToPath(new URL("./src/prelude.ts", import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "prelude" ? "prelude.js" : "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
