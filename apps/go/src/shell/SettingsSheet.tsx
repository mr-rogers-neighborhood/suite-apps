import { useEffect } from "react";
import { type GoThemeChoice, type ThemeSource, themeOptions } from "../host/theme.js";

/**
 * Settings on the phone.
 *
 * The two controls the host owns: how bright to draw, and which palette family. Suite is
 * first and the default, so a person who never opens this sheet sees what they saw before.
 * A pack has no equivalent control; it renders with the tokens this host resolves.
 */
export function SettingsSheet({
  open,
  choice,
  onChange,
  onClose,
}: {
  readonly open: boolean;
  readonly choice: GoThemeChoice;
  readonly onChange: (choice: GoThemeChoice) => void;
  readonly onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close settings backdrop"
        className="fixed inset-0 bg-black/40 backdrop-blur-xs"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="relative z-10 flex max-h-[85vh] flex-col gap-4 rounded-t-2xl border-t border-[var(--hairline)] bg-[var(--canvas)] p-5 shadow-2xl"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-[var(--hairline)]" aria-hidden="true" />

        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-semibold text-[var(--ink)]">Settings</h2>
          <button
            type="button"
            className="touch flex items-center justify-center rounded-xl p-2 text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ink-muted)]">
          <span>Brightness</span>
          <select
            aria-label="Brightness"
            className="touch w-full rounded-xl border border-[var(--hairline)] bg-[var(--surface-sunk)] px-3 text-[16px] text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            value={choice.mode}
            onChange={(event) => onChange({ ...choice, mode: event.target.value as ThemeSource })}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">Follow the system</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ink-muted)]">
          <span>Theme</span>
          <select
            aria-label="Theme"
            className="touch w-full rounded-xl border border-[var(--hairline)] bg-[var(--surface-sunk)] px-3 text-[16px] text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            value={choice.preset}
            onChange={(event) => onChange({ ...choice, preset: event.target.value })}
          >
            {themeOptions().map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="touch rounded-xl bg-[var(--accent)] px-5 text-[15px] font-medium text-[var(--on-accent)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  );
}
