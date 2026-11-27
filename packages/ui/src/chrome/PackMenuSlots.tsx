import type {
	MenuButton,
	MenuNavControl,
	MenuRow,
	MenuSlotAction,
	MenuSlots,
	MenuStatus,
} from "@suite/contracts";
import { useEffect, useRef, useState } from "react";
import { cx } from "../cx.js";
import { FOCUS_RING, MOTION } from "../tokens.js";

/**
 * The active pack's material, drawn in the host's one menu bar.
 *
 * This is the host half of the `MenuBar` contract: the host owns the bar, and the pack
 * that is in front supplies the middle of it. The components here render descriptors and
 * send back the id the pack chose; they interpret nothing.
 *
 * ## Why nothing here knows what a control means
 *
 * A control arrives as `{ kind, id, label }`. `kind` says how to draw it and `id` says
 * which one it is. The host does not know that `canvas.explain` toggles a mode, or that
 * `planner.view` switches a view, so it cannot special-case either.
 *
 * That restraint is the condition for the tutorial layer the owner wants: one explainer
 * that works in every app. Such a layer walks the bar, reads each control's `label` and
 * its optional `help`, and speaks about it — including in a pack the explainer has never
 * seen. A host that hardcoded "explain mode" would need a host change per app, and the
 * feature would never be cross-app.
 *
 * ## What the host does decide
 *
 * Only presentation: which zone a control lands in, how a menu opens and closes, focus
 * order, and the ARIA. A pack cannot choose a colour, a pixel or a font; `tone` names a
 * theme role, and a `glyph` is text, never markup.
 */
export interface PackMenuZones {
	/** The document's name, and its switcher menu when the pack publishes one. */
	readonly context?: React.ReactNode;
	/** The takeover row. */
	readonly navigation: React.ReactNode;
	/** The pack's actions and status readout. */
	readonly actions?: React.ReactNode;
}

const ROW =
	"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-label,12px)] outline-none";
const CONTROL =
	"flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[length:var(--text-label,12px)]";
const MENU_BOX =
	"absolute left-0 top-full z-50 mt-1 min-w-44 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-[var(--shadow-xl)]";

/** A small dropdown, opened from one control in the takeover row. */
function SlotMenu({
	id,
	label,
	items,
	glyph,
	onChoose,
}: {
	readonly id: string;
	readonly label: string;
	readonly items: readonly MenuRow[];
	readonly glyph?: string | undefined;
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement | null>(null);
	const checked = items.find((item) => item.checked === true);

	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!root.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);

	return (
		<div className="relative shrink-0" ref={root}>
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={label}
				title={label}
				data-slot-id={id}
				onClick={() => setOpen((value) => !value)}
				className={cx(
					CONTROL,
					"bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-sunk)]",
					MOTION,
					FOCUS_RING,
				)}
			>
				{glyph === undefined ? null : (
					<span aria-hidden="true" className="shrink-0">
						{glyph}
					</span>
				)}
				<span className="min-w-0 max-w-40 truncate">
					{checked?.label ?? label}
				</span>
				<span aria-hidden="true" className="shrink-0 text-[var(--ink-faint)]">
					{"\u25be"}
				</span>
			</button>
			{open ? (
				<div role="menu" aria-label={label} className={MENU_BOX}>
					{items.map((item) => (
						<button
							key={item.id}
							type="button"
							role="menuitem"
							aria-current={item.checked === true ? "true" : undefined}
							disabled={item.disabled === true}
							title={item.help?.body ?? item.help?.title ?? item.label}
							data-slot-item={item.id}
							onClick={() => {
								setOpen(false);
								onChoose({ id, item: item.id });
							}}
							className={cx(
								ROW,
								"hover:bg-[var(--surface-sunk)] disabled:opacity-40",
								item.checked === true
									? "text-[var(--ink)]"
									: "text-[var(--ink-muted)]",
								MOTION,
								FOCUS_RING,
							)}
						>
							<span
								aria-hidden="true"
								className="w-3 shrink-0 text-[var(--accent)]"
							>
								{item.checked === true ? "\u2713" : ""}
							</span>
							<span className="min-w-0 flex-1 truncate">{item.label}</span>
							{item.shortcut === undefined ? null : (
								<kbd className="shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
									{item.shortcut}
								</kbd>
							)}
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

/** A row of tabs, one of which is the surface being shown. */
function SlotTabs({
	id,
	items,
	onChoose,
}: {
	readonly id: string;
	readonly items: readonly {
		readonly id: string;
		readonly label: string;
		readonly active: boolean;
	}[];
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	return (
		<div
			role="tablist"
			aria-label="Open boards"
			className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			{items.map((item) => (
				<button
					key={item.id}
					type="button"
					role="tab"
					aria-selected={item.active}
					data-slot-id={id}
					data-slot-item={item.id}
					onClick={() => onChoose({ id, item: item.id })}
					className={cx(
						CONTROL,
						"max-w-[180px]",
						item.active
							? "bg-[var(--surface)] text-[var(--ink)] shadow-[inset_0_-2px_0_var(--accent)]"
							: "text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
						MOTION,
						FOCUS_RING,
					)}
				>
					<span className="min-w-0 truncate">{item.label}</span>
				</button>
			))}
		</div>
	);
}

/** A mode control: on or off, with a glyph and a label that says which. */
function SlotToggle({
	id,
	label,
	pressed,
	glyph,
	title,
	help,
	onChoose,
}: {
	readonly id: string;
	readonly label: string;
	readonly pressed: boolean;
	readonly glyph?: string | undefined;
	readonly title?: string | undefined;
	readonly help?:
		| { readonly title: string; readonly body?: string }
		| undefined;
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={pressed}
			aria-label={label}
			// The pack's own sentence, when it wrote one, is the better description: it is the
			// text an explainer would say, so showing it on hover makes the two agree.
			title={title ?? help?.body ?? help?.title ?? label}
			data-slot-id={id}
			data-slot-pressed={pressed ? "true" : "false"}
			onClick={() => onChoose({ id })}
			className={cx(
				CONTROL,
				pressed
					? "bg-[var(--accent)] text-[var(--on-accent)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
				MOTION,
				FOCUS_RING,
			)}
		>
			{glyph === undefined ? (
				<span className="min-w-0 truncate">{label}</span>
			) : (
				<span aria-hidden="true" className="shrink-0">
					{glyph}
				</span>
			)}
		</button>
	);
}

/** A group of icon buttons: undo/redo, history, outline. */
function SlotButtons({
	buttons,
	onChoose,
}: {
	readonly buttons: readonly MenuButton[];
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	return (
		<span className="flex shrink-0 items-center gap-0.5">
			{buttons.map((button) => (
				<button
					key={button.id}
					type="button"
					aria-label={button.label}
					aria-pressed={
						button.pressed === undefined ? undefined : button.pressed
					}
					title={button.title ?? button.label}
					disabled={button.disabled === true}
					data-slot-id={button.id}
					onClick={() => onChoose({ id: button.id })}
					className={cx(
						CONTROL,
						"px-1.5 text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)] disabled:opacity-40",
						button.pressed === true
							? "bg-[var(--surface-sunk)] text-[var(--ink)]"
							: undefined,
						MOTION,
						FOCUS_RING,
					)}
				>
					{button.glyph === undefined ? (
						<span className="min-w-0 truncate">{button.label}</span>
					) : (
						<span aria-hidden="true">{button.glyph}</span>
					)}
				</button>
			))}
		</span>
	);
}

const TONE: Record<MenuStatus["tone"], string> = {
	quiet: "text-[var(--ink-faint)]",
	ok: "text-[var(--ink-muted)]",
	warn: "text-[var(--warning)]",
	danger: "text-[var(--danger)]",
};

/**
 * Turn the pack's publication into the three zones the bar has room for.
 *
 * Returned as nodes rather than rendered in place, so `HostTabBar` keeps ownership of the
 * bar's layout: the host decides where a zone sits, and a pack only decides what is in it.
 */
export function packMenuZones(
	slots: MenuSlots | null,
	onChoose: (action: MenuSlotAction) => void,
): PackMenuZones {
	if (slots === null) return { navigation: null };

	const context =
		slots.title === null ? null : (
			<div className="hidden min-w-0 shrink-0 items-center lg:flex">
				<span
					className="max-w-56 truncate text-[length:var(--text-body,13px)] font-medium text-[var(--ink)]"
					title={slots.title}
				>
					{slots.title}
				</span>
			</div>
		);

	const navigation = (
		<div className="flex min-w-0 flex-initial items-center gap-1">
			{slots.navigation.map((control: MenuNavControl) => {
				switch (control.kind) {
					case "menu":
						return (
							<SlotMenu
								key={control.id}
								id={control.id}
								label={control.label}
								items={control.items}
								onChoose={onChoose}
							/>
						);
					case "tabs":
						return (
							<SlotTabs
								key={control.id}
								id={control.id}
								items={control.items}
								onChoose={onChoose}
							/>
						);
					case "toggle":
						return (
							<SlotToggle
								key={control.id}
								id={control.id}
								label={control.label}
								pressed={control.pressed}
								glyph={control.glyph}
								title={control.title}
								help={control.help}
								onChoose={onChoose}
							/>
						);
					case "buttons":
						return (
							<SlotButtons
								key={control.id}
								buttons={control.items}
								onChoose={onChoose}
							/>
						);
				}
			})}
		</div>
	);

	const status =
		slots.status === undefined ? null : (
			<span
				role={slots.status.tone === "danger" ? "alert" : undefined}
				title={
					slots.status.title ?? slots.status.help?.body ?? slots.status.label
				}
				data-slot-id={slots.status.id}
				className={cx(
					"shrink-0 text-[length:var(--text-caption,11px)]",
					TONE[slots.status.tone],
				)}
			>
				{slots.status.label}
			</span>
		);

	const actions =
		slots.actions.length === 0 && status === null ? null : (
			<div className="flex shrink-0 items-center gap-1">
				{status}
				{slots.actions.map((button) => (
					<button
						key={button.id}
						type="button"
						aria-label={button.label}
						aria-pressed={
							button.pressed === undefined ? undefined : button.pressed
						}
						title={button.title ?? button.help?.body ?? button.label}
						disabled={button.disabled === true}
						data-slot-id={button.id}
						onClick={() => onChoose({ id: button.id })}
						className={cx(
							CONTROL,
							"border border-[var(--hairline)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-sunk)] disabled:opacity-40",
							MOTION,
							FOCUS_RING,
						)}
					>
						{button.glyph === undefined ? null : (
							<span aria-hidden="true" className="shrink-0">
								{button.glyph}
							</span>
						)}
						<span className="min-w-0 truncate">{button.label}</span>
					</button>
				))}
			</div>
		);

	return {
		...(context === null ? {} : { context }),
		navigation,
		...(actions === null ? {} : { actions }),
	};
}
