import type { ThemeValues } from "../roles.js";
import type { SuiteTheme } from "../theme.js";

/**
 * Suite — warm neutral paper, near-black ink, a monochrome accent.
 *
 * The default borrows macOS's quiet, layered neutrals and Heptabase's monochrome shell: the
 * action is an ink-black button, not a coloured one, and the warmth comes from the paper and
 * the ink rather than from an accent hue. The six section hues stay muted so a card can wear
 * one without turning the page into a rainbow.
 *
 * Warm carries the burnt-orange version of this look; Catppuccin and Solarized are the two
 * named palettes.
 */
export const suite: SuiteTheme = {
  format: "suite.theme",
  contractVersion: 1,
  id: "suite",
  name: "Suite",
  description: "Warm neutral paper, near-black ink and a monochrome accent.",
  light: {
    canvas: "#f6f4f1",
    surface: "#fcfbf9",
    "surface-sunk": "#eeebe6",
    "surface-strong": "#ffffff",
    accent: "#1f1e1c",
    "accent-strong": "#000000",
    danger: "#a83228",
    success: "#3f6b3a",
    warning: "#8a5a12",
    ink: "#1c1a18",
    "ink-muted": "#5f5a54",
    "ink-faint": "#6d675f",
    hairline: "#e6e1da",
    "border-strong": "#8c857c",
    focus: "#1c1a18",
    "on-accent": "#fcfbf9",
    "on-danger": "#fffdf9",
    "on-success": "#fffdf9",
    "on-warning": "#fffdf9",
    "hue-slate": "#6b6660",
    "hue-blue": "#2f6f9f",
    "hue-green": "#3f6b3a",
    "hue-amber": "#8a5a12",
    "hue-rose": "#a33a4e",
    "hue-violet": "#6b5490",
    "chart-1": "#1f1e1c",
    "chart-2": "#3f6b3a",
    "chart-3": "#8a5a12",
    "chart-4": "#6b5490",
    "chart-5": "#a33a4e",
  } satisfies ThemeValues,
  dark: {
    canvas: "#1b1917",
    surface: "#24211e",
    "surface-sunk": "#12100e",
    "surface-strong": "#2c2824",
    accent: "#f3efe9",
    "accent-strong": "#ffffff",
    danger: "#f0a19a",
    success: "#9ccf9e",
    warning: "#e8c27a",
    ink: "#f3efe9",
    "ink-muted": "#b7afa5",
    "ink-faint": "#9c9388",
    hairline: "#36312b",
    "border-strong": "#8a8072",
    focus: "#f3efe9",
    "on-accent": "#1b1917",
    "on-danger": "#171411",
    "on-success": "#171411",
    "on-warning": "#171411",
    "hue-slate": "#a79d8f",
    "hue-blue": "#8db8d9",
    "hue-green": "#9ccf9e",
    "hue-amber": "#e8b87a",
    "hue-rose": "#e7a0a6",
    "hue-violet": "#c0a6e0",
    "chart-1": "#f3efe9",
    "chart-2": "#9ccf9e",
    "chart-3": "#e8b87a",
    "chart-4": "#c0a6e0",
    "chart-5": "#e7a0a6",
  } satisfies ThemeValues,
};
