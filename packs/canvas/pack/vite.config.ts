import { cpSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import wasm from "vite-plugin-wasm";

/**
 * Builds Canvas's own renderer and the pack prelude into `packs/canvas/.dev/pack`.
 *
 * The normal Electron build writes `legacy/canvas/dist`, so this config owns a directory of its own
 * and never repoints `electron-vite`. The entry is the pack's page: it loads `src/main.ts`, which
 * installs `window.suiteDesktop` over the host's `window.suite` and then imports the renderer. One
 * entry, so no script-injection step is needed after Vite writes the page.
 *
 * The output and Vite's cache sit outside `pack/` on purpose: `pack/` is source, and
 * `scripts/pack-shape.mjs` fails the gate if a generated directory appears in it.
 */
const packRoot = fileURLToPath(new URL(".", import.meta.url));
const outputRoot = new URL("../.dev/", import.meta.url);
const outDir = fileURLToPath(new URL("pack", outputRoot));
const require = createRequire(import.meta.url);

/**
 * Excalidraw's own web fonts, served from this origin.
 *
 * The sketch surface asks for `fonts/<Family>/<file>.woff2` beside whatever base
 * `window.EXCALIDRAW_ASSET_PATH` names. Without them every sketch's text draws in a fallback face
 * and the pack's `font-src 'self'` refuses the CDN it would otherwise ask. They are copied beside
 * the assets, as the Electron build does, rather than inlined: a font is never a `data:` URL the
 * pack's policy would have to allow.
 */
function excalidrawFonts(): Plugin {
  return {
    name: "suite:excalidraw-fonts",
    writeBundle() {
      const fonts = join(dirname(require.resolve("@excalidraw/excalidraw")), "fonts");
      cpSync(fonts, join(outDir, "fonts"), { recursive: true });
    },
  };
}

export default defineConfig({
  root: packRoot,
  base: "./",
  // The app's public files (the asset-path script and the favicon) travel into the pack.
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  cacheDir: fileURLToPath(new URL("vite", outputRoot)),
  plugins: [react(), tailwindcss(), wasm(), excalidrawFonts()],
  define: {
    // There is one local profile; the delete surface in the Workspace menu reads this switch.
    "import.meta.env.VITE_SUITE_MODE": JSON.stringify("standalone"),
  },
  resolve: {
    alias: {
      // The schema, document layer and importer are the pack's own; build them from source so
      // a stale `dist` can never describe a document the pack does not write.
      "@suite/graph": fileURLToPath(
        new URL("../../../legacy/canvas/packages/graph/src/index.ts", import.meta.url),
      ),
      "@suite/import-obsidian": fileURLToPath(
        new URL("../../../legacy/canvas/packages/import-obsidian/src/index.ts", import.meta.url),
      ),
      "@suite/sync": fileURLToPath(
        new URL("../../../services/relay/packages/protocol/src/index.ts", import.meta.url),
      ),
      "@suite/ui": fileURLToPath(new URL("../../../packages/ui/src/index.ts", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    // Loro ships a wasm-bindgen entry; pre-bundling it breaks the wasm URL.
    exclude: ["loro-crdt"],
  },
  build: {
    outDir,
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
