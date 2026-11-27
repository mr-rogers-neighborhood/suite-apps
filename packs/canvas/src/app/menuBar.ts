import {
	type MenuSlotAction,
	type MenuSlots,
	SUITE_MENU_SLOTS_FORMAT,
} from "@suite/contracts";
import { type MenuBarBridge, useMenuAction, useMenuSlots } from "@suite/ui";

import { RESTING_PURPOSE } from "../canvas/purpose";
import { redoWithStack, undoWithStack } from "../history/undoWithStack";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";

/**
 * Canvas's contribution to the host's menu bar.
 *
 * Under a host, Canvas draws no bar: it publishes this and the host draws it in the one
 * physical bar. A standalone window keeps its own `TitleBar`.
 *
 * This is the richest pack, and the reason the slot vocabulary has four control kinds.
 * Canvas's middle is a board switcher (a menu), its open boards (tabs), a mode toggle and
 * a row of icon buttons — plus the explain purpose, which is why `help` is in the contract:
 * a control whose whole point is to be explained should carry the sentence that explains it.
 */
export const MENU_IDS = {
	boards: "canvas.boards",
	board: "canvas.board",
	newTab: "canvas.new-tab",
	undo: "canvas.undo",
	redo: "canvas.redo",
	mode: "canvas.interaction-mode",
	history: "canvas.history",
	outline: "canvas.outline",
	explain: "canvas.explain",
	search: "canvas.search",
	newBoard: "canvas.boards.new",
} as const;

const BOARD_PREFIX = "canvas.board.";

/** The board a menu row names, or null when the press was something else. */
export function boardIdFromAction(action: MenuSlotAction): string | null {
	if (action.id !== MENU_IDS.boards || action.item === undefined) return null;
	if (action.item === MENU_IDS.newBoard) return null;
	return action.item.startsWith(BOARD_PREFIX)
		? action.item.slice(BOARD_PREFIX.length)
		: null;
}

/**
 * A board id inside a slot id.
 *
 * Slot ids are lower kebab-case, so a board id is slugged rather than trusted: a board
 * called "Q3 — Roadmap/Plan" must not produce an id the contract refuses. The reverse map
 * is built here rather than parsed back out of the string, so two boards whose names slug
 * alike still answer to their own id.
 */
function boardSlots(
	boards: readonly { readonly id: string; readonly name: string }[],
): {
	readonly rows: readonly {
		readonly id: string;
		readonly label: string;
		readonly boardId: string;
	}[];
	readonly bySlot: ReadonlyMap<string, string>;
} {
	const bySlot = new Map<string, string>();
	const rows = boards.map((board, index) => {
		// The index keeps an id unique even when two names slug to the same word. It is not
		// the board id: the map below is what turns a press back into the real one.
		const slot = `${BOARD_PREFIX}${index}`;
		bySlot.set(slot, board.id);
		return { id: slot, label: board.name, boardId: board.id };
	});
	return { rows, bySlot };
}

export function canvasMenuSlots(input: {
	readonly boards: readonly { readonly id: string; readonly name: string }[];
	readonly activeBoardId: string | null;
	/** The open document's name. */
	readonly title: string | null;
	readonly readOnly: boolean;
	readonly canCreateBoards: boolean;
	readonly explain: boolean;
	readonly interactionMode: string;
	readonly historyOpen: boolean;
	readonly outlineOpen: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
}): MenuSlots {
	const { rows } = boardSlots(input.boards);
	const active = input.boards.find((board) => board.id === input.activeBoardId);

	return {
		format: SUITE_MENU_SLOTS_FORMAT,
		title: input.title,
		navigation: [
			{
				kind: "menu",
				id: MENU_IDS.boards,
				label: active?.name ?? "Boards",
				items: [
					...rows.map((row) => ({
						id: row.id,
						label: row.label,
						...(row.boardId === input.activeBoardId ? { checked: true } : {}),
					})),
					...(input.canCreateBoards
						? [
								{
									id: MENU_IDS.newBoard,
									label: "New board",
									separatorBefore: true,
								},
							]
						: []),
				],
				help: {
					title: "Boards",
					body: "A board is one connected space inside this canvas. This switches between them.",
				},
			},
			...(input.boards.length > 1
				? ([
						{
							kind: "tabs" as const,
							id: MENU_IDS.board,
							label: "Open boards",
							items: input.boards.map((board, index) => ({
								id: `${BOARD_PREFIX}${index}`,
								label: board.name,
								active: board.id === input.activeBoardId,
							})),
						},
					] satisfies MenuSlots["navigation"])
				: []),
			...(input.readOnly
				? []
				: ([
						{
							kind: "buttons" as const,
							id: "canvas.history-controls",
							items: [
								{
									id: MENU_IDS.undo,
									label: "Undo",
									glyph: "\u21b6",
									disabled: !input.canUndo,
								},
								{
									id: MENU_IDS.redo,
									label: "Redo",
									glyph: "\u21b7",
									disabled: !input.canRedo,
								},
								{
									id: MENU_IDS.history,
									label: "Version history",
									glyph: "\u25f4",
									pressed: input.historyOpen,
								},
								{
									id: MENU_IDS.outline,
									label: "Board outline",
									glyph: "\u2630",
									pressed: input.outlineOpen,
								},
							],
						},
					] satisfies MenuSlots["navigation"])),
		],
		actions: [
			{
				id: MENU_IDS.explain,
				label: input.explain ? "Stop explaining" : "Explain mode",
				glyph: "\u25c8",
				pressed: input.explain,
				help: {
					title: "Explain mode",
					body: "Gathers what you have selected into a context you can talk about.",
				},
			},
		],
	};
}

/**
 * Publish Canvas's bar and act on a press, from the state Canvas already keeps.
 *
 * Every handler is the one the in-app bar uses, so the two bars cannot disagree: the same
 * store setter, the same undo stack, the same purpose control.
 */
export function useCanvasMenuBar(
	hosted: MenuBarBridge | null,
	input: {
		readonly boards: readonly { readonly id: string; readonly name: string }[];
		readonly activeBoardId: string | null;
		readonly title: string | null;
		readonly readOnly: boolean;
		readonly canCreateBoards: boolean;
		readonly historyOpen: boolean;
		readonly outlineOpen: boolean;
		readonly onSelectBoard: (boardId: string) => void;
		readonly onNewBoard: () => void;
		readonly onToggleHistory: () => void;
		readonly onToggleOutline: () => void;
		readonly onOpenSearch: () => void;
	},
): MenuSlots | null {
	const purpose = useUiStore((state) => state.purpose);
	const setPurpose = useUiStore((state) => state.setPurpose);
	const interactionMode = useUiStore((state) => state.interactionMode);
	const cycleInteractionMode = useUiStore(
		(state) => state.cycleInteractionMode,
	);
	const workspace = useCanvasStore((state) => state.workspace);
	// A subscription, not a value: the renders that follow a change are what make the
	// `canUndo`/`canRedo` reads below current.
	useWorkspaceSnapshot();

	const canUndo = workspace.canUndo();
	const canRedo = workspace.canRedo();

	const slots = canvasMenuSlots({
		boards: input.boards,
		activeBoardId: input.activeBoardId,
		title: input.title,
		readOnly: input.readOnly,
		canCreateBoards: input.canCreateBoards,
		explain: purpose === "explain",
		interactionMode,
		historyOpen: input.historyOpen,
		outlineOpen: input.outlineOpen,
		canUndo,
		canRedo,
	});
	useMenuSlots(hosted, slots);

	useMenuAction(hosted, (action) => {
		const boardId = boardIdFromAction(action);
		if (boardId !== null) {
			input.onSelectBoard(boardId);
			return;
		}
		if (action.id === MENU_IDS.board && action.item !== undefined) {
			// A tab row names its board by slot too.
			const target =
				input.boards[Number(action.item.slice(BOARD_PREFIX.length))];
			if (target !== undefined) input.onSelectBoard(target.id);
			return;
		}
		switch (action.id) {
			case MENU_IDS.newBoard:
				input.onNewBoard();
				return;
			case MENU_IDS.undo:
				undoWithStack(workspace);
				useUiStore.getState().setSelectedNodeIds([]);
				useUiStore.getState().stopEditing();
				return;
			case MENU_IDS.redo:
				redoWithStack(workspace);
				useUiStore.getState().setSelectedNodeIds([]);
				useUiStore.getState().stopEditing();
				return;
			case MENU_IDS.mode:
				cycleInteractionMode();
				return;
			case MENU_IDS.history:
				input.onToggleHistory();
				return;
			case MENU_IDS.outline:
				input.onToggleOutline();
				return;
			case MENU_IDS.explain:
				setPurpose(purpose === "explain" ? RESTING_PURPOSE : "explain");
				return;
			case MENU_IDS.search:
				input.onOpenSearch();
				return;
			default:
		}
	});

	return slots;
}
