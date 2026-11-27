import { z } from "zod";
import { type ContractParse, parseWith } from "./parse.js";

/**
 * The menu-bar slot vocabulary (`S11.3`, the bridge `bridges.md` specified).
 *
 * A pack that runs inside a host does not draw a top bar. The host owns the one physical
 * bar, and the active pack publishes the material for the zones it is allowed to fill:
 * its document's name, a takeover for its own view switching, and its actions. The host
 * draws them and sends an id back when one is chosen.
 *
 * ## Descriptors are opaque, on purpose
 *
 * The host does not know what "explain" means, or "board", or "reconcile". It receives a
 * `kind` that says how to *draw* a control and an `id` that says *which* control it is,
 * and it echoes the id back. Every meaning stays in the pack.
 *
 * That is not tidiness, it is the condition for the feature the owner wants next: one
 * explain/tutorial layer that works in every app. A host that understood "toggle explain"
 * would have to learn every app's vocabulary, and a new app would need a host change to
 * be explainable. With opaque ids, an explainer walks the bar, asks each control what it
 * is (see `help`), and speaks about it — in a pack it has never seen.
 *
 * ## `help` is the seam, and it is deliberately optional
 *
 * Every control may carry `help: { title, body? }`. Nothing reads it yet. It is the one
 * field the future explainer needs that the host cannot invent, so it is in the contract
 * now: a pack author writes one sentence beside the control, and the control becomes
 * explainable without a second mechanism.
 *
 * ## What is not here
 *
 * No DOM, no React, no callbacks across the wire — only data. No icon-name registry
 * either: a `glyph` is a short string the pack chooses, and a label is always present, so
 * a control is never an unlabelled square. Free-form text is never markup.
 */
export const SUITE_MENU_SLOTS_FORMAT = "suite.menu-slots";

/** The id a host echoes back. Pack-local, dotted lower kebab-case, like a command id. */
const SLOT_ID = /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*$/u;

export const MENU_SLOT_ID_MAX = 96;
export const MENU_SLOT_LABEL_MAX = 80;
export const MENU_SLOT_GLYPH_MAX = 4;
export const MENU_SLOTS_MAX_CONTROLS = 24;
export const MENU_SLOTS_MAX_ITEMS = 60;

export function isMenuSlotId(value: string): boolean {
	return (
		value.length > 0 && value.length <= MENU_SLOT_ID_MAX && SLOT_ID.test(value)
	);
}

/**
 * The one sentence a future explainer reads.
 *
 * `title` says what the control is ("Explain mode"); `body` says what it does to the
 * document ("Gathers what you have selected into a context you can talk about"). The
 * sentence rule is the handbook's: address the reader, name the effect, no protocol words.
 */
export interface MenuHelp {
	readonly title: string;
	readonly body?: string;
}

const helpSchema = z
	.object({
		title: z.string().min(1).max(MENU_SLOT_LABEL_MAX),
		body: z.string().min(1).max(400).optional(),
	})
	.strict();

/**
 * One row in a dropdown: a command, or a choice that is on or off.
 *
 * `separatorBefore` is how a menu groups itself without the host inventing sections, and
 * `checked` is how an exclusive choice reports the current value. A row with `checked`
 * and no `disabled` is a live choice; a row with neither is a command.
 */
export interface MenuRow {
	readonly id: string;
	readonly label: string;
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly shortcut?: string;
	readonly separatorBefore?: boolean;
	readonly help?: MenuHelp;
}

const rowSchema = z
	.object({
		id: z.string().refine(isMenuSlotId, "not a menu slot id"),
		label: z.string().min(1).max(MENU_SLOT_LABEL_MAX),
		checked: z.boolean().optional(),
		disabled: z.boolean().optional(),
		shortcut: z.string().min(1).max(24).optional(),
		separatorBefore: z.boolean().optional(),
		help: helpSchema.optional(),
	})
	.strict();

/** A pressable control the bar draws as a button, with or without a glyph. */
export interface MenuButton {
	readonly id: string;
	/** The accessible name. Always present, so a glyph-only button is still readable. */
	readonly label: string;
	/** A short text glyph, at most a few characters. Not an icon name. */
	readonly glyph?: string;
	readonly pressed?: boolean;
	readonly disabled?: boolean;
	/** A longer hover sentence, when `label` is too terse for one. */
	readonly title?: string;
	readonly help?: MenuHelp;
}

const buttonSchema = z
	.object({
		id: z.string().refine(isMenuSlotId, "not a menu slot id"),
		label: z.string().min(1).max(MENU_SLOT_LABEL_MAX),
		glyph: z.string().min(1).max(MENU_SLOT_GLYPH_MAX).optional(),
		pressed: z.boolean().optional(),
		disabled: z.boolean().optional(),
		title: z.string().min(1).max(160).optional(),
		help: helpSchema.optional(),
	})
	.strict();

/** A tab-like choice inside a takeover row. `active` marks the one being shown. */
export interface MenuTab {
	readonly id: string;
	readonly label: string;
	readonly active: boolean;
	readonly help?: MenuHelp;
}

const tabSchema = z
	.object({
		id: z.string().refine(isMenuSlotId, "not a menu slot id"),
		label: z.string().min(1).max(MENU_SLOT_LABEL_MAX),
		active: z.boolean(),
		help: helpSchema.optional(),
	})
	.strict();

/**
 * One control in the takeover row.
 *
 * The four kinds are the union of what Canvas, Planner and Budget actually draw:
 * a dropdown (`Canvas`'s board switcher, `Planner`'s view menu), a tab row (Canvas's
 * open boards), a toggle (Canvas's explain purpose, its interaction mode), and a group
 * of icon buttons (undo/redo, history, outline, views).
 */
export type MenuNavControl =
	| {
			readonly kind: "menu";
			readonly id: string;
			readonly label: string;
			readonly items: readonly MenuRow[];
			readonly help?: MenuHelp;
	  }
	| {
			readonly kind: "tabs";
			readonly id: string;
			readonly items: readonly MenuTab[];
			readonly help?: MenuHelp;
	  }
	| {
			readonly kind: "toggle";
			readonly id: string;
			readonly label: string;
			readonly pressed: boolean;
			readonly glyph?: string;
			readonly title?: string;
			readonly help?: MenuHelp;
	  }
	| {
			readonly kind: "buttons";
			readonly id: string;
			readonly items: readonly MenuButton[];
			readonly help?: MenuHelp;
	  };

const navControlSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("menu"),
			id: z.string().refine(isMenuSlotId, "not a menu slot id"),
			label: z.string().min(1).max(MENU_SLOT_LABEL_MAX),
			items: z.array(rowSchema).max(MENU_SLOTS_MAX_ITEMS),
			help: helpSchema.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("tabs"),
			id: z.string().refine(isMenuSlotId, "not a menu slot id"),
			items: z.array(tabSchema).max(MENU_SLOTS_MAX_ITEMS),
			help: helpSchema.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("toggle"),
			id: z.string().refine(isMenuSlotId, "not a menu slot id"),
			label: z.string().min(1).max(MENU_SLOT_LABEL_MAX),
			pressed: z.boolean(),
			glyph: z.string().min(1).max(MENU_SLOT_GLYPH_MAX).optional(),
			title: z.string().min(1).max(160).optional(),
			help: helpSchema.optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("buttons"),
			id: z.string().refine(isMenuSlotId, "not a menu slot id"),
			items: z.array(buttonSchema).max(MENU_SLOTS_MAX_ITEMS),
			help: helpSchema.optional(),
		})
		.strict(),
]);

/**
 * A short state readout, such as Budget's unsaved-changes warning.
 *
 * `tone` is the only styling hint the host accepts, and it is a role name, not a colour.
 */
export interface MenuStatus {
	readonly id: string;
	readonly label: string;
	readonly tone: "quiet" | "ok" | "warn" | "danger";
	readonly title?: string;
	readonly help?: MenuHelp;
}

const statusSchema = z
	.object({
		id: z.string().refine(isMenuSlotId, "not a menu slot id"),
		label: z.string().min(1).max(MENU_SLOT_LABEL_MAX),
		tone: z.enum(["quiet", "ok", "warn", "danger"]),
		title: z.string().min(1).max(160).optional(),
		help: helpSchema.optional(),
	})
	.strict();

/**
 * Everything a hosted pack publishes for the bar.
 *
 * A pack publishes this object whole, on every change, rather than patching a zone. One
 * shape with one owner is easier to reason about than four partial updates that can
 * arrive out of order, and the payload is small: a bar has a handful of controls.
 */
export interface MenuSlots {
	readonly format: typeof SUITE_MENU_SLOTS_FORMAT;
	/** The open document's name, or null when the pack has no document. */
	readonly title: string | null;
	/** A menu on the title: the pack's document switcher, when it has one. */
	readonly titleMenu?: readonly MenuRow[];
	/** The takeover row, left to right. */
	readonly navigation: readonly MenuNavControl[];
	/** The pack's own actions, drawn before the host's controls. */
	readonly actions: readonly MenuButton[];
	/** A state readout, drawn with the actions. */
	readonly status?: MenuStatus;
}

const menuSlotsSchema = z
	.object({
		format: z.literal(SUITE_MENU_SLOTS_FORMAT),
		title: z.string().min(1).max(200).nullable(),
		titleMenu: z.array(rowSchema).max(MENU_SLOTS_MAX_ITEMS).optional(),
		navigation: z.array(navControlSchema).max(MENU_SLOTS_MAX_CONTROLS),
		actions: z.array(buttonSchema).max(MENU_SLOTS_MAX_CONTROLS),
		status: statusSchema.optional(),
	})
	.strict();

export type MenuSlotsInput = z.infer<typeof menuSlotsSchema>;

/**
 * Parse what a pack published. A pack is not trusted, so this runs at the boundary.
 *
 * The shape is small and the whole object is replaced on every publish, so a rejected
 * publish leaves the previous slots in place rather than half-applying a broken one.
 */
export function parseMenuSlots(value: unknown): ContractParse<MenuSlots> {
	return parseWith(menuSlotsSchema, value) as ContractParse<MenuSlots>;
}

/**
 * The control a press names, as the pack receives it back.
 *
 * `item` is present when the press was inside a menu or a tab row. The pack decides what
 * `id` and `item` mean together; the host only needs to know which bar control was used.
 */
export interface MenuSlotAction {
	readonly id: string;
	readonly item?: string;
}

export function isMenuSlotAction(value: unknown): value is MenuSlotAction {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || !isMenuSlotId(record.id)) return false;
	if (record.item === undefined) return true;
	return typeof record.item === "string" && isMenuSlotId(record.item);
}

/** An empty publish: the bar keeps only the host's own zones. */
export function emptyMenuSlots(): MenuSlots {
	return {
		format: SUITE_MENU_SLOTS_FORMAT,
		title: null,
		navigation: [],
		actions: [],
	};
}
