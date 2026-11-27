import {
	type MenuSlotAction,
	type MenuSlots,
	SUITE_MENU_SLOTS_FORMAT,
} from "@suite/contracts";
import { type MenuBarBridge, useMenuAction, useMenuSlots } from "@suite/ui";
import { useEffect, useMemo, useState } from "react";

import { getBridge } from "../platform/bridge";
import { useReplica, useWorkspaceSnapshot } from "../store/snapshotStore";
import { useUiStore } from "../store/uiStore";
import { PRIMARY_VIEWS } from "./views";

/**
 * Budget's contribution to the host's menu bar.
 *
 * Under a host, Budget draws no bar: it publishes this and the host draws it in the one
 * physical bar. A standalone window keeps its own `MenuBar` and passes `null`.
 *
 * Budget is the case where the bar carries state, not just commands: the save warning is a
 * readout, so it publishes as `status` with a tone rather than as another button. That is
 * also why `status` exists in the contract at all.
 */
export const MENU_IDS = {
	view: "budget.view",
	search: "budget.search",
	save: "budget.save",
	undo: "budget.undo",
	redo: "budget.redo",
	import: "budget.import",
	add: "budget.add-transaction",
} as const;

const VIEW_PREFIX = "budget.view.";

export function viewIdFromAction(action: MenuSlotAction): string | null {
	if (action.id !== MENU_IDS.view || action.item === undefined) return null;
	return action.item.startsWith(VIEW_PREFIX)
		? action.item.slice(VIEW_PREFIX.length)
		: null;
}

export function budgetMenuSlots(input: {
	readonly view: string;
	readonly name: string;
	readonly saveError: string | null;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}): MenuSlots {
	const active = PRIMARY_VIEWS.find((candidate) => candidate.id === input.view);
	return {
		format: SUITE_MENU_SLOTS_FORMAT,
		title: input.name,
		navigation: [
			{
				kind: "menu",
				id: MENU_IDS.view,
				label: "View",
				items: PRIMARY_VIEWS.map((destination) => ({
					id: `${VIEW_PREFIX}${destination.id}`,
					label: destination.label,
					...(destination.id === input.view ? { checked: true } : {}),
				})),
				help: {
					title: "Switch view",
					body: `The budget is showing ${active?.label ?? "Plan"}. This chooses which surface it is drawn on.`,
				},
			},
		],
		actions: [
			{ id: MENU_IDS.undo, label: "Undo", disabled: !input.canUndo },
			{ id: MENU_IDS.redo, label: "Redo", disabled: !input.canRedo },
			{ id: MENU_IDS.import, label: "Import" },
			{ id: MENU_IDS.add, label: "Add transaction", glyph: "+" },
		],
		...(input.saveError === null
			? {}
			: {
					status: {
						id: MENU_IDS.save,
						label: "Save failed",
						tone: "danger" as const,
						title: input.saveError,
						help: {
							title: "Save failed",
							body: "The last write did not reach the file. Your changes are still open here.",
						},
					},
				}),
	};
}

/** The pack's own save check, the same poll the in-app bar uses. */
function useSaveError(active: boolean): string | null {
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!active) return;
		let alive = true;
		const check = async (): Promise<void> => {
			try {
				const info = await getBridge().info();
				if (alive) setError(info.saveError ?? null);
			} catch {
				// No open budget yet; the next tick tries again.
			}
		};
		void check();
		const timer = setInterval(() => void check(), 2000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, [active]);

	return error;
}

export function useBudgetMenuBar(
	hosted: MenuBarBridge | null,
	options: {
		readonly onOpenPalette: () => void;
		readonly onAddTransaction: () => void;
	},
): MenuSlots | null {
	const snapshot = useWorkspaceSnapshot();
	const replica = useReplica();
	const view = useUiStore((state) => state.view);
	const setView = useUiStore((state) => state.setView);
	const setImportOpen = useUiStore((state) => state.setImportOpen);
	const saveError = useSaveError(hosted !== null);

	// `canUndo`/`canRedo` are reads, not subscriptions; the snapshot changing is what tells
	// this hook to look again.
	const canUndo = replica.canUndo();
	const canRedo = replica.canRedo();

	const slots = useMemo(
		() =>
			budgetMenuSlots({
				view,
				name: snapshot.meta.name,
				saveError,
				canUndo,
				canRedo,
			}),
		[view, snapshot.meta.name, saveError, canUndo, canRedo],
	);
	useMenuSlots(hosted, slots);

	useMenuAction(hosted, (action) => {
		const nextView = viewIdFromAction(action);
		if (nextView !== null) {
			setView(nextView as Parameters<typeof setView>[0]);
			return;
		}
		switch (action.id) {
			case MENU_IDS.search:
				options.onOpenPalette();
				return;
			case MENU_IDS.undo:
				replica.undo();
				return;
			case MENU_IDS.redo:
				replica.redo();
				return;
			case MENU_IDS.import:
				setImportOpen(true);
				return;
			case MENU_IDS.add:
				options.onAddTransaction();
				return;
			default:
		}
	});

	return slots;
}
