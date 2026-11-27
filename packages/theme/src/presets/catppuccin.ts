import type { ThemeValues } from "../roles.js";
import type { SuiteTheme } from "../theme.js";

/**
 * Catppuccin — the official Mocha and Latte palettes, with the yellow accent.
 *
 * The pastel roles are the canonical Catppuccin values. Where a pastel would fail the
 * package's contrast floors as text or as a mark on a light surface, the role uses the
 * nearest darker Catppuccin tone rather than inventing a hue: Latte's yellow becomes
 * `#a86400` for the focus ring, its green `#2e7d20` for a section mark, and the faint ink is
 * `#53566d` so it still clears 4.5:1 on `surface-strong`.
 *
 * Light maps base → canvas, mantle → surface, crust → surface-sunk and surface0 →
 * surface-strong, so cards keep the same raised/recessed order as every other preset. Dark
 * maps base → canvas, surface0 → surface, crust → surface-sunk and surface1 →
 * surface-strong. Mocha keeps the yellow accent; Latte uses the official mauve, because the
 * Latte yellow is too low-contrast to read as an action on the pale surfaces.
 */
export const catppuccin: SuiteTheme = {
  format: "suite.theme",
  contractVersion: 1,
  id: "catppuccin",
  name: "Catppuccin",
  description: "The official Mocha and Latte palettes, with the yellow accent.",
  light: {
    canvas: "#eff1f5",
    surface: "#e6e9ef",
    "surface-sunk": "#dce0e8",
    "surface-strong": "#ccd0da",
    accent: "#8839ef",
    "accent-strong": "#7228d9",
    danger: "#c50d35",
    success: "#40a02b",
    warning: "#df8e1d",
    ink: "#4c4f69",
    "ink-muted": "#5c5f77",
    "ink-faint": "#53566d",
    hairline: "#ccd0da",
    "border-strong": "#6c6f85",
    focus: "#7228d9",
    "on-accent": "#eff1f5",
    "on-danger": "#eff1f5",
    "on-success": "#1e1e2e",
    "on-warning": "#1e1e2e",
    "hue-slate": "#6c6f85",
    "hue-blue": "#1e66f5",
    "hue-green": "#2e7d20",
    "hue-amber": "#a86400",
    "hue-rose": "#d20f39",
    "hue-violet": "#8839ef",
    "chart-1": "#a86400",
    "chart-2": "#2e7d20",
    "chart-3": "#1e66f5",
    "chart-4": "#8839ef",
    "chart-5": "#d20f39",
  } satisfies ThemeValues,
  dark: {
    canvas: "#1e1e2e",
    surface: "#313244",
    "surface-sunk": "#11111b",
    "surface-strong": "#45475a",
    accent: "#f9e2af",
    "accent-strong": "#f9e2af",
    danger: "#f38ba8",
    success: "#a6e3a1",
    warning: "#f9e2af",
    ink: "#cdd6f4",
    "ink-muted": "#a6adc8",
    "ink-faint": "#bac2de",
    hairline: "#45475a",
    "border-strong": "#9399b2",
    focus: "#f9e2af",
    "on-accent": "#1e1e2e",
    "on-danger": "#1e1e2e",
    "on-success": "#1e1e2e",
    "on-warning": "#1e1e2e",
    "hue-slate": "#9399b2",
    "hue-blue": "#89b4fa",
    "hue-green": "#a6e3a1",
    "hue-amber": "#f9e2af",
    "hue-rose": "#f38ba8",
    "hue-violet": "#cba6f7",
    "chart-1": "#f9e2af",
    "chart-2": "#a6e3a1",
    "chart-3": "#89b4fa",
    "chart-4": "#cba6f7",
    "chart-5": "#f38ba8",
  } satisfies ThemeValues,
};
