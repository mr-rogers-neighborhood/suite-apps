import type { CatalogueEntry } from "../host/catalogue.js";
import { shelfAction, shelfSummary } from "../host/shelf.js";
import { formatBytes } from "./Catalogue.js";

/**
 * One shadow on Home's shelf.
 *
 * The card is the host drawing a verified index row, not the pack: no app code,
 * style or document runs here. Details are an expandable `<details>` so the
 * phone keeps one line per app until someone asks for more.
 */
export function ShelfCard({
  entry,
  onInstall,
}: {
  readonly entry: CatalogueEntry;
  readonly onInstall: (entry: CatalogueEntry) => void;
}) {
  const action = shelfAction(entry);
  return (
    <article className="shelf-card">
      <span className="shelf-card-icon" aria-hidden="true">
        {entry.name.slice(0, 1).toUpperCase()}
      </span>
      <details>
        <summary className="touch">
          <span className="shelf-card-name">{entry.name}</span>
          <span className="shelf-card-meta">
            {entry.version} · {formatBytes(entry.sizeBytes)} · {entry.publisher}
          </span>
          <span className="shelf-card-line">{shelfSummary(entry)}</span>
        </summary>
        <div className="shelf-card-detail">
          {entry.description === null ? null : <p>{entry.description}</p>}
          <p>
            {entry.capabilities.length === 0
              ? "Asks for nothing."
              : `Uses ${entry.capabilities.join(", ")}.`}
          </p>
          <p>
            {entry.platform.state === "unknown"
              ? (entry.platform.reason ?? "Platform unknown.")
              : entry.platform.state === "unavailable"
                ? (entry.platform.reason ?? "Not available on this phone.")
                : `Available for this phone. Version ${entry.version}.`}
          </p>
        </div>
      </details>
      <ShelfAction entry={entry} action={action} onInstall={onInstall} />
    </article>
  );
}

function ShelfAction({
  entry,
  action,
  onInstall,
}: {
  readonly entry: CatalogueEntry;
  readonly action: ReturnType<typeof shelfAction>;
  readonly onInstall: (entry: CatalogueEntry) => void;
}) {
  if (action === "unavailable") {
    return (
      <button type="button" className="touch shelf-action" disabled>
        Not available on this phone
      </button>
    );
  }
  if (action === "installed") {
    return (
      <button type="button" className="touch shelf-action" disabled>
        Installed
      </button>
    );
  }
  const label = action === "install" ? "Install" : action === "update" ? "Update" : "Reinstall";
  return (
    <button type="button" className="touch shelf-action" onClick={() => onInstall(entry)}>
      {label}
    </button>
  );
}
