import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// Budget's renderer belongs to the pack. The frozen shell builds the same source the pack
// ships, so this app has no second copy and no renderer tree of its own.
const packRoot = fileURLToPath(new URL("../../packs/budget/pack", import.meta.url));
const renderer = fileURLToPath(new URL("../../packs/budget/pack/src/renderer", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@suite/budget-core", "@suite/desktop"] })],
    build: {
      // The wasm-bindgen glue requires a snippet file next to the module; leave it to Node.
      rollupOptions: { external: ["loro-crdt"] },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: packRoot,
    // electron-vite looks for `<project>/src/renderer/index.html` by default. The renderer page
    // lives at the pack root, so name it explicitly rather than keeping a stub here.
    build: {
      rolldownOptions: {
        input: fileURLToPath(new URL("../../packs/budget/pack/index.html", import.meta.url)),
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@renderer": renderer } },
    optimizeDeps: {
      // Loro ships a wasm-bindgen entry; pre-bundling it breaks the wasm URL in dev.
      exclude: ["loro-crdt"],
    },
  },
});
