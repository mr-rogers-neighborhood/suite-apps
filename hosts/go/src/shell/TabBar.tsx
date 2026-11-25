import { useEffect, useState } from "react";

/**
 * The open-app tab strip.
 *
 * One cell for the current app, the count, and a `+` that opens the catalogue.
 * Tapping the cell opens the tabs sheet: every open app, grouped by whether it is
 * showing or resting, with a close per row. A phone gets the compact cell; a
 * wider Go uses the same model as a strip.
 *
 * Nothing here names a domain. A tab is the id and name the module declared.
 */
export interface TabItem {
  readonly id: string;
  readonly name: string;
}

export function TabBar({
  tabs,
  activeId,
  onFocus,
  onClose,
  onHome,
  onCatalogue,
}: {
  readonly tabs: readonly TabItem[];
  readonly activeId: string | null;
  readonly onFocus: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onHome: () => void;
  readonly onCatalogue: () => void;
}) {
  const [open, setOpen] = useState(false);
  const current = tabs.find((tab) => tab.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const showing = tabs.filter((tab) => tab.id === activeId);
  const resting = tabs.filter((tab) => tab.id !== activeId);

  return (
    <div className="tab-bar">
      <button
        type="button"
        className="touch tab-bar-home"
        aria-label="Home"
        aria-current={activeId === null ? "page" : undefined}
        onClick={onHome}
      >
        Home
      </button>

      <button
        type="button"
        className="touch tab-bar-current"
        aria-label={
          current === null
            ? `${tabs.length} open apps`
            : `Current app: ${current.name}. ${tabs.length} open. Open tabs`
        }
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="tab-bar-current-name">{current?.name ?? "Open apps"}</span>
        <span className="tab-bar-count" aria-hidden="true">
          {tabs.length}
        </span>
      </button>

      <button
        type="button"
        className="touch tab-bar-add"
        aria-label="Open an app from the catalogue"
        onClick={onCatalogue}
      >
        +
      </button>

      {open ? (
        <div className="tab-sheet" role="dialog" aria-modal="true" aria-label="Open apps">
          <div className="tab-sheet-head">
            <h2>Open apps</h2>
            <button type="button" className="touch" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {tabs.length === 0 ? (
            <p className="tab-sheet-empty">No app is open. Open one to keep its tab here.</p>
          ) : (
            <>
              {showing.length > 0 ? (
                <TabGroup
                  label="Showing"
                  tabs={showing}
                  activeId={activeId}
                  onFocus={onFocus}
                  onClose={onClose}
                />
              ) : null}
              {resting.length > 0 ? (
                <TabGroup
                  label="Resting"
                  tabs={resting}
                  activeId={activeId}
                  onFocus={onFocus}
                  onClose={onClose}
                />
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TabGroup({
  label,
  tabs,
  activeId,
  onFocus,
  onClose,
}: {
  readonly label: string;
  readonly tabs: readonly TabItem[];
  readonly activeId: string | null;
  readonly onFocus: (id: string) => void;
  readonly onClose: (id: string) => void;
}) {
  return (
    <section aria-label={label} className="tab-group">
      <h3>{label}</h3>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.id}>
            <button
              type="button"
              className="touch tab-sheet-row"
              aria-current={tab.id === activeId ? "page" : undefined}
              onClick={() => onFocus(tab.id)}
            >
              {tab.name}
            </button>
            <button
              type="button"
              className="touch tab-sheet-close"
              aria-label={`Close ${tab.name}`}
              onClick={() => onClose(tab.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
