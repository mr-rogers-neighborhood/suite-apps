import type { HostTab, SyncSituation } from "@suite/ui";
import type { RelayView, ShellTab } from "../../shared.js";

/**
 * The island's view of the host state.
 *
 * `shell.js` keeps the state and passes a snapshot on every paint; this module only
 * maps it into the shared components' vocabulary. It is pure so the mapping can be
 * tested without a browser.
 */
export interface HostBarSnapshot {
  readonly tabs: readonly ShellTab[];
  readonly activeTabId: string | null;
  readonly syncOpen: boolean;
  readonly relay: RelayView;
}

export interface SyncPresentation {
  readonly situation: SyncSituation;
  readonly label: string;
  readonly tooltip: string;
}

export function toHostTabs(tabs: readonly ShellTab[]): readonly HostTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
  }));
}

/** The relay lifecycle as the shared pill names it. */
export function syncPresentation(relay: RelayView): SyncPresentation {
  const situation: SyncSituation =
    relay.state === "on"
      ? "synced"
      : relay.state === "starting" || relay.state === "stopping"
        ? "connecting"
        : relay.state === "crashed" || relay.state === "failed"
          ? "refused"
          : "local";
  return {
    situation,
    label: relay.state === "on" ? "Sync on" : "Sync",
    tooltip: relay.lastError ?? relay.address ?? "Sync relay",
  };
}
