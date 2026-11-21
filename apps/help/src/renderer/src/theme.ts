import {
  applyTheme,
  colorSchemeFor,
  DEFAULT_THEME_ID,
  PRESETS,
  presetById,
  type SuiteTheme,
} from "@suite/theme";

/**
 * Which preset and which mode this window draws.
 *
 * The same pair Planner and Budget offer: a **preset** is a palette family, a **mode** is how
 * bright to draw it. Both are device preferences, so they live in `localStorage` and never
 * change what anyone else sees. The values reach CSS as `var(--role)`, and `styles.css` points
 * the Fumadocs names at those roles.
 */
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export interface ThemeChoice {
  readonly preset: string;
  readonly mode: ThemeMode;
}

export const THEME_STORAGE_KEY = "suite.theme";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** The preset a stored id names, or the default when it names one this build does not ship. */
export function presetFor(id: unknown): string {
  return typeof id === "string" && presetById(id) !== null ? id : DEFAULT_THEME_ID;
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/** Read the stored choice, tolerating a partial or hand-edited record. */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeChoice {
  const fallback: ThemeChoice = { preset: DEFAULT_THEME_ID, mode: "system" };
  const stored = storage?.getItem(THEME_STORAGE_KEY);
  if (stored === null || stored === undefined) return fallback;
  if (isThemeMode(stored)) return { preset: DEFAULT_THEME_ID, mode: stored };
  try {
    const parsed = JSON.parse(stored) as { preset?: unknown; mode?: unknown };
    return {
      preset: presetFor(parsed.preset),
      mode: isThemeMode(parsed.mode) ? parsed.mode : "system",
    };
  } catch {
    return fallback;
  }
}

/** The presets, for a picker. */
export function themeOptions(): readonly SuiteTheme[] {
  return PRESETS;
}

/**
 * Paint a preset onto the document.
 *
 * `data-theme` carries the preset id and `data-theme-mode` the resolved mode, so a rule that
 * wants to know which family is on can ask, and no rule ever has to ask whether "system" is
 * dark today. The `.dark` class is kept for the Fumadocs `dark:` variant and for code samples
 * written against it; it is written here, in the same pass as the attributes.
 */
function paintTheme(choice: ThemeChoice, mode: ResolvedTheme): void {
  const preset = presetById(choice.preset) ?? presetById(DEFAULT_THEME_ID);
  const root = document.documentElement;
  if (preset !== null) applyTheme(preset, mode, root);
  root.dataset.theme = choice.preset;
  root.dataset.themeMode = mode;
  root.dataset.mode = mode;
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = colorSchemeFor(mode);
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches
    : true;
}

/**
 * Apply the stored choice and keep "system" in step with the desktop.
 *
 * Returns a cleanup, so a test can restore the listener.
 */
export function initTheme(): () => void {
  const choice = readStoredTheme(typeof window === "undefined" ? undefined : window.localStorage);
  paintTheme(choice, resolveTheme(choice.mode, prefersDark()));

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const now = readStoredTheme(window.localStorage);
    if (now.mode === "system") paintTheme(now, resolveTheme("system", media.matches));
  };
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Store a choice and repaint. The one place a preference is written. */
export function setThemeChoice(choice: ThemeChoice): void {
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(choice));
  paintTheme(choice, resolveTheme(choice.mode, prefersDark()));
}

/** The mode the document is actually painted in right now. */
export function resolvedTheme(): ResolvedTheme {
  return document.documentElement.dataset.themeMode === "dark" ? "dark" : "light";
}

/**
 * Run `listener` whenever the painted mode changes.
 *
 * The theme is painted onto the document rather than held in React, so a code view that needs
 * the resolved mode watches the attribute instead of keeping a second copy of the choice.
 */
export function observeResolvedTheme(listener: (mode: ResolvedTheme) => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(() => listener(resolvedTheme()));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme-mode"],
  });
  return () => observer.disconnect();
}
