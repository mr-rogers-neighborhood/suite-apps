import {
	type MenuNavControl,
	type MenuSlotAction,
	type MenuSlots,
	SUITE_MENU_SLOTS_FORMAT,
} from "@suite/contracts";
import { type SyncInfo, todayKey } from "@suite/planner-core";
import { type MenuBarBridge, useMenuAction, useMenuSlots } from "@suite/ui";
import { useEffect, useMemo, useState } from "react";

import { getBridge } from "../platform/bridge";
import { useUiStore } from "../store/uiStore";
import { syncLabel, syncPeople, syncSituation } from "../sync/syncState";
import { resolveView, views } from "./views";

/**
 * Planner's contribution to the host's menu bar.
 *
 * When a host is running, Planner draws no bar: it publishes this and the host draws it in
 * the one physical bar. When there is no host — the frozen Flatpak — `hosted` is null and
 * `Shell.tsx` renders the same material through `MenuBar` instead.
 *
 * The ids are Planner's own words. `planner.view.today` means "show today" here and
 * nowhere else; the host echoes it back untouched. That is what lets a cross-app explainer
 * describe this bar later without learning Planner.
 */
export const MENU_IDS = {
	view: "planner.view",
	nav: "planner.nav",
	navOpen: "planner.nav.open",
	newTask: "planner.new-task",
	export: "planner.export",
	import: "planner.import",
	sync: "planner.sync",
} as const;

/** The id prefix a view row carries, so one handler serves the whole registry. */
const VIEW_PREFIX = "planner.view.";

export function viewIdFromAction(action: MenuSlotAction): string | null {
	if (action.id !== MENU_IDS.view || action.item === undefined) return null;
	return action.item.startsWith(VIEW_PREFIX)
		? action.item.slice(VIEW_PREFIX.length)
		: null;
}

/** The bar's material, from the state Planner already keeps. */
export function plannerMenuSlots(input: {
	readonly view: string;
	readonly sync: SyncInfo | null;
	/** Below `md` the rail is a drawer, and its only way in is a control in the bar. */
	readonly showNav: boolean;
}): MenuSlots {
	const active = resolveView(views, input.view);
	const status = input.sync?.status ?? { state: "off" as const };

	return {
		format: SUITE_MENU_SLOTS_FORMAT,
		title: null,
		navigation: [
			...(input.showNav
				? ([
						{
							kind: "buttons" as const,
							id: MENU_IDS.nav,
							items: [
								{
									id: MENU_IDS.navOpen,
									label: "Open navigation",
									glyph: "\u2261",
								},
							],
						},
					] satisfies MenuNavControl[])
				: []),
			{
				kind: "menu",
				id: MENU_IDS.view,
				label: "View",
				items: Object.values(views).map((view) => ({
					id: `${VIEW_PREFIX}${view.id}`,
					label: view.label,
					...(view.id === active.id ? { checked: true } : {}),
				})),
				help: {
					title: "Switch view",
					body: `Planner is showing ${active.label}. This chooses which surface the plan is drawn on.`,
				},
			},
		],
		actions: [
			{ id: MENU_IDS.newTask, label: "New task", glyph: "+" },
			{ id: MENU_IDS.export, label: "Export" },
			{ id: MENU_IDS.import, label: "Import" },
		],
		...(status.state === "off"
			? {}
			: {
					status: {
						id: MENU_IDS.sync,
						label:
							syncPeople(input.sync) > 1
								? `${syncLabel(status)} · ${syncPeople(input.sync)}`
								: syncLabel(status),
						tone: syncSituation(status) === "refused" ? "warn" : "ok",
						help: {
							title: "Sync",
							body: "This plan is shared with another device.",
						},
					},
				}),
	};
}

/**
 * Publish Planner's bar, and act on a press.
 *
 * The handler is the pack's own: it reads the same store and calls the same bridge the
 * in-app bar does, so the two cannot disagree about what a control does.
 */
export function usePlannerMenuBar(
	hosted: MenuBarBridge | null,
	options: { readonly showNav: boolean; readonly onOpenNav: () => void },
): MenuSlots | null {
	const view = useUiStore((state) => state.view);
	const setView = useUiStore((state) => state.setView);
	const setSelectedDate = useUiStore((state) => state.setSelectedDate);
	const setNotice = useUiStore((state) => state.setNotice);
	const [sync, setSync] = useState<SyncInfo | null>(null);

	useEffect(() => {
		if (hosted === null) return;
		const bridge = getBridge();
		if (bridge.onSyncChanged === undefined || bridge.syncStatus === undefined)
			return;
		const off = bridge.onSyncChanged(setSync);
		void bridge
			.syncStatus()
			.then(setSync)
			.catch(() => setSync(null));
		return off;
	}, [hosted]);

	const slots = useMemo(
		() => plannerMenuSlots({ view, sync, showNav: options.showNav }),
		[view, sync, options.showNav],
	);
	useMenuSlots(hosted, slots);

	useMenuAction(hosted, (action) => {
		const nextView = viewIdFromAction(action);
		if (nextView !== null) {
			const resolved = resolveView(views, nextView);
			setView(resolved.id as Parameters<typeof setView>[0]);
			if (resolved.id === "today") setSelectedDate(todayKey());
			return;
		}
		switch (action.id) {
			case MENU_IDS.navOpen:
				options.onOpenNav();
				return;
			case MENU_IDS.newTask:
				setView("today");
				setSelectedDate(todayKey());
				return;
			case MENU_IDS.export:
				void getBridge()
					.exportWorkspace()
					.then((result) => {
						if (!result.canceled)
							setNotice(`Exported to ${result.path ?? "your chosen file"}`);
					})
					.catch((error: unknown) =>
						setNotice(error instanceof Error ? error.message : "Export failed"),
					);
				return;
			case MENU_IDS.import:
				void getBridge()
					.importWorkspace()
					.then((result) => {
						if (!result.canceled) setNotice("Workspace imported");
					})
					.catch((error: unknown) =>
						setNotice(error instanceof Error ? error.message : "Import failed"),
					);
				return;
			default:
		}
	});

	return slots;
}
