import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

/**
 * Builds Help's renderer into `apps/help/.dev/pack`.
 *
 * The normal Electron build writes `apps/help/out`, so this config owns a directory of its own and
 * never repoints `electron-vite`. It builds the app's existing renderer — the pack adds only an
 * entry with hash routing — and copies the generated `public/data` the explorer fetches.
 *
 * The output, Vite's cache and the fumadocs cache sit outside `pack/` on purpose: `pack/` is source,
 * and `scripts/pack-shape.mjs` fails the gate if a generated directory appears in it.
 */
const packRoot = fileURLToPath(new URL(".", import.meta.url));
const renderer = fileURLToPath(new URL("../src/renderer/src", import.meta.url));
const outputRoot = new URL("../.dev/", import.meta.url);

export default defineConfig({
  root: packRoot,
  base: "./",
  cacheDir: fileURLToPath(new URL("vite", outputRoot)),
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [fumadocsMdx(), react(), tailwindcss()],
  resolve: {
    alias: [
      // `defineDocs.dir` is relative to the Vite root. The pack root is `pack/`, so the handbook
      // needs a source file beside it whose `dir` climbs one level rather than two.
      {
        find: /^@\/lib\/source$/,
        replacement: fileURLToPath(new URL("./src/source.ts", import.meta.url)),
      },
      { find: /^@\//, replacement: `${renderer}/` },
      { find: /^@renderer\//, replacement: `${renderer}/` },
    ],
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
