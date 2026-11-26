import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vitest/config";

/**
 * The package's tests in two projects: the unit suite in jsdom and the stories in a real
 * browser. The Storybook dev server starts Vitest with this config, so the story project has
 * to live here — otherwise the MCP `test-run` tool and the manager's test panel find no
 * project to run. `pnpm test` scopes itself to the unit project; `test:stories` keeps its
 * standalone config for the gate.
 */
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss(), wasm()],
  resolve: {
    alias: {
      "@suite/theme": path.join(root, "../theme/src/index.ts"),
    },
  },
  optimizeDeps: {
    // Loro ships a wasm-bindgen entry; pre-bundling it breaks the wasm URL on the pack
    // workbench stories.
    exclude: ["loro-crdt"],
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          setupFiles: ["./src/testSetup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "src/**/*.stories.*"],
        },
      },
      {
        extends: true,
        plugins: [await storybookTest({ configDir: path.join(root, ".storybook") })],
        test: {
          name: `storybook:${path.join(root, ".storybook")}`,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
