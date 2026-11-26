import type { SuiteTheme } from "../theme.js";
import { solarized } from "./solarized.js";
import { suite } from "./suite.js";
import { warm } from "./warm.js";

/**
 * The themes that ship inside the package.
 *
 * Order is the order the picker shows, and the first is the default. Suite is first because it
 * is the default look: warm paper, near-black ink and one burnt-orange accent. Warm is the
 * charcoal-and-amber variant and Solarized the low-glare canonical palette, so the host's
 * dropdown has one order everywhere. A stored choice keeps its own preset.
 *
 * Presets live in code rather than in a directory on disk for this pass. A preset cannot be
 * corrupted, cannot be half-written, and is the same three themes in every app at every
 * version. Authoring a theme and sharing it across apps is a later pass, and when it lands
 * these become the built-ins that a disk theme can override.
 */
export const PRESETS: readonly SuiteTheme[] = [suite, warm, solarized];

/** The id every app falls back to. */
export const DEFAULT_THEME_ID = "suite";

/**
 * Stored ids that named a preset before it was renamed.
 *
 * A selection is remembered on a device. Renaming `logseq` to `warm` must not make an
 * existing choice resolve to nothing, so every read of a stored id passes through
 * `resolveThemeId` before it looks a preset up. The map is one-way: `warm` is the id this
 * build writes from now on.
 */
export const THEME_ID_ALIASES: Readonly<Record<string, string>> = {
  logseq: "warm",
};

/** The id this build ships a stored selection under, following any rename. */
export function resolveThemeId(id: string): string {
  return THEME_ID_ALIASES[id] ?? id;
}

/** One preset by id, or null when nothing ships under that name. */
export function presetById(id: string): SuiteTheme | null {
  const resolved = resolveThemeId(id);
  return PRESETS.find((theme) => theme.id === resolved) ?? null;
}

/** The default preset, which is never null because the list is not empty. */
export function defaultTheme(): SuiteTheme {
  return presetById(DEFAULT_THEME_ID) ?? suite;
}
