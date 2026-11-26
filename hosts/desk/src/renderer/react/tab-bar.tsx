import { SyncPill } from "@suite/ui";
import { HostTabBar, NewTabPicker } from "@suite/ui/chrome";
import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useState } from "react";
import type { PickerData } from "../../shared.js";
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
export interface PickerBridge {
  readonly load: () => Promise<PickerData>;
  readonly openPack: (id: string) => void;
  readonly openDocument: (packId: string, documentId: string) => void;
  readonly newDocument: (packId: string) => void;
  readonly openScreen: (id: string) => void;
  readonly newScreen: () => void;
}

export interface TabBarActions {
  readonly activate: (id: string) => void;
  readonly close: (id: string) => void;
  /** A new tab is the picker: which surface, and which document inside it. */
  readonly newTab: () => void;
  readonly home: () => void;
  readonly picker: PickerBridge;
  readonly openCommands: () => void;
  readonly toggleSync: () => void;
}

export interface TabBarHandle {
  update(snapshot: HostBarSnapshot): void;
  showPicker(): void;
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
  bindPicker,
}: {
  readonly snapshot: HostBarSnapshot;
  readonly actions: TabBarActions;
  readonly bindPicker: (open: () => void) => void;
}) {
  const sync = syncPresentation(snapshot.relay);
  const [pickOpen, setPickOpen] = useState(false);
  const [picker, setPicker] = useState<PickerData | null>(null);

  const openPicker = useCallback(async () => {
    setPickOpen(true);
    try {
      setPicker(await actions.picker.load());
    } catch {
      // A host that cannot answer still shows the picker's own Screens and actions.
      setPicker(null);
    }
  }, [actions]);

  useEffect(() => {
    bindPicker(() => {
      void openPicker();
    });
  }, [bindPicker, openPicker]);

  const packs = (picker?.packs ?? []).map((pack) => ({
    id: pack.id,
    name: pack.name,
    unavailable: pack.unavailable,
    ...(pack.description === null ? {} : { description: pack.description }),
    ...(pack.noun === null ? {} : { noun: pack.noun }),
    ...(pack.documents === null
      ? {}
      : {
          documents: pack.documents.map((document) => ({
            id: document.id,
            name: document.name,
            ...(document.openedAt === null ? {} : { openedAt: document.openedAt }),
          })),
        }),
  }));

  return (
    <>
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
      onHome={actions.home}
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
    <NewTabPicker
      open={pickOpen}
      packs={packs}
      screens={(picker?.screens ?? []).map((screen) => ({
        id: screen.id,
        name: screen.name,
      }))}
      openDocuments={picker?.openDocuments ?? []}
      onClose={() => setPickOpen(false)}
      onOpenPack={actions.picker.openPack}
      onOpenDocument={actions.picker.openDocument}
      onNewDocument={actions.picker.newDocument}
      onOpenScreen={actions.picker.openScreen}
      onNewScreen={() => {
        setPickOpen(false);
        actions.picker.newScreen();
      }}
      onOpenSettings={() => {
        setPickOpen(false);
        // Settings has no surface yet; Home is where appearance and the catalogue live today.
        actions.home();
      }}
    />
    </>
  );
}

export function mountTabBar(container: HTMLElement, actions: TabBarActions): TabBarHandle {
  const root = createRoot(container);
  let open: (() => void) | null = null;
  const bindPicker = (next: () => void): void => {
    open = next;
  };
  return {
    update(snapshot) {
      root.render(<TabBar snapshot={snapshot} actions={actions} bindPicker={bindPicker} />);
    },
    showPicker() {
      open?.();
    },
    unmount() {
      root.unmount();
    },
  };
}
