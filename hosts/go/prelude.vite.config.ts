import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

/**
 * Builds the pack's bridge prelude as one ES module.
 *
 * It is built separately from Planner's renderer on purpose: the prelude needs `@suite/go`'s frame
 * client and its own `LoroDoc`, neither of which Planner's bundle exports. Running it second, with
 * `emptyOutDir: false`, leaves Vite's own output (`index.html`, hashed JS/CSS/WASM) untouched.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./planner", import.meta.url)),
  base: "./",
  plugins: [wasm()],
  resolve: {
    alias: {
      "@suite/go": fileURLToPath(new URL("./packages/go/src/index.ts", import.meta.url)),
    },
  },
  optimizeDeps: {
    // Pre-bundling Loro breaks the URL its wasm-bindgen entry fetches.
    exclude: ["loro-crdt"],
  },
  build: {
    outDir: fileURLToPath(new URL("./planner-dist", import.meta.url)),
    emptyOutDir: false,
    target: "es2022",
    // The pack's CSP allows `connect-src 'self'`, so the wasm must be fetched from the pack's own
    // URL. Library mode inlines assets, and an inlined `data:` URL is refused by that policy — the
    // prelude then never finishes evaluating, which reads as a blank Planner rather than a policy
    // problem. A plain rollup entry emits the wasm beside the module instead.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: fileURLToPath(new URL("./planner/prelude.ts", import.meta.url)),
      output: {
        entryFileNames: "prelude.js",
        format: "es",
        codeSplitting: false,
      },
    },
  },
});
