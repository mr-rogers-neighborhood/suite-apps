import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * The React island inside the vanilla chrome.
 *
 * The host chrome is still `shell.js`; this build produces one ES module and its
 * stylesheet for the strip that has moved to React. `emptyOutDir` is false because
 * `scripts/stage.mjs` writes the legacy page into the same directory, and `base`
 * is relative because the host serves the page from `suite-chrome://`.
 */
export default defineConfig({
  base: "./",
  // React keeps `process.env.NODE_ENV` checks in its production build. A library build
  // does not touch `process`, and the chrome page has no Node global, so replace it here.
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: false,
    target: "es2022",
    lib: {
      entry: fileURLToPath(new URL("src/renderer/react/tab-bar.tsx", import.meta.url)),
      formats: ["es"],
      fileName: () => "tab-bar.js",
    },
    rollupOptions: {
      output: {
        assetFileNames: "tab-bar.[ext]",
      },
    },
  },
});
