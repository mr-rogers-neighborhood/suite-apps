import type { MenuSlots } from "@suite/contracts";
import type { SyncSituation } from "@suite/ui";
import type { HostTab } from "@suite/ui/chrome";
import { createElement, type ReactNode } from "react";
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
  /** The command surface is a host-owned dialog; the trigger reports its state. */
  readonly commandOpen: boolean;
  readonly relay: RelayView;
  /** The active pack's bar material, or null for a Screen tab or a pack that published none. */
  readonly packMenu: MenuSlots | null;
}

export interface SyncPresentation {
  readonly situation: SyncSituation;
  readonly label: string;
  readonly tooltip: string;
}

/** The legacy strip's stable colour for a pack or Screen identity. */
export function colorFor(id: string): string {
  let hash = 0;
  for (const character of id) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return `hsl(${hash} 68% 62%)`;
}

/**
 * A pack and a Screen keep the coloured dot the vanilla strip drew. `HostTabBar` falls
 * back to one accent for every pack, which would make two packs indistinguishable.
 */
function tabIcon(tab: ShellTab) {
  return createElement("span", {
    "aria-hidden": true,
    className:
      tab.kind === "pack"
        ? "h-1.5 w-1.5 shrink-0 rounded-[3px]"
        : "h-1.5 w-1.5 shrink-0 rounded-full",
    style: { background: colorFor(tab.kind === "pack" ? tab.packId : tab.screenId) },
  });
}

export function toHostTabs(tabs: readonly ShellTab[]): readonly HostTab[] {
  return tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    icon: tabIcon(tab),
  }));
}

/**
 * Decide whether the active pack published a row at all.
 *
 * A pack can publish only its document name and no controls. Treating that as "nothing"
 * silently dropped the title, so all three zones count as material.
 */
export function toHostPack(zones: {
  readonly context?: ReactNode;
  readonly navigation: ReactNode | null;
  readonly actions?: ReactNode;
}):
  | {
      readonly context?: ReactNode;
      readonly navigation: ReactNode;
      readonly actions?: ReactNode;
    }
  | undefined {
  if (zones.navigation === null && zones.actions === undefined && zones.context === undefined) {
    return undefined;
  }
  return {
    ...(zones.context === undefined ? {} : { context: zones.context }),
    navigation: zones.navigation,
    ...(zones.actions === undefined ? {} : { actions: zones.actions }),
  };
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
    label:
      relay.state === "on"
        ? "Sync on"
        : relay.state === "crashed" || relay.state === "failed"
          ? "Sync failed"
          : "Sync",
    tooltip: relay.lastError ?? relay.address ?? "Sync relay",
  };
}
