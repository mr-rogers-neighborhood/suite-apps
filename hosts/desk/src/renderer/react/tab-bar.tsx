import { SyncPill } from "@suite/ui";
import { HostTabBar } from "@suite/ui/chrome";
import { createRoot } from "react-dom/client";
import { type HostBarSnapshot, syncPresentation, toHostTabs } from "./state.js";
import "./tab-bar.css";

export { colorFor } from "./state.js";

/**
 * The tab strip as a React island inside the legacy chrome.
 *
 * `shell.js` still draws the Screens, the catalogue and the command surface. This
 * module owns only the bar: it mounts once, receives a snapshot on every host paint
 * and calls back into the shell. The host state never moves into React, so removing
 * the island later is a smaller change than porting everything at once.
 */
export interface TabBarActions {
  readonly activate: (id: string) => void;
  readonly close: (id: string) => void;
  readonly newTab: () => void;
  readonly openCommands: () => void;
  readonly toggleSync: () => void;
}

export interface TabBarHandle {
  update(snapshot: HostBarSnapshot): void;
  unmount(): void;
}

const SEARCH_PLACEHOLDER = "Search or run a command";
const SEARCH_SHORTCUT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/u.test(navigator.platform)
    ? "Cmd K"
    : "Ctrl K";

function TabBar({
  snapshot,
  actions,
}: {
  readonly snapshot: HostBarSnapshot;
  readonly actions: TabBarActions;
}) {
  const sync = syncPresentation(snapshot.relay);
  return (
    <HostTabBar
      tabs={toHostTabs(snapshot.tabs)}
      activeTabId={snapshot.activeTabId}
      onActivate={actions.activate}
      onClose={actions.close}
      onNewTab={actions.newTab}
      mark={
        <span className="flex min-h-6 items-center gap-2">
          <span className="brand-mark" aria-hidden="true" />
          <span>Suite</span>
        </span>
      }
      onHome={actions.newTab}
      homeLabel="Home"
      search={
        <button
          type="button"
          data-testid="command-bar"
          data-handbook-region="command-bar"
          aria-label={`${SEARCH_PLACEHOLDER} ${SEARCH_SHORTCUT}`}
          aria-haspopup="dialog"
          aria-controls="command-surface"
          aria-expanded={snapshot.commandOpen}
          aria-keyshortcuts="Meta+K Control+K"
          title={`${SEARCH_PLACEHOLDER} (${SEARCH_SHORTCUT})`}
          onClick={actions.openCommands}
          className="flex h-7 w-56 shrink-0 items-center gap-1.5 rounded-md border border-[var(--hairline)] bg-[var(--surface-sunk)] px-2 text-[length:var(--text-label,12px)] text-[var(--ink-muted)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5 shrink-0 opacity-70"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <span className="min-w-0 flex-1 truncate text-left">
            {SEARCH_PLACEHOLDER}{" "}
            <kbd className="rounded-sm border border-[var(--hairline)] px-1 py-0.5 text-[length:var(--text-caption,11px)]">
              {SEARCH_SHORTCUT}
            </kbd>
          </span>
        </button>
      }
      sync={
        <SyncPill
          situation={sync.situation}
          label={sync.label}
          tooltip={sync.tooltip}
          aria-expanded={snapshot.syncOpen}
          aria-controls="sync-panel"
          onClick={actions.toggleSync}
        />
      }
    />
  );
}

export function mountTabBar(container: HTMLElement, actions: TabBarActions): TabBarHandle {
  const root = createRoot(container);
  return {
    update(snapshot) {
      root.render(<TabBar snapshot={snapshot} actions={actions} />);
    },
    unmount() {
      root.unmount();
    },
  };
}
