import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const renderer = fileURLToPath(new URL("./src/renderer/src", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "main",
          environment: "node",
          include: ["src/main/**/*.test.ts"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias: { "@": renderer, "@renderer": renderer } },
        test: {
          name: "renderer",
          environment: "jsdom",
          css: true,
          include: ["src/renderer/src/**/*.test.{ts,tsx}"],
        },
      },
      {
        test: {
          name: "scripts",
          environment: "node",
          include: ["scripts/**/*.test.mjs"],
        },
      },
    ],
  },
});
