import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const reactDir = dirname(require.resolve("react/package.json"));
const reactDomDir = dirname(require.resolve("react-dom/package.json"));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^react$/, replacement: join(reactDir, "index.js") },
      { find: /^react\/(.*)$/, replacement: join(reactDir, "$1") },
      { find: /^react-dom$/, replacement: join(reactDomDir, "index.js") },
      { find: /^react-dom\/(.*)$/, replacement: join(reactDomDir, "$1") },
    ],
    dedupe: ["react", "react-dom"],
  },
  test: {
    // CRDT convergence tests move whole documents between peers and run in
    // parallel with the canvas project; the 5 s default produced a load-induced
    // timeout (9.7 s, passed on rerun). 15 s still fails a genuine hang.
    testTimeout: 15_000,
    projects: [
      {
        // The desktop shell's main process: the lock, the file store, recovery
        // and the page policy. Node, and no Electron, because none of it needs a
        // window — which is what makes it testable at all.
        test: {
          name: "desktop",
          environment: "node",
          include: ["desktop/src/**/*.test.ts"],
        },
      },
      {
        // The scripts are Node programs, and the doc-index generator is the one
        // of them with a rule worth pinning: a page cannot be dated before the
        // commit that carries it exists.
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.ts"],
        },
      },
    ],
  },
});
