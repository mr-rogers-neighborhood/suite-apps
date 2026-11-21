import { useEffect, useState } from "react";

import {
  readStoredTheme,
  setThemeChoice,
  type ThemeChoice,
  type ThemeMode,
  themeOptions,
} from "@/theme";

/**
 * Theme and brightness, in the navigator footer.
 *
 * Two questions in the order they are asked — a palette family, then how bright to draw it.
 * A `select` rather than a custom menu: this is one control in a sidebar, and the platform
 * control already works with a keyboard and a screen reader.
 */
const MODES: readonly { readonly value: ThemeMode; readonly label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function ThemeControl({ compact = false }: { readonly compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(() =>
    readStoredTheme(typeof window === "undefined" ? undefined : window.localStorage),
  );

  // A preset chosen in another window is not a promise this one makes, so the store is the
  // source and this only mirrors it after a change here.
  useEffect(() => {
    setChoice(readStoredTheme(window.localStorage));
  }, []);

  const apply = (next: ThemeChoice) => {
    setThemeChoice(next);
    setChoice(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-2 text-[11px] text-fd-muted-foreground">
        <span className={compact ? "sr-only" : "w-14 shrink-0"}>Theme</span>
        <select
          aria-label="Theme"
          value={choice.preset}
          onChange={(event) => apply({ ...choice, preset: event.target.value })}
          className="min-w-0 flex-1 rounded-md border border-fd-border bg-fd-background px-1.5 py-1 text-[11px] text-fd-foreground"
        >
          {themeOptions().map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[11px] text-fd-muted-foreground">
        <span className={compact ? "sr-only" : "w-14 shrink-0"}>Brightness</span>
        <select
          aria-label="Brightness"
          value={choice.mode}
          onChange={(event) => apply({ ...choice, mode: event.target.value as ThemeMode })}
          className="min-w-0 flex-1 rounded-md border border-fd-border bg-fd-background px-1.5 py-1 text-[11px] text-fd-foreground"
        >
          {MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
