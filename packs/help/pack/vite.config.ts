import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fumadocsMdx } from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

/**
 * Builds Help's renderer into `packs/help/.dev/pack`.
 *
 * The normal Electron build writes `legacy/help/out`, so this config owns a directory of its own and
 * never repoints `electron-vite`. It builds the shared renderer under `src/renderer` — the pack adds
 * only an entry with hash routing — and copies the generated `public/data` the explorer fetches.
 *
 * The output, Vite's cache and the fumadocs cache sit outside `pack/` on purpose: `pack/` is source,
 * and `scripts/pack-shape.mjs` fails the gate if a generated directory appears in it. The `defineDocs`
 * dir in `src/source.ts` reaches the generated handbook at the Help package root, beside this pack
 * rather than inside it.
 */
const packRoot = fileURLToPath(new URL(".", import.meta.url));
const renderer = fileURLToPath(new URL("./src/renderer", import.meta.url));
const outputRoot = new URL("../.dev/", import.meta.url);

export default defineConfig({
  root: packRoot,
  base: "./",
  cacheDir: fileURLToPath(new URL("vite", outputRoot)),
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
  plugins: [fumadocsMdx(), react(), tailwindcss()],
  resolve: {
    alias: [
      // `defineDocs.dir` is relative to the Vite root (the pack). This thin loader is used only
      // because the shared renderer's root is one level deeper; both name the same docs.
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
