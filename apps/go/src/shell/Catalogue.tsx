import { EmptyState } from "@suite/ui";
import { useState } from "react";
import type { CatalogueEntry } from "../host/catalogue.js";

/**
 * The catalogue.
 *
 * One row per app, from the verified index. The row says what would be installed, what is
 * installed, and which of Install, Update, Reinstall or Remove applies. The index is the only
 * source: this screen never scans a folder or guesses a version.
 *
 * Removing asks once, in place, because a second full-screen dialog is a second thing to dismiss.
 * The confirmation says documents stay, since the container cannot read them and does not delete
 * them.
 */
export function Catalogue({
  entries,
  notice,
  loading,
  onRefresh,
  onInstall,
  onRemove,
  onClose,
}: {
  readonly entries: readonly CatalogueEntry[];
  readonly notice: string | null;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onInstall: (entry: CatalogueEntry) => void;
  readonly onRemove: (id: string) => void;
  readonly onClose: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <main className="screen">
      <header className="mb-4 flex items-center gap-2">
        <button
          type="button"
          className="touch rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
          onClick={onClose}
        >
          Back
        </button>
        <h1 className="min-w-0 flex-1 text-[20px] font-semibold text-[var(--ink)]">
          App catalogue
        </h1>
        <button
          type="button"
          className="touch rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none disabled:opacity-50"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </header>

      {notice === null ? null : (
        <p
          role="status"
          className="mb-4 rounded-xl border border-[var(--hairline)] bg-[var(--surface-sunk)] px-4 py-3 text-[14px] text-[var(--ink)]"
        >
          {notice}
        </p>
      )}

      {entries.length === 0 ? (
        <EmptyState title={loading ? "Checking the catalogue" : "Nothing in the catalogue yet"}>
          {loading
            ? "This takes a moment on a slow connection."
            : "The published index offered no apps for this phone, or it could not be verified."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id}>
              <CatalogueRow
                entry={entry}
                confirming={confirming === entry.id}
                onInstall={() => onInstall(entry)}
                onAskRemove={() => setConfirming(entry.id)}
                onCancelRemove={() => setConfirming(null)}
                onConfirmRemove={() => {
                  setConfirming(null);
                  onRemove(entry.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/**
 * One catalogue row, split out so both the ordinary and the confirming state are renderable
 * without a browser: the remove rule is a sentence a person reads, not a browser prompt.
 */
export function CatalogueRow({
  entry,
  confirming,
  onInstall,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  readonly entry: CatalogueEntry;
  readonly confirming: boolean;
  readonly onInstall: () => void;
  readonly onAskRemove: () => void;
  readonly onCancelRemove: () => void;
  readonly onConfirmRemove: () => void;
}) {
  const installed = entry.installedVersion !== null;
  return (
    <article className="rounded-xl border border-[var(--hairline)] px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[17px] font-semibold text-[var(--ink)]">{entry.name}</h2>
        <span className="text-[13px] text-[var(--ink-muted)]">{entry.id}</span>
        <span className="text-[13px] text-[var(--ink-muted)]">by {entry.publisher}</span>
        <span className="text-[14px] text-[var(--ink-muted)]">version {entry.version}</span>
        <span className="text-[13px] text-[var(--ink-muted)]">{formatBytes(entry.sizeBytes)}</span>
      </div>
      {entry.description === null ? null : (
        <p className="mt-1 text-[14px] text-[var(--ink-muted)]">{entry.description}</p>
      )}
      <p className="mt-1 text-[13px] text-[var(--ink-muted)]">
        {entry.capabilities.length === 0
          ? "Asks for nothing"
          : `Uses ${entry.capabilities.join(", ")}`}
      </p>
      <p className="mt-1 text-[13px] text-[var(--ink-muted)]">
        {entry.installedVersion === null
          ? "Not installed"
          : entry.action === "current"
            ? `Installed ${entry.installedVersion}`
            : `Installed ${entry.installedVersion}; ${entry.version} is available`}
      </p>

      {confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-[14px] text-[var(--ink)]">
            Remove {entry.name}? Its documents stay on this device.
          </p>
          <button
            type="button"
            className="touch rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            onClick={onCancelRemove}
          >
            Cancel
          </button>
          <button
            type="button"
            className="touch rounded-xl bg-[var(--accent)] px-4 text-[15px] font-medium text-[var(--on-accent)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
            onClick={onConfirmRemove}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ActionButton entry={entry} onInstall={onInstall} />
          {installed ? (
            <button
              type="button"
              className="touch rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
              onClick={onAskRemove}
            >
              Remove
            </button>
          ) : null}
        </div>
      )}
    </article>
  );
}

function ActionButton({
  entry,
  onInstall,
}: {
  readonly entry: CatalogueEntry;
  readonly onInstall: () => void;
}) {
  if (entry.action === "current") {
    return (
      <button
        type="button"
        className="touch rounded-xl border border-[var(--hairline)] px-4 text-[15px] font-medium text-[var(--ink)] opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
        disabled
      >
        Installed
      </button>
    );
  }

  const label =
    entry.action === "install" ? "Install" : entry.action === "update" ? "Update" : "Reinstall";
  return (
    <button
      type="button"
      className="touch rounded-xl bg-[var(--accent)] px-4 text-[15px] font-medium text-[var(--on-accent)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none"
      onClick={onInstall}
    >
      {label}
    </button>
  );
}

/** A size a phone screen can read. A catalogue row is not the place for an exact byte count. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
