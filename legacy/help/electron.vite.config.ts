import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";

const renderer = fileURLToPath(new URL("../../packs/help/pack/src/renderer", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@suite/desktop"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      // A sandboxed preload is a CommonJS script; the app package is ESM for the
      // main process, so name the output explicitly rather than letting the
      // package type choose `.mjs`.
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    // The renderer source is the pack's, so both builds compile the same files. The desktop
    // entry keeps its own `index.html` beside it; only the router differs from the pack entry.
    root: renderer,
    // The production window is served from `suite-help://app/`; a root-relative base keeps
    // module and asset URLs at the origin root on every SPA route.
    base: "/",
    publicDir: fileURLToPath(new URL("../../packs/help/public", import.meta.url)),
    plugins: [
      fumadocsMdx(),
      react(),
      tailwindcss(),
      {
        // electron-vite's preset forces `./` for a packaged renderer. This app is
        // served from `suite-help://app/`, where a route-relative asset URL would
        // look for `/handbook/assets/...`; the origin root is the correct base.
        name: "suite-help-root-base",
        enforce: "post",
        config: () => ({ base: "/" }),
      },
    ],
    resolve: { alias: { "@": renderer, "@renderer": renderer } },
    build: {
      // electron-vite's default entry is `<app>/src/renderer/index.html`; the
      // renderer entry now lives in the pack tree, so name it explicitly.
      rollupOptions: {
        input: fileURLToPath(
          new URL("../../packs/help/pack/src/renderer/index.html", import.meta.url),
        ),
      },
    },
  },
});
