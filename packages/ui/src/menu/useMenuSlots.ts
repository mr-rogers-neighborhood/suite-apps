import type { MenuSlotAction, MenuSlots } from "@suite/contracts";
import { useEffect, useRef } from "react";

/**
 * The React half of the host's menu bar (`@suite/contracts/menu-bar`).
 *
 * A pack that runs inside a host draws no bar. It publishes its bar material and receives
 * back the id it put on the control that was used. These two hooks are that plumbing, and
 * nothing else: the vocabulary is the pack's, and the host's is `packMenuZones`.
 *
 * A standalone pack keeps its own `MenuBar` and passes `null`, so the same component tree
 * works in the frozen Flatpak and under a host.
 */
export interface MenuBarBridge {
	setSlots(slots: MenuSlots): void;
	onAction(listener: (action: MenuSlotAction) => void): () => void;
}

/**
 * The bridge, when a host is driving this pack.
 *
 * A host exposes it at `window.suite.menuBar`, beside the documents and files services. A
 * standalone window (the frozen Flatpak, a browser) has no such member, which is exactly how
 * a pack tells the two cases apart: it draws its own bar and publishes nothing.
 */
export function menuBarBridge(
	scope: unknown = globalThis,
): MenuBarBridge | null {
	if (typeof scope !== "object" || scope === null) return null;
	const suite = (scope as { suite?: unknown }).suite;
	if (typeof suite !== "object" || suite === null) return null;
	const menuBar = (suite as { menuBar?: unknown }).menuBar;
	if (typeof menuBar !== "object" || menuBar === null) return null;
	const candidate = menuBar as Partial<MenuBarBridge>;
	return typeof candidate.setSlots === "function" &&
		typeof candidate.onAction === "function"
		? (candidate as MenuBarBridge)
		: null;
}

/**
 * Publish the bar material whenever it changes.
 *
 * The comparison is on the serialized value, not on identity. A `slots` object built
 * inline is a new object on every render, so publishing on identity would send a message
 * per render and repaint the host's bar each time. The value is plain JSON by contract —
 * it crosses IPC in exactly this form — so its serialization is its meaning: two renders
 * that publish the same description really are the same bar, and nothing crosses when
 * nothing changed.
 */
export function useMenuSlots(
	bridge: MenuBarBridge | null,
	slots: MenuSlots | null,
): void {
	const serialized = slots === null ? null : JSON.stringify(slots);

	useEffect(() => {
		if (bridge === null || serialized === null) return;
		bridge.setSlots(JSON.parse(serialized) as MenuSlots);
	}, [bridge, serialized]);
}

/**
 * Handle a press from the host's bar.
 *
 * The latest handler is read through a ref, so a handler that closes over fresh state does
 * not force a resubscribe on every render; the subscription lasts as long as the bridge.
 */
export function useMenuAction(
	bridge: MenuBarBridge | null,
	handler: (action: MenuSlotAction) => void,
): void {
	const latest = useRef(handler);
	latest.current = handler;

	useEffect(() => {
		if (bridge === null) return;
		return bridge.onAction((action) => latest.current(action));
	}, [bridge]);
}
