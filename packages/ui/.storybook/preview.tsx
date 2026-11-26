import type { Decorator, Preview } from "@storybook/react-vite";
import {
  applyScale,
  applyTheme,
  DEFAULT_DENSITY,
  defaultTheme,
  DENSITIES,
  type Density,
  isThemeMode,
  presetById,
  type ThemeMode,
} from "@suite/theme";
import { useLayoutEffect } from "react";
import "./storybook.css";

/**
 * Paint the host's token layers on the story document before it is measured.
 *
 * This is the piece that makes a story mean something: without it a component's colours are
 * whatever a fallback happened to be. The toolbar switches the whole surface between presets
 * and modes without a component changing, which is the token contract made visible in the
 * browser rather than argued in a comment.
 */
const withTokens: Decorator = (Story, context) => {
  const preset = typeof context.globals.theme === "string" ? context.globals.theme : "suite";
  const rawMode = context.globals.mode;
  const mode: ThemeMode = isThemeMode(rawMode) ? rawMode : "light";
  const rawDensity = context.globals.density;
  const density: Density = DENSITIES.includes(rawDensity as Density)
    ? (rawDensity as Density)
    : DEFAULT_DENSITY;

  useLayoutEffect(() => {
    const root = document.documentElement;
    applyTheme(presetById(preset) ?? defaultTheme(), mode, root);
    applyScale(density, root);
    root.classList.toggle("dark", mode === "dark");
    // Native scrollbars and form controls follow the document's scheme, the way the host sets it.
    root.style.colorScheme = mode;
  }, [preset, mode, density]);

  return (
    <div className="min-h-screen bg-[var(--canvas)] p-8 text-[var(--ink)]">
      <Story />
    </div>
  );
};

const preview: Preview = {
  decorators: [withTokens],
  initialGlobals: { theme: "suite", mode: "light", density: DEFAULT_DENSITY },
  globalTypes: {
    theme: {
      description: "Theme preset",
      toolbar: {
        icon: "paintbrush",
        items: [
          { value: "suite", title: "Suite" },
          { value: "solarized", title: "Solarized" },
          { value: "warm", title: "Warm" },
        ],
        dynamicTitle: true,
      },
    },
    mode: {
      description: "Theme mode",
      toolbar: {
        icon: "circlehollow",
        items: [
          { value: "light", title: "Light" },
          { value: "dark", title: "Dark" },
        ],
        dynamicTitle: true,
      },
    },
    density: {
      description: "Control density",
      toolbar: {
        icon: "ruler",
        items: [
          { value: "compact", title: "Compact" },
          { value: "cozy", title: "Cozy" },
          { value: "comfortable", title: "Comfortable" },
        ],
        dynamicTitle: true,
      },
    },
  },
  parameters: {
    // Every story is a test. An axe violation fails it instead of waiting for someone to open
    // the accessibility panel, which is the only version of this check that stays true.
    a11y: { test: "error" },
    backgrounds: { disable: true },
    layout: "fullscreen",
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
