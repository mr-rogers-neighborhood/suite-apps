import type { ColorScheme, ThemeDensity, ThemeTokens } from "@suite/go";
import {
  applyScale,
  applyTheme,
  colorSchemeFor,
  cssVariables,
  DEFAULT_THEME_ID,
  defaultTheme,
  PRESETS,
  presetById,
  type SuiteTheme,
} from "@suite/theme";

/**
 * The palette belongs to `@suite/theme`, not to this app.
 *
 * Suite Go is the host on a phone, so the theme is a property of this app rather than of the
 * pack a person opened. The choice is stored with the rest of the host profile and resolved
 * once at the root; a mounted pack reads variables and never chooses a palette.
 *
 * Everything here is wiring: resolve which mode the phone is in, hand the theme and the mode
 * to the suite's `applyTheme`, and keep our own density as an attribute. No colour is named in
 * this file, and none should ever be.
 */

export const DENSITIES: readonly ThemeDensity[] = ["compact", "cozy", "comfortable"];

export const DEFAULT_DENSITY: ThemeDensity = "comfortable";

const DENSITY_KEY = "suite-go:shell:density";

/** The two controls in Settings: a preset family and how bright to draw it. */
export type ThemeSource = "system" | "light" | "dark";

export interface GoThemeChoice {
  readonly preset: string;
  readonly mode: ThemeSource;
}

/** The host profile's theme record, beside the density it already keeps. */
const THEME_KEY = "suite-go:shell:theme";

export const DEFAULT_GO_THEME_CHOICE: GoThemeChoice = {
  preset: DEFAULT_THEME_ID,
  mode: "system",
};

export function isThemeSource(value: unknown): value is ThemeSource {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * The preset a stored id names, or the default when it names one this build does not ship.
 *
 * `presetById` follows the package's rename map, so a stored `logseq` becomes Warm rather
 * than a theme with no values.
 */
export function presetFor(id: string | null | undefined): string {
  if (id === null || id === undefined) return DEFAULT_GO_THEME_CHOICE.preset;
  return presetById(id)?.id ?? DEFAULT_GO_THEME_CHOICE.preset;
}

/** Whether a value is a pair this host can apply. */
export function isGoThemeChoice(value: unknown): value is GoThemeChoice {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.preset === "string" && isThemeSource(record.mode);
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

/** Read the host profile's choice, tolerating a partial or hand-edited record. */
export function readThemeChoice(source: StorageLike | undefined = storage()): GoThemeChoice {
  const stored = source?.getItem(THEME_KEY);
  if (stored === null || stored === undefined) return DEFAULT_GO_THEME_CHOICE;
  try {
    const parsed = JSON.parse(stored) as { preset?: unknown; mode?: unknown };
    return {
      preset: presetFor(typeof parsed.preset === "string" ? parsed.preset : null),
      mode: isThemeSource(parsed.mode) ? parsed.mode : DEFAULT_GO_THEME_CHOICE.mode,
    };
  } catch {
    return DEFAULT_GO_THEME_CHOICE;
  }
}

/** Write the host profile's choice. The one place a theme preference is stored. */
export function writeThemeChoice(
  choice: GoThemeChoice,
  target: StorageLike | undefined = storage(),
): void {
  target?.setItem(THEME_KEY, JSON.stringify(choice));
}

/** The one mode a choice resolves to. `system` is a choice, never a value on the page. */
export function resolveMode(choice: GoThemeChoice, prefersDark: boolean): "light" | "dark" {
  if (choice.mode === "system") return prefersDark ? "dark" : "light";
  return choice.mode;
}

function preferredMode(): "light" | "dark" {
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The preset and resolved mode a choice names. */
export function resolvePreset(choice: GoThemeChoice): {
  readonly preset: SuiteTheme;
  readonly mode: "light" | "dark";
} {
  return {
    preset: presetById(choice.preset) ?? defaultTheme(),
    mode: resolveMode(choice, preferredMode() === "dark"),
  };
}

/** The dropdown's list, from the presets this build ships, in package order. */
export function themeOptions(): readonly SuiteTheme[] {
  return PRESETS;
}

/** What a choice resolves to, as the tokens a mounted pack asks for. */
export function tokensFor(
  choice: GoThemeChoice,
  prefersDark: boolean,
  density: ThemeDensity = readDensity(),
): ThemeTokens {
  const preset = presetById(choice.preset) ?? defaultTheme();
  const mode = resolveMode(choice, prefersDark);
  return {
    scheme: colorSchemeFor(mode) as ColorScheme,
    density,
    cssVariables: cssVariables(preset, mode),
  };
}

/** What the theme resolves to right now, for anything that needs values rather than paint. */
export function resolveTheme(density: ThemeDensity = readDensity()): ThemeTokens {
  return tokensFor(readThemeChoice(), preferredMode() === "dark", density);
}

/** Paint a choice onto the document and return its tokens. Idempotent. */
export function paintTheme(choice: GoThemeChoice = readThemeChoice()): ThemeTokens {
  const { preset, mode } = resolvePreset(choice);
  applyTheme(preset, mode, document.documentElement);
  document.documentElement.classList.toggle("dark", mode === "dark");
  applyDensity(readDensity());
  announceTheme();
  return tokensFor(choice, preferredMode() === "dark", readDensity());
}

/** Store a choice and repaint. Returns the tokens the next mounted pack will read. */
export function setThemeChoice(choice: GoThemeChoice): ThemeTokens {
  writeThemeChoice(choice);
  return paintTheme(choice);
}

/** Repaint when the phone switches between light and dark, and only while following it. */
export function watchColorScheme(onChange: (tokens: ThemeTokens) => void): () => void {
  const query = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => undefined;
  const listener = () => {
    if (readThemeChoice().mode !== "system") return;
    onChange(paintTheme());
  };
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function readDensity(): ThemeDensity {
  const stored = storage()?.getItem(DENSITY_KEY);
  return DENSITIES.includes(stored as ThemeDensity) ? (stored as ThemeDensity) : DEFAULT_DENSITY;
}

export function applyDensity(density: ThemeDensity): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.density = density;
    applyScale(density, document.documentElement);
  }
  storage()?.setItem(DENSITY_KEY, density);
  announceTheme();
}

/** Tell an open pack iframe to copy the painted tokens again. */
function announceTheme(): void {
  if (typeof globalThis.dispatchEvent !== "function" || typeof Event !== "function") return;
  globalThis.dispatchEvent(new Event("suite:theme"));
}
