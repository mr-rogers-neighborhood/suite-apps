import type { ThemeDensity } from "@suite/go";
import { useEffect, useState } from "react";
import type { ConsentView } from "../host/consent.js";
import { DENSITIES, type GoThemeChoice, type ThemeSource, themeOptions } from "../host/theme.js";
import { formatBytes } from "./Catalogue.js";

/**
 * One installed app, as Settings → Apps shows it.
 *
 * The host renders this from the manifest it installed and the consent record it
 * keeps. It is not the pack drawing into the host: name, version, publisher,
 * size, date and answers are all host facts.
 */
export interface SettingsApp {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly publisher: string;
  readonly sizeBytes: number;
  readonly installedAt: number;
  readonly permissions: readonly ConsentView[];
}

/**
 * Settings on the phone.
 *
 * Theme stays as it is. Apps is the host's own list: what is installed, what it
 * was granted or refused, and one confirmation to remove it. Removing closes its
 * tabs in the shell and leaves its documents alone, because the container never
 * owned them.
 */
export function SettingsSheet({
  open,
  choice,
  density,
  onChange,
  onDensityChange,
  apps,
  onRemoveApp,
  onReask,
  onClose,
}: {
  readonly open: boolean;
  readonly choice: GoThemeChoice;
  readonly density: ThemeDensity;
  readonly onChange: (choice: GoThemeChoice) => void;
  readonly onDensityChange: (density: ThemeDensity) => void;
  readonly apps: readonly SettingsApp[];
  readonly onRemoveApp: (id: string) => void;
  /** Clear one remembered answer and ask again, from the app's own row. */
  readonly onReask: (app: SettingsApp, permission: ConsentView) => void;
  readonly onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

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
        className="relative z-10 flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-t-2xl border-t border-[var(--hairline)] bg-[var(--canvas)] p-5 shadow-2xl"
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

        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-[var(--ink-muted)]">
          <span>Density</span>
          <select
            aria-label="Density"
            className="touch w-full rounded-xl border border-[var(--hairline)] bg-[var(--surface-sunk)] px-3 text-[16px] text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            value={density}
            onChange={(event) => onDensityChange(event.target.value as ThemeDensity)}
          >
            {DENSITIES.map((value) => (
              <option key={value} value={value}>
                {value === "compact" ? "Compact" : value === "cozy" ? "Cozy" : "Comfortable"}
              </option>
            ))}
          </select>
        </label>

        <section aria-labelledby="settings-apps" className="flex flex-col gap-2">
          <h3 id="settings-apps" className="text-[13px] font-medium text-[var(--ink-muted)]">
            Apps
          </h3>
          {apps.length === 0 ? (
            <p className="text-[14px] text-[var(--ink-muted)]">
              No app is installed yet. Browse the catalogue on Home.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {apps.map((app) => (
                <li key={app.id} className="settings-app">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-[16px] font-medium text-[var(--ink)]">{app.name}</span>
                    <span className="text-[13px] text-[var(--ink-muted)]">v{app.version}</span>
                    <span className="text-[13px] text-[var(--ink-muted)]">by {app.publisher}</span>
                    <span className="text-[13px] text-[var(--ink-muted)]">
                      {formatBytes(app.sizeBytes)} · installed {formatDate(app.installedAt)}
                    </span>
                  </div>

                  {app.permissions.length === 0 ? null : (
                    <ul className="mt-1 flex flex-col gap-1" aria-label={`${app.name} permissions`}>
                      {app.permissions.map((permission) => (
                        <li
                          key={permission.capability}
                          className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--ink-muted)]"
                        >
                          <span>
                            {permission.capability}: {permission.answer}
                          </span>
                          {permission.answer === "granted" ? null : (
                            <button
                              type="button"
                              className="touch settings-app-reask text-[13px] underline"
                              onClick={() => onReask(app, permission)}
                            >
                              Ask again
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {confirming === app.id ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <p className="min-w-0 flex-1 text-[14px] text-[var(--ink)]">
                        Remove {app.name}? Its tabs close and its documents stay on this device.
                      </p>
                      <button
                        type="button"
                        className="touch rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)]"
                        onClick={() => setConfirming(null)}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="touch rounded-xl bg-[var(--accent)] px-4 text-[15px] font-medium text-[var(--on-accent)]"
                        onClick={() => {
                          setConfirming(null);
                          onRemoveApp(app.id);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="touch mt-2 rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)]"
                      onClick={() => setConfirming(app.id)}
                    >
                      Remove {app.name}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

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

function formatDate(at: number): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString().slice(0, 10);
}
