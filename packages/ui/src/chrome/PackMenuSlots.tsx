import type {
	MenuButton,
	MenuNavControl,
	MenuRow,
	MenuSlotAction,
	MenuSlots,
	MenuStatus,
} from "@suite/contracts";
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx.js";
import { menuKeyDown } from "../menu/menuKeys.js";
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
	/** The takeover row. Null when the pack published no controls, so the host can omit the zone. */
	readonly navigation: React.ReactNode | null;
	/** The pack's actions and status readout. */
	readonly actions?: React.ReactNode;
	/** The navigation controls in order, each with an inline node and folded rows. */
	readonly controls: readonly PackMenuControl[];
}

const ROW =
	"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-label,12px)] outline-none";
const CONTROL =
	"flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-[length:var(--text-label,12px)]";
const MENU_BOX =
	"fixed z-50 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-[var(--shadow-xl)] starting:scale-95 starting:opacity-0 motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--duration-fast,100ms)] motion-safe:ease-[var(--ease-standard,cubic-bezier(0.4,0,0.2,1))]";

const TONE: Record<MenuStatus["tone"], string> = {
	quiet: "text-[var(--ink-faint)]",
	ok: "text-[var(--ink-muted)]",
	warn: "text-[var(--warning)]",
	danger: "text-[var(--danger)]",
};

/**
 * One row of the host's overflow menu for a pack row that does not fit.
 *
 * The fold menu is the host's own surface: a pack publishes descriptors, the host decides
 * where they go. `choose` closes over the pack's published id, so the host still never
 * learns what the row means.
 */
export interface PackMenuFoldRow {
	readonly key: string;
	readonly label: string;
	readonly glyph?: string;
	readonly description?: string;
	readonly role: "command" | "choice" | "toggle";
	readonly checked?: boolean;
	readonly disabled?: boolean;
	readonly disabledReason?: string;
	/** A heading for the rows of one control, when the menu mixes controls. */
	readonly group?: string;
	readonly choose: () => void;
}

/** One takeover control, with both its inline node and its folded rows. */
export interface PackMenuControl {
	readonly key: string;
	readonly label: string;
	readonly node: ReactNode;
	readonly rows: readonly PackMenuFoldRow[];
}

/** A small dropdown, opened from one control in the takeover row. */
function SlotMenu({
	id,
	label,
	items,
	glyph,
	help,
	onChoose,
}: {
	readonly id: string;
	readonly label: string;
	readonly items: readonly MenuRow[];
	readonly glyph?: string | undefined;
	readonly help?:
		| { readonly title: string; readonly body?: string }
		| undefined;
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	const [open, setOpen] = useState(false);
	const root = useRef<HTMLDivElement | null>(null);
	const menu = useRef<HTMLDivElement | null>(null);
	// The panel is positioned from the trigger's box, not `absolute` inside it: the bar is
	// an `overflow-x-auto` container, which would clip a dropdown to the bar's own height.
	const [at, setAt] = useState<{ left: number; top: number; minWidth: number } | null>(null);
	const checked = items.find((item) => item.checked === true);

	const place = useCallback(() => {
		const trigger = root.current?.getBoundingClientRect();
		if (trigger === undefined) return;
		setAt({
			left: Math.max(8, Math.min(trigger.left, window.innerWidth - 240)),
			top: trigger.bottom + 4,
			minWidth: Math.max(176, trigger.width),
		});
	}, []);

	function close(returnFocus: boolean) {
		setOpen(false);
		setAt(null);
		if (returnFocus) root.current?.querySelector("button")?.focus();
	}

	useEffect(() => {
		if (!open) return;
		// Focus the current choice, or the first row, the way a menu is expected to open.
		// A single compound selector would return the first row in *document order*, not the
		// checked one, so the checked query has to stand alone and fall back to a plain row.
		const panel = menu.current;
		const target =
			panel?.querySelector<HTMLElement>("[aria-checked='true']:not([disabled])") ??
			panel?.querySelector<HTMLElement>(
				"[role='menuitemradio']:not([disabled]), [role='menuitem']:not([disabled])",
			);
		target?.focus();

		const onPointerDown = (event: PointerEvent) => {
			const inside =
				root.current?.contains(event.target as Node) === true ||
				menu.current?.contains(event.target as Node) === true;
			if (!inside) close(false);
		};
		const onReposition = () => place();
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("resize", onReposition);
		window.addEventListener("scroll", onReposition, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("resize", onReposition);
			window.removeEventListener("scroll", onReposition, true);
		};
	}, [open, place]);

	return (
		<div className="relative shrink-0" ref={root}>
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={label}
				title={help?.body ?? help?.title ?? label}
				data-slot-id={id}
				onClick={() => {
					if (!open) place();
					setOpen(!open);
				}}
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
			{open && at !== null
				? createPortal(
						<div
							ref={menu}
							role="menu"
							aria-label={label}
							className={MENU_BOX}
							style={{ left: at.left, top: at.top, minWidth: at.minWidth }}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									close(true);
									return;
								}
								// Arrow/Home/End/typeahead behaviour is the one shared helper, so a
								// menu in the bar behaves like a menu anywhere else in the suite.
								menuKeyDown(event);
							}}
						>
							{items.map((item) => (
								<Fragment key={item.id}>
									{item.separatorBefore === true && item.checked !== true ? (
										<div
											role="separator"
											className="my-1 h-px bg-[var(--hairline)]"
										/>
									) : null}
									<button
										type="button"
										// A row that reports a choice is a radio, not a plain item: that is
										// what `menuKeys.ts` selects for and what `checked` means.
										role={item.checked === undefined ? "menuitem" : "menuitemradio"}
										aria-checked={item.checked}
										disabled={item.disabled === true}
										title={
											item.disabledReason ??
											item.help?.body ??
											item.help?.title ??
											item.label
										}
										data-slot-item={item.id}
										onClick={() => {
											close(true);
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
										<span className="min-w-0 flex-1">
											<span className="block truncate">{item.label}</span>
											{item.description === undefined ? null : (
												<span className="block truncate text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
													{item.description}
												</span>
											)}
										</span>
										{item.shortcut === undefined ? null : (
											<kbd className="shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
												{item.shortcut}
											</kbd>
										)}
									</button>
								</Fragment>
							))}
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}

/** A row of tabs, one of which is the surface being shown. */
function SlotTabs({
	id,
	label,
	items,
	help,
	onChoose,
}: {
	readonly id: string;
	readonly label: string;
	readonly items: readonly {
		readonly id: string;
		readonly label: string;
		readonly active: boolean;
	}[];
	readonly help?:
		| { readonly title: string; readonly body?: string }
		| undefined;
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const activeIndex = items.findIndex((item) => item.active);

	/**
	 * One tab stop, arrows move and activate — the tab pattern this markup claims.
	 *
	 * Without it every tab was its own stop and the arrows were taken by whatever
	 * container was above, so a pack's tab row could not be walked at all.
	 */
	function moveTo(index: number) {
		if (items.length === 0) return;
		const next = items[(index + items.length) % items.length];
		if (next === undefined) return;
		buttons.current.get(next.id)?.focus();
		onChoose({ id, item: next.id });
	}

	return (
		<div
			role="tablist"
			aria-label={label}
			title={help?.body ?? help?.title ?? label}
			className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			{items.map((item, index) => (
				<button
					key={item.id}
					ref={(node) => {
						if (node === null) buttons.current.delete(item.id);
						else buttons.current.set(item.id, node);
					}}
					type="button"
					role="tab"
					aria-selected={item.active}
					tabIndex={item.active || (activeIndex < 0 && index === 0) ? 0 : -1}
					data-slot-id={id}
					data-slot-item={item.id}
					onClick={() => onChoose({ id, item: item.id })}
					onKeyDown={(event) => {
						const keys: Record<string, number> = {
							ArrowRight: index + 1,
							ArrowLeft: index - 1,
							Home: 0,
							End: items.length - 1,
						};
						const target = keys[event.key];
						if (target === undefined) return;
						event.preventDefault();
						event.stopPropagation();
						moveTo(target);
					}}
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
	value,
	tone,
	disabled,
	disabledReason,
	title,
	help,
	onChoose,
}: {
	readonly id: string;
	readonly label: string;
	readonly pressed: boolean;
	readonly glyph?: string | undefined;
	readonly value?: string | undefined;
	readonly tone?: MenuStatus["tone"] | undefined;
	readonly disabled?: boolean | undefined;
	readonly disabledReason?: string | undefined;
	readonly title?: string | undefined;
	readonly help?:
		| { readonly title: string; readonly body?: string }
		| undefined;
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	const valueTone =
		disabled === true
			? "text-[var(--ink-faint)]"
			: pressed
				? "text-[var(--on-accent)]"
				: TONE[tone ?? "quiet"];
	return (
		<button
			type="button"
			aria-pressed={pressed}
			aria-disabled={disabled === true ? true : undefined}
			disabled={disabled === true}
			// The pack's own sentence, when it wrote one, is the better description: it is the
			// text an explainer would say, so showing it on hover makes the two agree. A refusal
			// wins, because it explains a control that cannot be used at all.
			title={disabledReason ?? title ?? help?.body ?? help?.title ?? label}
			data-slot-id={id}
			data-slot-pressed={pressed ? "true" : "false"}
			data-slot-value={value}
			onClick={() => onChoose({ id })}
			className={cx(
				CONTROL,
				pressed
					? "bg-[var(--accent)] text-[var(--on-accent)]"
					: "text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
				disabled === true ? "opacity-40" : undefined,
				MOTION,
				FOCUS_RING,
			)}
		>
			{glyph === undefined ? null : (
				<span aria-hidden="true" className="shrink-0">
					{glyph}
				</span>
			)}
			{/* A mode keeps its word. An icon alone leaves "which mode" to a guess, and the
			    plan's vocabulary is icon + label + aria-pressed. */}
			<span className="min-w-0 truncate">{label}</span>
			{value === undefined ? null : (
				<span
					className={cx(
						"shrink-0 text-[length:var(--text-caption,11px)] tabular-nums",
						valueTone,
					)}
				>
					{value}
				</span>
			)}
		</button>
	);
}

/**
 * A small closed set, drawn as one segmented control.
 *
 * It is a `radiogroup`, not a row of pressed buttons: exactly one option is chosen, and
 * arrows move through it with the same roving tab stop the tab list uses.
 */
function SlotSegmented({
	id,
	label,
	value,
	options,
	help,
	onChoose,
}: {
	readonly id: string;
	readonly label: string;
	readonly value: string;
	readonly options: readonly {
		readonly id: string;
		readonly label: string;
	}[];
	readonly help?:
		| { readonly title: string; readonly body?: string }
		| undefined;
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const activeIndex = options.findIndex((option) => option.id === value);

	function moveTo(index: number) {
		if (options.length === 0) return;
		const next = options[(index + options.length) % options.length];
		if (next === undefined) return;
		buttons.current.get(next.id)?.focus();
		onChoose({ id, item: next.id });
	}

	return (
		<div
			role="radiogroup"
			aria-label={label}
			title={help?.body ?? help?.title ?? label}
			className="flex shrink-0 items-center gap-0.5 rounded-md border border-[var(--hairline)] bg-[var(--surface-sunk)] p-0.5"
		>
			{options.map((option, index) => {
				const selected = option.id === value;
				return (
					<button
						key={option.id}
						ref={(node) => {
							if (node === null) buttons.current.delete(option.id);
							else buttons.current.set(option.id, node);
						}}
						type="button"
						role="radio"
						aria-checked={selected}
						tabIndex={selected || (activeIndex < 0 && index === 0) ? 0 : -1}
						data-slot-id={id}
						data-slot-item={option.id}
						onClick={() => onChoose({ id, item: option.id })}
						onKeyDown={(event) => {
							const keys: Record<string, number> = {
								ArrowRight: index + 1,
								ArrowLeft: index - 1,
								Home: 0,
								End: options.length - 1,
							};
							const target = keys[event.key];
							if (target === undefined) return;
							event.preventDefault();
							event.stopPropagation();
							moveTo(target);
						}}
						className={cx(
							"flex h-6 shrink-0 items-center rounded-[var(--radius-sm)] px-2 text-[length:var(--text-caption,11px)]",
							selected
								? "bg-[var(--surface)] text-[var(--ink)]"
								: "text-[var(--ink-muted)] hover:text-[var(--ink)]",
							MOTION,
							FOCUS_RING,
						)}
					>
						{option.label}
					</button>
				);
			})}
		</div>
	);
}

/** A group of icon buttons: undo/redo, history, outline. */
function SlotButtons({
	buttons,
	help,
	onChoose,
}: {
	readonly buttons: readonly MenuButton[];
	readonly help?:
		| { readonly title: string; readonly body?: string }
		| undefined;
	readonly onChoose: (action: MenuSlotAction) => void;
}) {
	return (
		<span
			className="flex shrink-0 items-center gap-0.5"
			title={help === undefined ? undefined : (help.body ?? help.title)}
		>
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

/** Build the inline node and the fold rows for one published control. */
function renderControl(
	control: MenuNavControl,
	onChoose: (action: MenuSlotAction) => void,
): PackMenuControl {
	switch (control.kind) {
		case "menu": {
			const node = (
				<SlotMenu
					id={control.id}
					label={control.label}
					items={control.items}
					help={control.help}
					onChoose={onChoose}
				/>
			);
			const rows = control.items.map(
				(item): PackMenuFoldRow => ({
					key: `${control.id}.${item.id}`,
					label: item.label,
					...(item.description === undefined
						? {}
						: { description: item.description }),
					role: item.checked === undefined ? "command" : "choice",
					...(item.checked === undefined ? {} : { checked: item.checked }),
					...(item.disabled === true ? { disabled: true } : {}),
					...(item.disabledReason === undefined
						? {}
						: { disabledReason: item.disabledReason }),
					group: control.label,
					choose: () => onChoose({ id: control.id, item: item.id }),
				}),
			);
			return { key: control.id, label: control.label, node, rows };
		}
		case "tabs": {
			const node = (
				<SlotTabs
					id={control.id}
					label={control.label}
					items={control.items}
					help={control.help}
					onChoose={onChoose}
				/>
			);
			const rows = control.items.map(
				(item): PackMenuFoldRow => ({
					key: `${control.id}.${item.id}`,
					label: item.label,
					role: "choice",
					checked: item.active,
					group: control.label,
					choose: () => onChoose({ id: control.id, item: item.id }),
				}),
			);
			return { key: control.id, label: control.label, node, rows };
		}
		case "toggle": {
			const node = (
				<SlotToggle
					id={control.id}
					label={control.label}
					pressed={control.pressed}
					glyph={control.glyph}
					value={control.value}
					tone={control.tone}
					disabled={control.disabled}
					disabledReason={control.disabledReason}
					title={control.title}
					help={control.help}
					onChoose={onChoose}
				/>
			);
			const rows: PackMenuFoldRow[] = [
				{
					key: control.id,
					label:
						control.value === undefined
							? control.label
							: `${control.label} (${control.value})`,
					...(control.glyph === undefined ? {} : { glyph: control.glyph }),
					...(control.disabledReason === undefined
						? {}
						: { disabledReason: control.disabledReason }),
					role: "toggle",
					checked: control.pressed,
					...(control.disabled === true ? { disabled: true } : {}),
					...(control.help?.title === undefined
						? {}
						: { group: control.help.title }),
					choose: () => onChoose({ id: control.id }),
				},
			];
			return { key: control.id, label: control.label, node, rows };
		}
		case "buttons": {
			const node = (
				<SlotButtons
					buttons={control.items}
					help={control.help}
					onChoose={onChoose}
				/>
			);
			const rows = control.items.map(
				(item): PackMenuFoldRow => ({
					key: item.id,
					label: item.label,
					...(item.glyph === undefined ? {} : { glyph: item.glyph }),
					role: item.pressed === undefined ? "command" : "toggle",
					...(item.pressed === undefined ? {} : { checked: item.pressed }),
					...(item.disabled === true ? { disabled: true } : {}),
					...(item.title === undefined ? {} : { description: item.title }),
					...(control.help?.title === undefined
						? {}
						: { group: control.help.title }),
					choose: () => onChoose({ id: item.id }),
				}),
			);
			return {
				key: control.id,
				label: control.help?.title ?? "Actions",
				node,
				rows,
			};
		}
		case "segmented": {
			const node = (
				<SlotSegmented
					id={control.id}
					label={control.label}
					value={control.value}
					options={control.options}
					help={control.help}
					onChoose={onChoose}
				/>
			);
			const rows = control.options.map(
				(option): PackMenuFoldRow => ({
					key: `${control.id}.${option.id}`,
					label: option.label,
					role: "choice",
					checked: option.id === control.value,
					group: control.label,
					choose: () => onChoose({ id: control.id, item: option.id }),
				}),
			);
			return { key: control.id, label: control.label, node, rows };
		}
	}
}

/**
 * Turn the pack's publication into the zones the bar has room for.
 *
 * Returned as nodes rather than rendered in place, so `HostTabBar` keeps ownership of the
 * bar's layout: the host decides where a zone sits, and a pack only decides what is in it.
 * `controls` is the same material as a model, which is what lets the host fold a row that
 * does not fit without reaching into a pack's React tree.
 */
export function packMenuZones(
	slots: MenuSlots | null,
	onChoose: (action: MenuSlotAction) => void,
): PackMenuZones {
	if (slots === null) return { navigation: null, controls: [] };

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

	const controls = slots.navigation.map((control) => renderControl(control, onChoose));
	const navigation =
		controls.length === 0 ? null : (
			<div className="flex min-w-0 flex-initial items-center gap-1">
				{controls.map((control) => (
					<Fragment key={control.key}>{control.node}</Fragment>
				))}
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
		controls,
		...(actions === null ? {} : { actions }),
	};
}
