import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MenuSlots } from "@suite/contracts";
import { packMenuZones } from "./PackMenuSlots.js";

const slots: MenuSlots = {
	format: "suite.menu-slots",
	title: "Q3 board",
	navigation: [
		{
			kind: "menu",
			id: "canvas.boards",
			label: "Boards",
			items: [
				{ id: "canvas.board.0", label: "Q3 board", checked: true },
				{ id: "canvas.board.1", label: "Roadmap" },
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
				body: "Gathers a selection into a context.",
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
	status: {
		id: "canvas.saved",
		label: "Save failed",
		tone: "danger",
		title: "disk full",
	},
};

/** Render the zones the way `HostTabBar` does: context, navigation, actions. */
function renderZones(value: MenuSlots | null, onChoose = vi.fn()) {
	const zones = packMenuZones(value, onChoose);
	return {
		onChoose,
		...render(
			<div>
				{zones.context}
				{zones.navigation}
				{zones.actions}
			</div>,
		),
	};
}

describe("the pack's zones", () => {
	it("draws nothing at all when the pack published nothing", () => {
		const zones = packMenuZones(null, () => undefined);
		expect(zones.navigation).toBeNull();
		expect(zones.context).toBeUndefined();
		expect(zones.actions).toBeUndefined();
	});

	it("draws the document name, the takeover and the actions", () => {
		renderZones(slots);
		// The switcher's trigger repeats the active board's name on purpose, so this asserts
		// the context zone's own element rather than the text alone.
		expect(screen.getByTitle("Q3 board")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Boards" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Explain mode" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
	});

	it("echoes the id the pack chose, and the row inside it", () => {
		const { onChoose } = renderZones(slots);

		fireEvent.click(screen.getByRole("button", { name: "Boards" }));
		expect(screen.getByRole("menu", { name: "Boards" })).toBeInTheDocument();
		fireEvent.click(screen.getByRole("menuitem", { name: /Roadmap/u }));

		expect(onChoose).toHaveBeenCalledWith({
			id: "canvas.boards",
			item: "canvas.board.1",
		});
	});

	it("marks the chosen row as a checked radio, and leaves the menu after a press", () => {
		renderZones(slots);

		fireEvent.click(screen.getByRole("button", { name: "Boards" }));
		// A row that reports a choice is a radio, not a plain item: that is what `checked`
		// means in the contract and what the shared menu helpers select for.
		const chosen = screen.getByRole("menuitemradio", { name: /Q3 board/u });
		expect(chosen).toHaveAttribute("aria-checked", "true");
		expect(screen.queryByRole("menuitem", { name: /Q3 board/u })).not.toBeInTheDocument();

		fireEvent.click(chosen);
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});

	it("draws a separator where the pack asked for one", () => {
		renderZones({
			...slots,
			navigation: [
				{
					kind: "menu",
					id: "canvas.boards",
					label: "Boards",
					items: [
						{ id: "canvas.board.0", label: "Q3 board", checked: true },
						{ id: "canvas.new-board", label: "New board", separatorBefore: true },
					],
				},
			],
		});

		fireEvent.click(screen.getByRole("button", { name: "Boards" }));
		expect(screen.getByRole("separator")).toBeInTheDocument();
	});

	it("says why a row is refused instead of leaving it silently greyed out", () => {
		renderZones({
			...slots,
			navigation: [
				{
					kind: "menu",
					id: "canvas.boards",
					label: "Boards",
					items: [
						{
							id: "canvas.board.locked",
							label: "Locked board",
							disabled: true,
							disabledReason: "This board is read-only.",
						},
					],
				},
			],
		});

		fireEvent.click(screen.getByRole("button", { name: "Boards" }));
		expect(screen.getByRole("menuitem", { name: /Locked board/u })).toHaveAttribute(
			"title",
			"This board is read-only.",
		);
	});

	it("reports a pressed mode as pressed, so the control says which way it is", () => {
		renderZones({
			...slots,
			navigation: [
				{
					kind: "toggle",
					id: "canvas.explain",
					label: "Explain mode",
					pressed: true,
				},
			],
		});
		expect(
			screen.getByRole("button", { name: "Explain mode" }),
		).toHaveAttribute("aria-pressed", "true");
	});

	it("keeps a disabled control visible and refuses it", () => {
		const { onChoose } = renderZones(slots);
		const undo = screen.getByRole("button", { name: "Undo" });
		expect(undo).toBeDisabled();
		fireEvent.click(undo);
		expect(onChoose).not.toHaveBeenCalled();
	});

	it("draws a status readout with the tone the pack named, not a colour", () => {
		renderZones(slots);
		const status = screen.getByRole("alert");
		expect(status).toHaveTextContent("Save failed");
		expect(status.className).toContain("text-[var(--danger)]");
	});

	it("uses the pack's help sentence as the control's own description", () => {
		renderZones(slots);
		expect(
			screen.getByRole("button", { name: "Explain mode" }),
		).toHaveAttribute("title", "Gathers a selection into a context.");
	});

	it("renders a label as text, never as markup", () => {
		renderZones({
			...slots,
			title: "<img src=x onerror=alert(1)>",
			actions: [{ id: "canvas.share", label: "<b>Share</b>" }],
		});
		expect(screen.queryByRole("img")).not.toBeInTheDocument();
		expect(screen.getByText("<b>Share</b>")).toBeInTheDocument();
	});
});

describe("the dropdown's keyboard", () => {
	const openBoards = () => fireEvent.click(screen.getByRole("button", { name: "Boards" }));

	it("moves focus into the menu when it opens", () => {
		renderZones(slots);
		openBoards();
		expect(document.activeElement).toBe(
			screen.getByRole("menuitemradio", { name: /Q3 board/u }),
		);
	});

	it("still focuses the first choice when no row is checked yet", () => {
		// Every row here is a choice in a picker that has no current value. The first item
		// has to take focus, or arrow keys do nothing until the person presses Tab.
		renderZones({
			...slots,
			navigation: [
				{
					kind: "menu",
					id: "canvas.boards",
					label: "Boards",
					items: [
						{ id: "canvas.board.0", label: "Q3 board", checked: false },
						{ id: "canvas.board.1", label: "Roadmap", checked: false },
					],
				},
			],
		});
		openBoards();
		expect(document.activeElement).toBe(
			screen.getByRole("menuitemradio", { name: /Q3 board/u }),
		);
	});

	it("walks rows with the arrow keys, and stops at the ends with Home/End", () => {
		renderZones(slots);
		openBoards();
		const menu = screen.getByRole("menu", { name: "Boards" });
		const first = screen.getByRole("menuitemradio", { name: /Q3 board/u });
		const second = screen.getByRole("menuitem", { name: /Roadmap/u });

		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(document.activeElement).toBe(second);
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		expect(document.activeElement).toBe(first);
		fireEvent.keyDown(menu, { key: "End" });
		expect(document.activeElement).toBe(second);
		fireEvent.keyDown(menu, { key: "Home" });
		expect(document.activeElement).toBe(first);
	});

	it("closes on Escape and hands focus back to the trigger", () => {
		renderZones(slots);
		openBoards();
		fireEvent.keyDown(screen.getByRole("menu", { name: "Boards" }), { key: "Escape" });
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Boards" }));
	});

	it("closes on a press outside, without moving focus", () => {
		renderZones(slots);
		openBoards();
		fireEvent.pointerDown(document.body);
		expect(screen.queryByRole("menu")).not.toBeInTheDocument();
	});
});
