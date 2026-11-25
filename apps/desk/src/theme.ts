import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ThemeMode } from "@suite/theme";
import {
  cssVariables,
  DEFAULT_THEME_ID,
  defaultTheme,
  PRESETS,
  presetById,
  type SuiteTheme,
} from "@suite/theme";
import type { ThemeView } from "./shared.js";

/**
 * Which theme the host draws, and where the answer lives.
 *
 * A theme is a property of the host, not of the pack a person happens to be looking at. Suite
 * Shell owns the choice on desktop (Suite Go owns its own on mobile), stores it beside the
 * rest of the host profile, and paints every pack view with the result. A pack has no theme
 * setting and no theme state of its own.
 *
 * Two independent choices: a **preset** (a palette family) and a **mode** (how bright to draw
 * it). "Solarized at night" is Solarized with dark values, not a sixth entry in the dropdown,
 * so the stored record is a pair and the View menu has two controls.
 */
export type ThemeSource = "system" | "light" | "dark";

export interface HostThemeChoice {
  /** A preset id from `@suite/theme`. */
  readonly preset: string;
  readonly mode: ThemeSource;
}

export const DEFAULT_THEME_CHOICE: HostThemeChoice = {
  preset: DEFAULT_THEME_ID,
  mode: "system",
};

const THEME_FILENAME = "theme.json";

export function isThemeSource(value: unknown): value is ThemeSource {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * The preset a stored id names, or the default when it names one this build does not ship.
 *
 * `presetById` follows the package's rename map, so a device that stored `logseq` opens Warm
 * rather than a theme with no values.
 */
export function presetFor(id: string | null | undefined): string {
  if (id === null || id === undefined) return DEFAULT_THEME_CHOICE.preset;
  return presetById(id)?.id ?? DEFAULT_THEME_CHOICE.preset;
}

/** Whether a value is a pair this host can apply, for a menu click or a file record. */
export function isHostThemeChoice(value: unknown): value is HostThemeChoice {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.preset === "string" && isThemeSource(record.mode);
}

/** The palette list the dropdown shows, in the order the package lists it. */
export function themeOptions(): readonly SuiteTheme[] {
  return PRESETS;
}

/**
 * Read what was chosen, falling back rather than failing: a bad file is not an error.
 *
 * Field by field, so a record written by an older build that knew only a mode keeps that
 * mode and gains the default preset.
 */
export async function loadThemeChoice(dataRoot: string): Promise<HostThemeChoice> {
  try {
    const raw = JSON.parse(await readFile(join(dataRoot, THEME_FILENAME), "utf8")) as {
      preset?: unknown;
      mode?: unknown;
    };
    return {
      preset: presetFor(typeof raw.preset === "string" ? raw.preset : null),
      mode: isThemeSource(raw.mode) ? raw.mode : DEFAULT_THEME_CHOICE.mode,
    };
  } catch {
    return DEFAULT_THEME_CHOICE;
  }
}

/** Record a choice. A failure to persist is reported to the caller, never swallowed here. */
export async function saveThemeChoice(dataRoot: string, choice: HostThemeChoice): Promise<void> {
  await mkdir(dataRoot, { recursive: true });
  const path = join(dataRoot, THEME_FILENAME);
  // Through a temporary file: a half-written preference is not a preference, and the
  // previous one is better than a truncated one.
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(choice, null, 2)}\n`);
  await rename(temporary, path);
}

/** The one mode a choice resolves to. `system` is a choice, never a value on the page. */
export function resolveMode(choice: HostThemeChoice, shouldUseDarkColors: boolean): ThemeMode {
  if (choice.mode === "system") return shouldUseDarkColors ? "dark" : "light";
  return choice.mode;
}

/**
 * The host's answer, ready for the chrome and for every pack view.
 *
 * The preset is resolved by the package, so a stored alias cannot reach a view as an id with
 * no values behind it.
 */
export function resolveThemeView(choice: HostThemeChoice, shouldUseDarkColors: boolean): ThemeView {
  const mode = resolveMode(choice, shouldUseDarkColors);
  const preset = presetById(choice.preset) ?? defaultTheme();
  return {
    preset: preset.id,
    mode,
    values: { ...cssVariables(preset, mode) },
  };
}

/**
 * The stylesheet a pack view receives.
 *
 * Only the resolved tokens and `color-scheme`: the host does not import a pack's stylesheet or
 * guess at its class names. The chrome and every pack read the same variables, so a theme
 * change moves all of them together.
 */
export function themeCss(theme: ThemeView): string {
  const variables = Object.entries(theme.values)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
  return `:root { color-scheme: ${theme.mode}; ${variables} }`;
}

/**
 * The part of a pack view the theme touches.
 *
 * Electron's `WebContents` satisfies this; a test can pass a recorder. Keeping the seam
 * explicit is what lets the headless suite prove that a theme change reaches an already
 * painted view instead of only testing the two strings it is built from.
 */
export interface ThemeSurface {
  insertCSS(css: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
  executeJavaScript(script: string): Promise<unknown>;
}

/**
 * Paint one resolved theme onto a pack view, replacing a previous sheet.
 *
 * `insertCSS` is additive, so the new sheet goes in before the old key is removed. The
 * script carries the attributes a class-based stylesheet keys off; both halves are the
 * host's own resolved answer, never data read back from the pack.
 */
export async function paintThemeSurface(
  surface: ThemeSurface,
  theme: ThemeView,
  previousKey?: string,
): Promise<string> {
  const key = await surface.insertCSS(themeCss(theme));
  await surface.executeJavaScript(themeAttributesScript(theme));
  if (previousKey !== undefined && previousKey !== key) {
    await surface.removeInsertedCSS(previousKey).catch(() => undefined);
  }
  return key;
}

/**
 * The attributes a pack's document carries after the host paints it.
 *
 * A stylesheet that keys off `.dark` — Canvas and Help both do — needs the class as well as
 * the values. This is a constant string built from the host's own resolved answer, not data
 * read back from the pack.
 */
export function themeAttributesScript(theme: ThemeView): string {
  return [
    "(() => {",
    "const root = document.documentElement;",
    `root.dataset.theme = ${JSON.stringify(theme.preset)};`,
    `root.dataset.themeMode = ${JSON.stringify(theme.mode)};`,
    `root.classList.toggle("dark", ${theme.mode === "dark" ? "true" : "false"});`,
    `root.style.colorScheme = ${JSON.stringify(theme.mode)};`,
    "})();",
  ].join(" ");
}
