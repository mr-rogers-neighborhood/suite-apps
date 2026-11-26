import { useEffect, useState } from "react";
import { DENSITIES, DENSITY_LABELS, type Density, PRESETS, type ThemeMode } from "@suite/theme";
import { Button } from "../Button.js";
import { cx } from "../cx.js";
import { PackCard, type PackStatus } from "./PackCard.js";

/**
 * First run.
 *
 * A host surface, not a pack and not a Screen: choose the apps, choose how Suite looks, watch
 * them install, then hand the person to an empty Home. The host owns the catalogue, the theme
 * and the installer; this component owns the question and its progress.
 */
export type FirstRunStep = "apps" | "appearance" | "install";
export type FirstRunMode = ThemeMode | "system";

export interface FirstRunPack {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly version?: string;
  readonly status?: PackStatus;
  /** What the catalogue showed: who signed it and which capabilities it declares. */
  readonly publisher?: string;
  readonly capabilities?: readonly string[];
}

export interface FirstRunTheme {
  readonly preset: string;
  /** `system` keeps following the OS; the host resolves light or dark for the paint. */
  readonly mode: FirstRunMode;
  readonly density: Density;
}

export interface FirstRunInstall {
  readonly id: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface FirstRunRow {
  readonly id: string;
  readonly state: "queued" | "installing" | "installed" | "failed";
  readonly detail: string;
}

export interface FirstRunProps {
  readonly packs: readonly FirstRunPack[];
  readonly theme: FirstRunTheme;
  readonly onThemeChange: (theme: FirstRunTheme) => void;
  /** Install one pack. The component calls these concurrently, one per selected pack. */
  readonly onInstall: (id: string) => Promise<FirstRunInstall>;
  /** Leave the wizard. The host shows the empty Home only after this returns. */
  readonly onComplete: () => void | Promise<void>;
  /** Story and resumed-flow seams; the host omits both on a fresh install. */
  readonly initialStep?: FirstRunStep;
  readonly initialSelected?: readonly string[];
  readonly initialRows?: readonly FirstRunRow[];
}

const PRESET_OPTIONS: readonly { readonly id: string; readonly label: string }[] = PRESETS.map(
  (theme) => ({ id: theme.id, label: theme.name }),
);
const MODES: readonly { readonly id: FirstRunMode; readonly label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Follow the system" },
];
const DENSITY_OPTIONS: readonly { readonly id: Density; readonly label: string }[] =
  DENSITIES.map((density) => ({ id: density, label: DENSITY_LABELS[density] }));

function StepRail({ step }: { readonly step: FirstRunStep }) {
  const steps: readonly { readonly id: FirstRunStep; readonly label: string }[] = [
    { id: "apps", label: "Apps" },
    { id: "appearance", label: "Look" },
    { id: "install", label: "Install" },
  ];
  return (
    <ol aria-label="Setup steps" className="m-0 flex list-none flex-wrap items-center gap-2 p-0">
      {steps.map((item, index) => {
        const active = item.id === step;
        return (
          <li key={item.id} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cx(
                "flex h-6 w-6 items-center justify-center rounded-full text-[length:var(--text-caption,11px)]",
                active
                  ? "bg-[var(--accent)] text-[var(--on-accent)]"
                  : "bg-[var(--surface-sunk)] text-[var(--ink-muted)]",
              )}
            >
              {index + 1}
            </span>
            <span
              className={cx(
                "text-[length:var(--text-label,12px)]",
                active ? "text-[var(--ink)]" : "text-[var(--ink-muted)]",
              )}
            >
              {item.label}
            </span>
            {index < steps.length - 1 ? (
              <span aria-hidden="true" className="text-[var(--ink-faint)]">
                /
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function Choice({
  label,
  selected,
  onClick,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        "inline-flex h-[var(--control-height-sm)] items-center rounded-md border px-[var(--control-padding-x-sm)] text-[length:var(--text-label,12px)]",
        selected
          ? "border-[var(--accent)] bg-[var(--surface-strong)] text-[var(--ink)]"
          : "border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink-muted)]",
      )}
    >
      {label}
    </button>
  );
}

function Appearance({
  theme,
  onThemeChange,
}: {
  readonly theme: FirstRunTheme;
  readonly onThemeChange: (theme: FirstRunTheme) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[length:var(--text-title,15px)] font-semibold normal-case text-[var(--ink)]">
          Palette
        </h2>
        <div className="mt-2 flex flex-wrap gap-[var(--control-gap)]">
          {PRESET_OPTIONS.map((preset) => (
            <Choice
              key={preset.id}
              label={preset.label}
              selected={theme.preset === preset.id}
              onClick={() => onThemeChange({ ...theme, preset: preset.id })}
            />
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-[length:var(--text-title,15px)] font-semibold normal-case text-[var(--ink)]">
          Brightness
        </h2>
        <div className="mt-2 flex flex-wrap gap-[var(--control-gap)]">
          {MODES.map((mode) => (
            <Choice
              key={mode.id}
              label={mode.label}
              selected={theme.mode === mode.id}
              onClick={() => onThemeChange({ ...theme, mode: mode.id })}
            />
          ))}
        </div>
      </div>
      <div>
        <h2 className="text-[length:var(--text-title,15px)] font-semibold normal-case text-[var(--ink)]">
          Density
        </h2>
        <p className="mt-1 text-[length:var(--text-label,12px)] text-[var(--ink-muted)]">
          How much room controls and lists get. The type stays the same.
        </p>
        <div className="mt-2 flex flex-wrap gap-[var(--control-gap)]">
          {DENSITY_OPTIONS.map((density) => (
            <Choice
              key={density.id}
              label={density.label}
              selected={theme.density === density.id}
              onClick={() => onThemeChange({ ...theme, density: density.id })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function InstallReview({ packs }: { readonly packs: readonly FirstRunPack[] }) {
  return (
    <aside aria-label="What this installs" className="flex flex-col gap-[var(--control-gap)]">
      <h2 className="text-[length:var(--text-title,15px)] font-semibold normal-case text-[var(--ink)]">
        What this installs
      </h2>
      <div className="rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-[var(--control-padding-x)]">
        {packs.length === 0 ? (
          <p className="text-[length:var(--text-label,12px)] text-[var(--ink-muted)]">
            No apps selected. You can add them later from Home&apos;s Edit.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[var(--control-gap)] p-0">
            {packs.map((pack) => (
              <li
                key={pack.id}
                className="rounded-lg border border-[var(--hairline)] bg-[var(--surface-sunk)] p-[var(--control-padding-x)]"
              >
                <div className="flex items-center gap-[var(--control-gap)]">
                  <span
                    aria-hidden="true"
                    className="flex h-[var(--control-height-sm)] w-[var(--control-height-sm)] shrink-0 items-center justify-center rounded-md border border-[var(--hairline)] bg-[var(--surface)] text-[length:var(--text-label,12px)] text-[var(--accent)]"
                  >
                    {pack.name.trim().slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-[length:var(--text-title,15px)] text-[var(--ink)]">
                    {pack.name}
                  </span>
                  {pack.version === undefined ? null : (
                    <span className="text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
                      v{pack.version}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[length:var(--text-caption,11px)] text-[var(--ink-muted)]">
                  {pack.id}
                  {pack.publisher === undefined ? "" : ` · ${pack.publisher}`}
                </p>
                <div className="mt-2 flex flex-wrap gap-[var(--control-gap-sm)]">
                  {(pack.capabilities ?? []).length === 0 ? (
                    <span className="rounded-full border border-[var(--hairline)] px-[var(--control-padding-x-sm)] py-0.5 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
                      no capabilities
                    </span>
                  ) : (
                    (pack.capabilities ?? []).map((capability) => (
                      <span
                        key={capability}
                        className="rounded-full border border-[var(--hairline)] px-[var(--control-padding-x-sm)] py-0.5 text-[length:var(--text-caption,11px)] text-[var(--ink-muted)]"
                      >
                        {capability}
                      </span>
                    ))
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}

function InstallList({
  packs,
  rows,
}: {
  readonly packs: readonly FirstRunPack[];
  readonly rows: readonly FirstRunRow[];
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row) => {
        const pack = packs.find((candidate) => candidate.id === row.id);
        const percent = row.state === "installed" ? 100 : row.state === "installing" ? 62 : 0;
        return (
          <li
            key={row.id}
            className="flex items-center gap-[var(--control-gap)] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-[var(--control-padding-x)]"
          >
            <span
              aria-hidden="true"
              className="flex h-[var(--control-height)] w-[var(--control-height)] shrink-0 items-center justify-center rounded-md bg-[var(--surface-sunk)] text-[length:var(--text-title,15px)] text-[var(--ink-muted)]"
            >
              {(pack?.name ?? row.id).slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[length:var(--text-title,15px)] text-[var(--ink)]">
                {pack?.name ?? row.id}
              </span>
              <span className="mt-0.5 block text-[length:var(--text-caption,11px)] text-[var(--ink-muted)]">
                {row.detail}
              </span>
              {row.state === "installing" ? (
                <span
                  role="progressbar"
                  aria-label={`Installing ${pack?.name ?? row.id}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunk)]"
                >
                  <span
                    className="block h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${percent}%` }}
                  />
                </span>
              ) : null}
            </span>
            <span
              className={cx(
                "shrink-0 text-[length:var(--text-caption,11px)]",
                row.state === "failed" ? "text-[var(--danger)]" : "text-[var(--ink-muted)]",
              )}
            >
              {row.state === "failed" ? "Failed" : row.state === "installed" ? "Done" : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function FirstRun({
  packs,
  theme,
  onThemeChange,
  onInstall,
  onComplete,
  initialStep = "apps",
  initialSelected,
  initialRows,
}: FirstRunProps) {
  const [step, setStep] = useState<FirstRunStep>(initialStep);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(initialSelected ?? []),
  );
  /**
   * The host can mount the wizard before its catalogue scan answers, so the pack list may
   * arrive on a later paint. Until the person touches the selection, every pack that appears
   * is chosen; a card they clicked stays their answer.
   */
  const [followPacks, setFollowPacks] = useState(initialSelected === undefined);
  const [rows, setRows] = useState<readonly FirstRunRow[]>(initialRows ?? []);
  const [busy, setBusy] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!followPacks) return;
    setSelected(new Set(packs.filter((pack) => pack.status !== "installed").map((pack) => pack.id)));
  }, [followPacks, packs]);

  const chosen = packs.filter((pack) => selected.has(pack.id));

  function toggle(id: string) {
    setFollowPacks(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function install(ids: readonly string[]) {
    setBusy(true);
    await Promise.all(
      ids.map(async (id) => {
        setRows((current) =>
          current.map((row) => (row.id === id ? { ...row, state: "installing", detail: "Installing…" } : row)),
        );
        try {
          const result = await onInstall(id);
          setRows((current) =>
            current.map((row) =>
              row.id === id
                ? {
                    ...row,
                    state: result.ok ? "installed" : "failed",
                    detail: result.detail,
                  }
                : row,
            ),
          );
        } catch (error) {
          setRows((current) =>
            current.map((row) =>
              row.id === id
                ? {
                    ...row,
                    state: "failed",
                    detail: error instanceof Error ? error.message : "The install was refused.",
                  }
                : row,
            ),
          );
        }
      }),
    );
    setBusy(false);
  }

  async function finish() {
    setBusy(true);
    setCompleteError(null);
    try {
      await onComplete();
    } catch (error) {
      setCompleteError(
        error instanceof Error ? error.message : "The host could not finish setup.",
      );
    } finally {
      setBusy(false);
    }
  }

  function startInstall() {
    if (chosen.length === 0) {
      void finish();
      return;
    }
    const ids = chosen.map((pack) => pack.id);
    setRows(ids.map((id) => ({ id, state: "queued", detail: "Waiting" })));
    setStep("install");
    void install(ids);
  }

  const finished = rows.length > 0 && rows.every((row) => row.state === "installed");

  return (
    <div className="mx-auto flex h-[720px] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] text-[var(--ink)] shadow-[var(--shadow-xl)]">
      <div className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)]"
          >
            <span className="h-2.5 w-2.5 rotate-45 bg-[var(--on-accent)]" />
          </span>
          <span className="text-[length:var(--text-title,15px)]">Suite</span>
        </div>
        <StepRail step={step} />
      </div>

      <main className="min-h-0 flex-1 overflow-auto px-8 py-8">
        {step === "apps" ? (
          <div className="mx-auto max-w-[760px]">
            <h1 className="text-[length:var(--text-display,34px)]">Welcome to Suite.</h1>
            <p className="mt-3 max-w-[62ch] text-[length:var(--text-body,13px)] leading-relaxed text-[var(--ink-muted)]">
              Suite is a home for small apps that keep their files on your device. Choose the ones
              you want now; you can add or remove them later.
            </p>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {packs.map((pack) => (
                <PackCard
                  key={pack.id}
                  name={pack.name}
                  {...(pack.description === undefined ? {} : { description: pack.description })}
                  status={pack.status ?? "available"}
                  {...(pack.version === undefined ? {} : { version: pack.version })}
                  selected={selected.has(pack.id)}
                  onSelect={() => toggle(pack.id)}
                />
              ))}
            </div>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button variant="primary" onClick={() => setStep("appearance")}>
                Continue
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFollowPacks(false);
                  setSelected(new Set());
                  setStep("appearance");
                }}
              >
                Skip choosing for now
              </Button>
              <span className="text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
                {chosen.length === 0 ? "No apps selected" : `${chosen.length} selected`}
              </span>
            </div>
          </div>
        ) : null}

        {step === "appearance" ? (
          <div className="mx-auto max-w-[980px]">
            <div className="grid items-start gap-6 md:grid-cols-[1fr_340px]">
              <div className="flex flex-col gap-5">
                <div>
                  <h1 className="text-[length:var(--text-display,34px)]">Make it yours.</h1>
                  <p className="mt-3 max-w-[62ch] text-[length:var(--text-body,13px)] leading-relaxed text-[var(--ink-muted)]">
                    Pick a palette, a brightness and how much room controls get. The apps follow
                    the host, so this choice is the one every app opens in.
                  </p>
                </div>
                <Appearance theme={theme} onThemeChange={onThemeChange} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={startInstall} disabled={busy}>
                    {chosen.length === 0
                      ? "Continue to Home"
                      : `Install ${chosen.length === 1 ? "1 app" : `${chosen.length} apps`}`}
                  </Button>
                  <Button variant="ghost" onClick={() => setStep("apps")}>
                    Back
                  </Button>
                </div>
              </div>
              <InstallReview packs={chosen} />
            </div>
          </div>
        ) : null}

        {step === "install" ? (
          <div className="mx-auto max-w-[620px]">
            <h1 className="text-[length:var(--text-display,34px)]">
              {finished ? "You’re set." : "Installing your apps."}
            </h1>
            <p className="mt-3 text-[length:var(--text-body,13px)] leading-relaxed text-[var(--ink-muted)]">
              Suite verifies each signed archive before it is used. A refusal names the app and
              leaves the rest of the setup alone.
            </p>
            <div className="mt-6">
              <InstallList packs={packs} rows={rows} />
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => void finish()}
                disabled={busy || rows.some((row) => row.state === "installing" || row.state === "queued")}
              >
                Continue to Home
              </Button>
              {rows.some((row) => row.state === "failed") ? (
                <Button
                  variant="secondary"
                  onClick={() => void install(rows.filter((row) => row.state === "failed").map((row) => row.id))}
                >
                  Retry failed
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {completeError === null ? null : (
          <p role="alert" className="mx-8 mt-4 text-[length:var(--text-label,12px)] text-[var(--danger)]">
            {completeError}
          </p>
        )}
      </main>
    </div>
  );
}
