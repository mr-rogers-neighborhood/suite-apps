import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The package's unit tests: jsdom, the same setup file every component test uses, and the
 * theme resolved from source so `pnpm test` does not depend on a sibling package's stale
 * `dist/`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@suite/theme": fileURLToPath(new URL("../theme/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/testSetup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "src/**/*.stories.*"],
  },
});
