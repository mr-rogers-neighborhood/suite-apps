import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { searchForWorkspaceRoot } from "vite";
import wasm from "vite-plugin-wasm";

const config: StorybookConfig = {
  stories: [
    "../src/**/*.stories.@(ts|tsx)",
    "./workbench/**/*.stories.@(ts|tsx)",
    "./workbench/**/*.mdx",
    // The pack slice is deliberately narrow: one workbench surface per pack, not the 48
    // stories Canvas already keeps in its own Storybook.
    "../../../packs/*/pack/src/renderer/workbench/*.stories.@(ts|tsx)",
    "../../../packs/canvas/src/workbench/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest",
    "@storybook/addon-mcp",
    "storybook-addon-mock-date",
  ],
  features: {
    // The docs toolset reads this manifest; it is what lets an agent ask for a
    // component's real props instead of guessing them.
    componentsManifest: true,
  },
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  async viteFinal(viteConfig) {
    viteConfig.plugins = [...(viteConfig.plugins ?? []), tailwindcss(), wasm()];
    // The pack slice lives outside this package. Vite's dev server serves only the project
    // root by default, so the one workbench has to allow the workspace root as well.
    viteConfig.server = {
      ...viteConfig.server,
      fs: {
        ...viteConfig.server?.fs,
        allow: [
          searchForWorkspaceRoot(process.cwd()),
          ...(viteConfig.server?.fs?.allow ?? []),
        ],
      },
    };
    // Loro ships a wasm-bindgen entry; pre-bundling it breaks the wasm URL on the pack
    // workbench stories.
    viteConfig.optimizeDeps = {
      ...viteConfig.optimizeDeps,
      exclude: [...(viteConfig.optimizeDeps?.exclude ?? []), "loro-crdt"],
    };
    // Stories build without asking the workspace to have built `@suite/theme` first. The
    // package's published entry is still what a consumer resolves; this is the test surface.
    viteConfig.resolve = {
      ...viteConfig.resolve,
      alias: {
        ...(viteConfig.resolve?.alias as Record<string, string> | undefined),
        "@suite/theme": fileURLToPath(new URL("../../theme/src/index.ts", import.meta.url)),
      },
    };
    return viteConfig;
  },
};

export default config;
