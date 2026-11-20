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
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/graph/src/**", "src/**"],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.stories.*",
        "**/dist/**",
        "src/test/**",
        "**/*.d.ts",
        "**/*.css",
      ],
      // Only `@suite/graph` is gated: it has a real suite of behavioural tests.
      // `server` and `canvas` are measured and printed but not gated, so nobody
      // is tempted to add assertion-free tests just to clear a number.
      // A glob key (not a per-project block) is what vitest 5 actually honours —
      // per-project `test.coverage` is accepted by the types but ignored at runtime.
      thresholds: {
        "packages/graph/src/**": {
          statements: 85,
          branches: 74,
          functions: 93,
          lines: 90,
        },
      },
    },
    projects: [
      {
        test: {
          name: "graph",
          environment: "node",
          include: ["packages/graph/src/**/*.test.ts"],
        },
      },
      {
        // The Obsidian importer reads a vault into a document, so its suite
        // needs the graph's real CRDT and nothing else.
        test: {
          name: "importer",
          environment: "node",
          include: ["packages/import-obsidian/src/**/*.test.ts"],
        },
      },
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
        test: {
          name: "canvas",
          environment: "jsdom",
          include: ["src/**/*.test.{ts,tsx}"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});
