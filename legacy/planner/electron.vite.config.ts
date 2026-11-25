import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const core = fileURLToPath(new URL("../../packages/planner-core/src/index.ts", import.meta.url));
// Planner's renderer belongs to the pack. The shell builds the same source it ships as a pack, so
// this app has no second copy and no renderer tree of its own.
const renderer = fileURLToPath(new URL("../../packs/planner/pack/src/renderer", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@suite/planner-core", "@suite/desktop"] })],
    resolve: { alias: { "@suite/planner-core": core } },
    build: {
      // The wasm-bindgen glue requires a snippet file next to the module; leave it to Node.
      rollupOptions: { external: ["loro-crdt"] },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: renderer,
    // electron-vite looks for `<project>/src/renderer/index.html` by default. The renderer page
    // lives in the pack now, so name it explicitly rather than keeping a stub here.
    build: {
      rolldownOptions: {
        input: fileURLToPath(
          new URL("../../packs/planner/pack/src/renderer/index.html", import.meta.url),
        ),
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@suite/planner-core": core } },
    optimizeDeps: {
      // Loro ships a wasm-bindgen entry; pre-bundling it breaks the wasm URL in dev.
      exclude: ["loro-crdt"],
    },
  },
});
