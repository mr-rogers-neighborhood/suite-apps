import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Stories as tests, the way Canvas does it.
 *
 * `storybookTest` reads `.storybook/main.ts` and turns every CSF file into a Vitest entry. A
 * real headless Chromium gives `play` layout, focus and event dispatch that jsdom lacks, and
 * the preview's `a11y: { test: "error" }` turns an axe violation into a failing test.
 */
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@suite/theme": path.join(root, "../theme/src/index.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        plugins: [await storybookTest({ configDir: path.join(root, ".storybook") })],
        test: {
          name: "stories",
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
