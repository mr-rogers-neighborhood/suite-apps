import { cssVariables, defaultTheme } from "@suite/theme";
import type { ResolvedTheme } from "./shared.js";

/**
 * The palette the hub draws.
 *
 * Start is not the host: Suite Shell owns a person's theme on desktop, and Go owns it on a
 * phone. The hub therefore offers no picker and stores no choice. It still paints the default
 * Suite palette, resolved against the desktop's brightness, so its own chrome follows light
 * and dark rather than being stuck in the stylesheet's fallback.
 */
export function resolveTheme(shouldUseDarkColors: boolean): ResolvedTheme {
  const mode = shouldUseDarkColors ? "dark" : "light";
  const preset = defaultTheme();
  return { preset: preset.id, mode, values: cssVariables(preset, mode) };
}
