import { HostTabBar, SyncPill } from "@suite/ui";
import { createRoot } from "react-dom/client";
import { type HostBarSnapshot, syncPresentation, toHostTabs } from "./state.js";
import "./tab-bar.css";

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
        <span className="flex items-center gap-2">
          <span className="brand-mark" aria-hidden="true" />
          <span>Suite</span>
        </span>
      }
      onHome={actions.newTab}
      homeLabel="Home"
      onOpenSearch={actions.openCommands}
      searchPlaceholder="Search or run a command"
      searchShortcut="Ctrl K"
      sync={
        <SyncPill
          situation={sync.situation}
          label={sync.label}
          tooltip={sync.tooltip}
          aria-pressed={snapshot.syncOpen}
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
