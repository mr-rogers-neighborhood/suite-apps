import { describe, expect, it } from "vitest";
import {
	emptyMenuSlots,
	isMenuSlotAction,
	isMenuSlotId,
	MENU_SLOTS_MAX_CONTROLS,
	parseMenuSlots,
	SUITE_MENU_SLOTS_FORMAT,
} from "./menuBar.js";

/** The shape Canvas publishes: a title, a takeover row and actions. */
const canvasSlots = {
	format: SUITE_MENU_SLOTS_FORMAT,
	title: "Q3 board",
	titleMenu: [{ id: "canvas.rename", label: "Rename workspace" }],
	navigation: [
		{
			kind: "menu",
			id: "canvas.boards",
			label: "Q3 board",
			items: [
				{ id: "canvas.board.q3", label: "Q3 board", checked: true },
				{ id: "canvas.board.roadmap", label: "Roadmap" },
			],
		},
		{
			kind: "tabs",
			id: "canvas.open-boards",
			items: [
				{ id: "canvas.board.q3", label: "Q3 board", active: true },
				{ id: "canvas.board.roadmap", label: "Roadmap", active: false },
			],
		},
		{
			kind: "toggle",
			id: "canvas.explain",
			label: "Explain mode",
			pressed: false,
			glyph: "\u25c8",
			help: {
				title: "Explain mode",
				body: "Gathers what you have selected into a context you can talk about",
			},
		},
		{
			kind: "buttons",
			id: "canvas.history",
			items: [
				{ id: "canvas.undo", label: "Undo", glyph: "\u21b6", disabled: true },
				{ id: "canvas.redo", label: "Redo", glyph: "\u21b7" },
			],
		},
	],
	actions: [{ id: "canvas.share", label: "Share" }],
	status: { id: "canvas.saved", label: "Saved", tone: "ok" },
} as const;

describe("menu-bar slots", () => {
	it("accepts what a real pack publishes", () => {
		const parsed = parseMenuSlots(canvasSlots);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.title).toBe("Q3 board");
		expect(parsed.value.navigation.map((control) => control.kind)).toEqual([
			"menu",
			"tabs",
			"toggle",
			"buttons",
		]);
	});

	it("keeps a control's help, which is the seam an explainer reads", () => {
		const parsed = parseMenuSlots(canvasSlots);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		const toggle = parsed.value.navigation.find(
			(control) => control.kind === "toggle",
		);
		expect(toggle?.help?.title).toBe("Explain mode");
		expect(toggle?.help?.body).toContain("context");
	});

	it("describes an empty bar without any pack material", () => {
		expect(parseMenuSlots(emptyMenuSlots()).ok).toBe(true);
		const empty = emptyMenuSlots();
		expect(empty.navigation).toEqual([]);
		expect(empty.actions).toEqual([]);
		expect(empty.title).toBeNull();
	});

	it("rejects a format it does not know", () => {
		const parsed = parseMenuSlots({
			...canvasSlots,
			format: "suite.something-else",
		});
		expect(parsed.ok).toBe(false);
	});

	it("rejects an id that is not the pack-local dotted shape", () => {
		for (const id of [
			"Canvas Share",
			"canvas/share",
			"../canvas",
			"",
			"canvas..share",
		]) {
			expect(isMenuSlotId(id), id).toBe(false);
		}
		expect(isMenuSlotId("canvas.board.q3")).toBe(true);
		expect(isMenuSlotId("Canvas.Share")).toBe(false);
	});

	it("rejects a control kind the host does not draw", () => {
		const parsed = parseMenuSlots({
			...canvasSlots,
			navigation: [{ kind: "slider", id: "canvas.zoom", label: "Zoom" }],
		});
		expect(parsed.ok).toBe(false);
	});

	it("rejects markup and fields it does not know, so a pack cannot smuggle styling", () => {
		const withUnknown = parseMenuSlots({
			...canvasSlots,
			actions: [
				{ id: "canvas.share", label: "Share", className: "text-red-500" },
			],
		});
		expect(withUnknown.ok).toBe(false);

		const withHtml = parseMenuSlots({
			...canvasSlots,
			actions: [{ id: "canvas.share", label: "<img src=x onerror=alert(1)>" }],
		});
		// A label is text, not markup: it is accepted as a string and can never be parsed as
		// HTML because the host renders it as a text node. Length is the only bound we need.
		expect(withHtml.ok).toBe(true);
	});

	it("bounds the payload so one publish cannot flood the bar", () => {
		const tooMany = parseMenuSlots({
			...canvasSlots,
			navigation: Array.from(
				{ length: MENU_SLOTS_MAX_CONTROLS + 1 },
				(_, index) => ({
					kind: "toggle" as const,
					id: `canvas.toggle-${index}`,
					label: "Toggle",
					pressed: false,
				}),
			),
		});
		expect(tooMany.ok).toBe(false);
	});

	it("caps a glyph at a few characters and needs a label anyway", () => {
		const longGlyph = parseMenuSlots({
			...canvasSlots,
			actions: [
				{ id: "canvas.share", label: "Share", glyph: "share-icon-name" },
			],
		});
		expect(longGlyph.ok).toBe(false);

		const noLabel = parseMenuSlots({
			...canvasSlots,
			actions: [{ id: "canvas.share", glyph: "\u21ea" }],
		});
		expect(noLabel.ok).toBe(false);
	});

	it("rejects a tone that is not a theme role", () => {
		const parsed = parseMenuSlots({
			...canvasSlots,
			status: { id: "canvas.saved", label: "Saving", tone: "#ff0000" },
		});
		expect(parsed.ok).toBe(false);
	});
});

describe("the action a host echoes back", () => {
	it("is a pack-local id, optionally naming the row inside it", () => {
		expect(isMenuSlotAction({ id: "canvas.explain" })).toBe(true);
		expect(
			isMenuSlotAction({ id: "canvas.boards", item: "canvas.board.q3" }),
		).toBe(true);
	});

	it("refuses a press the host could not have produced", () => {
		expect(isMenuSlotAction(null)).toBe(false);
		expect(isMenuSlotAction({})).toBe(false);
		expect(isMenuSlotAction({ id: "Canvas Share" })).toBe(false);
		expect(isMenuSlotAction({ id: "canvas.boards", item: "../x" })).toBe(false);
		expect(isMenuSlotAction({ id: "canvas.boards", item: 3 })).toBe(false);
	});
});
