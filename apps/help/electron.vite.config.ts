import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { fumadocsMdx } from "fumadocs-mdx/vite";

const renderer = fileURLToPath(new URL("./src/renderer/src", import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@suite/desktop"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    // The production window is served from `suite-help://app/`; a root-relative base keeps
    // module and asset URLs at the origin root on every SPA route.
    base: "/",
    publicDir: fileURLToPath(new URL("./public", import.meta.url)),
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
  },
});
