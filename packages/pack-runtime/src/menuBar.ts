import { type MenuSlotAction, type MenuSlots, parseMenuSlots } from "@suite/contracts/menu-bar";

/**
 * The pack half of the menu bar (`@suite/contracts/menu-bar`).
 *
 * A pack that runs inside a host does not draw a bar. It publishes the material for the
 * zones it may fill, and the host draws it in the one physical bar. This module is that
 * publish path and nothing else: no React, no host chrome, no knowledge of what a control
 * means.
 *
 * ## Hosted, or on its own
 *
 * `window.suite` is the host's bridge. Its `menuBar` member is the subscription, so a
 * pack can tell the difference without guessing from the URL: a standalone window (the
 * frozen Flatpak, a browser) has no `window.suite.menuBar`, draws its own `MenuBar`, and
 * never calls this module. That check is `menuBarHost`.
 *
 * ## What a pack does with it
 *
 * 1. Build a `MenuSlots` value from its own state, on every render that changes it.
 * 2. `publish(slots)` — the host replaces what it holds for this tab.
 * 3. `onAction(listener)` — the host sends `{ id, item? }` back when a control is used.
 *
 * The id vocabulary is the pack's. The host renders the descriptor and echoes the id, so
 * nothing here has to be understood by the host — which is what lets one explain layer
 * speak about every app's bar later.
 */

/** What the host exposes at `window.suite.menuBar`. */
export interface MenuBarHostBridge {
  /** Replace this tab's slots. */
  setSlots(slots: MenuSlots): void;
  /** Receive a press. Returns the unsubscribe. */
  onAction(listener: (action: MenuSlotAction) => void): () => void;
}

/**
 * The menu-bar bridge, when a host is driving this pack.
 *
 * `scope` is a parameter so the answer is a test rather than a fact about the runner.
 */
export function menuBarHost(scope: unknown = globalThis): MenuBarHostBridge | null {
  if (typeof scope !== "object" || scope === null) return null;
  const suite = (scope as { suite?: unknown }).suite;
  if (typeof suite !== "object" || suite === null) return null;
  const menuBar = (suite as { menuBar?: unknown }).menuBar;
  if (typeof menuBar !== "object" || menuBar === null) return null;
  const candidate = menuBar as Partial<MenuBarHostBridge>;
  return typeof candidate.setSlots === "function" && typeof candidate.onAction === "function"
    ? (candidate as MenuBarHostBridge)
    : null;
}

export interface MenuSlotsHandle {
  /** Publish the bar's current material. A malformed value is dropped, not sent. */
  publish(slots: MenuSlots): void;
  /** Last value the host accepted, for a test or a debug readout. */
  current(): MenuSlots | null;
  /** Unsubscribe from presses. */
  dispose(): void;
}

/**
 * Publish a pack's bar material to its host.
 *
 * A publish is validated before it is sent: the host validates again at the boundary, so
 * this is the cheaper half of the same rule. A rejected value leaves the host showing the
 * previous bar rather than half of a broken one, and says so in the console — a bar that
 * silently stops updating is worse than one that reports a bad descriptor.
 */
export function createMenuSlots(bridge: MenuBarHostBridge | null = menuBarHost()): MenuSlotsHandle {
  let latest: MenuSlots | null = null;
  if (bridge === null) {
    return {
      publish() {
        // No host: the pack is drawing its own bar, and there is nothing to publish.
      },
      current: () => null,
      dispose() {
        // Nothing was subscribed.
      },
    };
  }

  return {
    publish(slots) {
      const parsed = parseMenuSlots(slots);
      if (!parsed.ok) {
        const first = parsed.issues[0];
        console.warn(
          `[suite] menu bar slots were not published: ${first?.path ?? ""} ${first?.message ?? "invalid"}`.trim(),
        );
        return;
      }
      latest = parsed.value;
      bridge.setSlots(parsed.value);
    },
    current: () => latest,
    dispose() {
      latest = null;
    },
  };
}

/**
 * Subscribe to presses from the host's bar.
 *
 * The listener receives the id the pack itself put on the control, so the pack's own map
 * from id to behaviour is the only place meaning lives.
 */
export function subscribeMenuActions(
  bridge: MenuBarHostBridge | null,
  listener: (action: MenuSlotAction) => void,
): () => void {
  if (bridge === null) return () => undefined;
  return bridge.onAction(listener);
}

/** Re-export so a pack imports its descriptor types from one place. */
export type {
  MenuButton,
  MenuHelp,
  MenuNavControl,
  MenuRow,
  MenuSlotAction,
  MenuSlots,
  MenuStatus,
  MenuTab,
} from "@suite/contracts/menu-bar";
export { SUITE_MENU_SLOTS_FORMAT } from "@suite/contracts/menu-bar";
