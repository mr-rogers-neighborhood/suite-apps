import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx.js";
import { MenuBar } from "../menu/MenuBar.js";
import { menuKeyDown } from "../menu/menuKeys.js";
import { FOCUS_RING, MOTION, MOTION_ALL } from "../tokens.js";
import type { PackMenuControl, PackMenuFoldRow } from "./PackMenuSlots.js";

/**
 * The host's tab strip on the shared `MenuBar`.
 *
 * Every host draws the same question: which surfaces are open, which one is in front, and how do
 * I open another. The strip owns that question and nothing else: the host keeps the tab list, the
 * active id and the pack frames, and hands them in. It is the navigation zone of the menu bar, so
 * a pack that draws a `MenuBar` inside its own surface is not asked to draw a second strip.
 *
 * ## Two rows, on purpose
 *
 * One row cannot hold the host's question and the active pack's material without squeezing both.
 * The host's own row keeps the marks, the tabs, search and the window controls; the pack's row is
 * a second, thinner band with the document it is showing and what that document can do. The pack
 * row does not exist when the active surface published nothing — Home costs one row, a document
 * costs two. Each row follows the host's density (`--control-height`) instead of a fixed 44px.
 *
 * A tab is a label button plus a separate close button. They are siblings rather than a button
 * inside a button, so the close control has its own accessible name and does not fire activation.
 * The list follows the tab pattern: one tab stop, arrow keys move and activate, Home/End jump,
 * Delete closes.
 */
export type HostTabKind = "pack" | "screen" | "settings" | "home";

export interface HostTab {
	readonly id: string;
	readonly title: string;
	readonly kind: HostTabKind;
	/** The app's own mark. The host passes the card icon or an `AppMark`. */
	readonly icon?: ReactNode;
	/** The surface is kept but cannot be drawn by this build; activation shows a placeholder. */
	readonly unavailable?: boolean;
}

export interface HostTabBarProps {
	readonly tabs: readonly HostTab[];
	readonly activeTabId?: string | null;
	readonly onActivate?: (id: string) => void;
	readonly onClose?: (id: string) => void;
	/** A context menu for one tab: the host adds Set as Home and Reload there. */
	readonly onTabMenu?: (id: string) => void;
	readonly onNewTab?: () => void;
	/** The suite mark. Omitted, the bar has no home anchor. */
	readonly mark?: ReactNode;
	readonly onHome?: () => void;
	readonly homeLabel?: string;
	readonly sync?: ReactNode;
	readonly controls?: ReactNode;
	/** A host-owned search trigger, in the bar's search zone. */
	readonly search?: ReactNode;
	readonly onOpenSearch?: () => void;
	readonly searchPlaceholder?: string;
	readonly searchShortcut?: string;
	/**
	 * The active pack's zones, from `packMenuZones`.
	 *
	 * The pack fills its own row under the host's: the context says which document is in
	 * front, the navigation says what it is showing, and the actions are what it can do. A
	 * pack that published nothing passes no `pack`, so the row is absent rather than empty.
	 */
	readonly pack?: {
		readonly context?: ReactNode;
		readonly navigation: ReactNode;
		readonly actions?: ReactNode;
		/**
		 * The same material as a model, one entry per navigation control. When present,
		 * `HostTabBar` can fold the controls that do not fit into its own `…` menu.
		 */
		readonly controls?: readonly PackMenuControl[];
	};
	/**
	 * Identifies the active surface, so the pack row can play its entrance again when the
	 * person switches to a different pack. Without it the row is reused and only its
	 * contents swap, which reads as a flicker rather than a change.
	 */
	readonly packKey?: string;
	readonly "data-testid"?: string;
}

const SWITCH_WIDTH = 240;

const FOLD_BOX =
	"fixed z-50 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-[var(--shadow-xl)] starting:scale-95 starting:opacity-0 motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--duration-fast,100ms)] motion-safe:ease-[var(--ease-standard,cubic-bezier(0.4,0,0.2,1))]";

/** A menu row: the switch list's one entry per open tab. */
const SWITCH_ROW =
	"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-label,12px)] outline-none text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]";

export function HostTabBar({
	tabs,
	activeTabId = null,
	onActivate,
	onClose,
	onTabMenu,
	onNewTab,
	mark,
	onHome,
	homeLabel = "Home",
	sync,
	controls,
	search,
	onOpenSearch,
	searchPlaceholder,
	searchShortcut,
	pack,
	packKey,
	"data-testid": testId = "host-tab-bar",
}: HostTabBarProps): ReactNode {
	const tabButtons = useRef(new Map<string, HTMLButtonElement>());
	const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
	const switchTrigger = useRef<HTMLButtonElement | null>(null);
	const switchMenu = useRef<HTMLDivElement | null>(null);
	const [switchOpen, setSwitchOpen] = useState(false);
	const [switchAt, setSwitchAt] = useState<{ left: number; top: number } | null>(null);

	/**
	 * Keep the active tab visible in a crowded strip.
	 *
	 * The host changes `activeTabId` from outside the strip — opening a document, restoring
	 * a session, activating a tab from the picker — so nothing here is focused when it
	 * happens. Without this the selected tab can be scrolled out of reach and the switch
	 * looks like it did nothing. `nearest` scrolls only when it is actually off-screen, so a
	 * click on a visible tab does not jump the strip.
	 */
	useEffect(() => {
		if (activeTabId === null) return;
		tabButtons.current.get(activeTabId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [activeTabId]);

	function moveTo(index: number) {
		if (tabs.length === 0) return;
		const next = tabs[(index + tabs.length) % tabs.length];
		if (next === undefined) return;
		tabButtons.current.get(next.id)?.focus();
		onActivate?.(next.id);
	}

	function tabKeyDown(
		event: KeyboardEvent<HTMLButtonElement>,
		index: number,
		id: string,
	) {
		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				event.preventDefault();
				event.stopPropagation();
				moveTo(index + 1);
				return;
			case "ArrowLeft":
			case "ArrowUp":
				event.preventDefault();
				event.stopPropagation();
				moveTo(index - 1);
				return;
			case "Home":
				event.preventDefault();
				event.stopPropagation();
				moveTo(0);
				return;
			case "End":
				event.preventDefault();
				event.stopPropagation();
				moveTo(tabs.length - 1);
				return;
			case "Delete":
			case "Backspace":
				if (onClose === undefined) return;
				event.preventDefault();
				event.stopPropagation();
				onClose(id);
				return;
			default:
		}
	}

	/**
	 * The switch list, positioned from its trigger.
	 *
	 * It is a portal for the same reason a pack's dropdown is: the strip scrolls
	 * horizontally, and a menu drawn inside it would be clipped to the bar's height.
	 */
	const placeSwitch = useCallback(() => {
		const trigger = switchTrigger.current?.getBoundingClientRect();
		if (trigger === undefined) return;
		const left = Math.max(8, Math.min(trigger.right - SWITCH_WIDTH, window.innerWidth - SWITCH_WIDTH - 8));
		setSwitchAt({ left, top: trigger.bottom + 4 });
	}, []);

	function closeSwitch(returnFocus: boolean) {
		setSwitchOpen(false);
		setSwitchAt(null);
		if (returnFocus) switchTrigger.current?.focus();
	}

	useEffect(() => {
		if (!switchOpen) return;
		// Focus the tab in front, so the list opens where the person's attention already is.
		const target = switchMenu.current?.querySelector<HTMLElement>(
			"[aria-checked='true']:not([disabled]), [role='menuitemradio']:not([disabled])",
		);
		target?.focus();

		const onPointerDown = (event: PointerEvent) => {
			const inside =
				switchTrigger.current?.contains(event.target as Node) === true ||
				switchMenu.current?.contains(event.target as Node) === true;
			if (!inside) {
				setSwitchOpen(false);
				setSwitchAt(null);
			}
		};
		const onReposition = () => placeSwitch();
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("resize", onReposition);
		window.addEventListener("scroll", onReposition, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("resize", onReposition);
			window.removeEventListener("scroll", onReposition, true);
		};
	}, [switchOpen, placeSwitch]);

	const packControls = pack?.controls ?? [];
	const foldControls = packControls.length > 1 ? packControls.slice(1) : [];
	const foldTrigger = useRef<HTMLButtonElement | null>(null);
	const foldMenu = useRef<HTMLDivElement | null>(null);
	const [foldOpen, setFoldOpen] = useState(false);
	const [foldAt, setFoldAt] = useState<{ left: number; top: number } | null>(null);

	const placeFold = useCallback(() => {
		const trigger = foldTrigger.current?.getBoundingClientRect();
		if (trigger === undefined) return;
		const width = 240;
		const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8));
		setFoldAt({ left, top: trigger.bottom + 4 });
	}, []);

	function closeFold(returnFocus: boolean) {
		setFoldOpen(false);
		setFoldAt(null);
		if (returnFocus) foldTrigger.current?.focus();
	}

	useEffect(() => {
		if (!foldOpen) return;
		const target = foldMenu.current?.querySelector<HTMLElement>(
			"[role='menuitem']:not([disabled]), [role='menuitemradio']:not([disabled]), [role='menuitemcheckbox']:not([disabled])",
		);
		target?.focus();

		const onPointerDown = (event: PointerEvent) => {
			const inside =
				foldTrigger.current?.contains(event.target as Node) === true ||
				foldMenu.current?.contains(event.target as Node) === true;
			if (!inside) {
				setFoldOpen(false);
				setFoldAt(null);
			}
		};
		const onReposition = () => placeFold();
		window.addEventListener("pointerdown", onPointerDown, true);
		window.addEventListener("resize", onReposition);
		window.addEventListener("scroll", onReposition, true);
		return () => {
			window.removeEventListener("pointerdown", onPointerDown, true);
			window.removeEventListener("resize", onReposition);
			window.removeEventListener("scroll", onReposition, true);
		};
	}, [foldOpen, placeFold]);

	function foldRowName(row: PackMenuFoldRow): string {
		if (row.role === "choice") return "menuitemradio";
		if (row.role === "toggle") return "menuitemcheckbox";
		return "menuitem";
	}

	const rowOne = (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			{tabs.length === 0 ? (
				<span className="hidden whitespace-nowrap text-[length:var(--text-caption,11px)] text-[var(--ink-faint)] sm:inline">
					No open tabs
				</span>
			) : (
				<nav
					aria-label="Open tabs"
					className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
				>
					{tabs.map((tab, index) => {
						const selected = tab.id === activeTabId;
						const reachable = selected || (activeIndex < 0 && index === 0);
						return (
							<div
								key={tab.id}
								data-kind={tab.kind}
								data-active={selected ? "true" : "false"}
								className={cx(
									"group/tab flex shrink-0 items-center rounded-md",
									tab.unavailable === true ? "opacity-60" : undefined,
								)}
							>
								<button
									ref={(node) => {
										if (node === null) tabButtons.current.delete(tab.id);
										else tabButtons.current.set(tab.id, node);
									}}
									type="button"
									aria-current={selected ? "page" : undefined}
									aria-disabled={tab.unavailable === true ? true : undefined}
									tabIndex={reachable ? 0 : -1}
									title={tab.title}
									onClick={() => onActivate?.(tab.id)}
									onContextMenu={(event) => {
										if (onTabMenu === undefined) return;
										event.preventDefault();
										onTabMenu(tab.id);
									}}
									onKeyDown={(event) => {
										if (
											onTabMenu !== undefined &&
											(event.key === "ContextMenu" ||
												(event.shiftKey && event.key === "F10"))
										) {
											event.preventDefault();
											event.stopPropagation();
											onTabMenu(tab.id);
											return;
										}
										tabKeyDown(event, index, tab.id);
									}}
									className={cx(
										"flex h-7 max-w-[220px] items-center gap-1.5 rounded-md pl-2 text-[length:var(--text-label,12px)]",
										selected
											? "bg-[var(--surface)] text-[var(--ink)] shadow-[inset_0_-2px_0_var(--accent)]"
											: "text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
										MOTION_ALL,
										FOCUS_RING,
									)}
								>
									{tab.icon === undefined ? (
										<span
											aria-hidden="true"
											className={cx(
												"h-1.5 w-1.5 shrink-0 rounded-full",
												tab.kind === "pack"
													? "bg-[var(--accent)]"
													: "bg-[var(--ink-faint)]",
											)}
										/>
									) : (
										<span
											aria-hidden="true"
											className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:h-full [&_img]:w-full [&_img]:object-contain"
										>
											{tab.icon}
										</span>
									)}
									<span className="min-w-0 truncate">{tab.title}</span>
								</button>
								{onClose === undefined ? null : (
									<button
										type="button"
										aria-label={`Close ${tab.title}`}
										title={`Close ${tab.title}`}
										onClick={(event) => {
											event.stopPropagation();
											onClose(tab.id);
										}}
										className={cx(
											"mr-1 flex h-5 w-5 items-center justify-center rounded-sm text-[var(--ink-faint)] opacity-0 hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover/tab:opacity-100 [@media(pointer:coarse)]:opacity-100",
											MOTION,
											FOCUS_RING,
										)}
									>
										<span aria-hidden="true">{"\u00d7"}</span>
									</button>
								)}
							</div>
						);
					})}
				</nav>
			)}
			{onNewTab === undefined ? null : (
				<button
					type="button"
					aria-label="New tab"
					title="New tab"
					onClick={onNewTab}
					className={cx(
						"flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[length:var(--text-body,13px)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
						MOTION,
						FOCUS_RING,
					)}
				>
					<span aria-hidden="true">+</span>
				</button>
			)}
			{tabs.length > 1 ? (
				<button
					ref={switchTrigger}
					type="button"
					aria-haspopup="menu"
					aria-expanded={switchOpen}
					aria-label="All tabs"
					title="All tabs"
					onClick={() => {
						if (!switchOpen) placeSwitch();
						setSwitchOpen(!switchOpen);
					}}
					className={cx(
						"flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[length:var(--text-body,13px)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
						MOTION,
						FOCUS_RING,
					)}
				>
					<span aria-hidden="true">{"\u25be"}</span>
				</button>
			) : null}
		</div>
	);

	return (
		<div className="flex flex-col">
			<MenuBar
				data-testid={testId}
				aria-label="Suite"
				style={{ "--menu-bar-height": "var(--control-height, 36px)" } as CSSProperties}
				{...(mark === undefined ? {} : { mark })}
				{...(onHome === undefined
					? {}
					: { onNavigateHome: onHome, homeAriaLabel: homeLabel })}
				navigation={rowOne}
				{...(search === undefined ? {} : { search })}
				{...(onOpenSearch === undefined ? {} : { onOpenSearch })}
				{...(searchPlaceholder === undefined ? {} : { searchPlaceholder })}
				{...(searchShortcut === undefined ? {} : { searchShortcut })}
				{...(sync === undefined ? {} : { sync })}
				{...(controls === undefined ? {} : { controls })}
			/>
			{pack === undefined ? null : (
				<div
					// Remounting on a surface change replays the entrance, so switching packs
					// reads as a change rather than a flicker of the same row's contents.
					key={packKey ?? "pack"}
					data-testid={`${testId}-pack`}
					data-handbook-region="pack-bar"
					className={cx(
						"@container flex h-[var(--control-height,36px)] shrink-0 items-center gap-2 border-t border-[var(--hairline)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] px-4 text-[length:var(--text-label,12px)] text-[var(--ink)] shadow-[inset_0_-1px_0_var(--hairline)] backdrop-blur-md starting:translate-y-1 starting:opacity-0",
						MOTION_ALL,
					)}
				>
					<div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
						{pack.context}
						{packControls.length === 0
							? pack.navigation
							: packControls.map((control, index) => (
									<div
										key={control.key}
										className={cx(
											"flex shrink-0 items-center",
											// Below the row's own width, everything after the
											// first control moves into the `…` menu. The nodes
											// stay mounted but not rendered, so no control is
											// lost and no pack React is touched.
											index > 0 && foldControls.length > 0
												? "@max-5xl:hidden"
												: undefined,
										)}
									>
										{control.node}
									</div>
								))}
						{foldControls.length === 0 ? null : (
							<div className="hidden shrink-0 @max-5xl:flex">
								<button
									ref={foldTrigger}
									type="button"
									aria-haspopup="menu"
									aria-expanded={foldOpen}
									aria-label="More controls"
									title="More controls"
									onClick={() => {
										if (!foldOpen) placeFold();
										setFoldOpen(!foldOpen);
									}}
									className={cx(
										"flex h-7 w-7 items-center justify-center rounded-md text-[length:var(--text-body,13px)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]",
										MOTION,
										FOCUS_RING,
									)}
								>
									<span aria-hidden="true">{"\u22ef"}</span>
								</button>
							</div>
						)}
					</div>
					{pack.actions === undefined ? null : (
						<div className="flex shrink-0 items-center gap-1">{pack.actions}</div>
					)}
				</div>
			)}
			{foldOpen && foldAt !== null
				? createPortal(
						<div
							ref={foldMenu}
							role="menu"
							aria-label="More controls"
							className={FOLD_BOX}
							style={{ left: foldAt.left, top: foldAt.top, minWidth: SWITCH_WIDTH }}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									closeFold(true);
									return;
								}
								menuKeyDown(event);
							}}
						>
							{foldControls.map((control) => (
								<div
									key={control.key}
									role="group"
									{...(control.group === undefined
										? {}
										: { "aria-label": control.group })}
								>
									{control.rows.map((row) => (
										<button
											key={row.key}
											type="button"
											role={foldRowName(row)}
											aria-checked={
												row.role === "command" ? undefined : row.checked === true
											}
											disabled={row.disabled === true}
											title={row.disabledReason ?? row.description ?? row.label}
											data-slot-id={row.key}
											onClick={() => {
												closeFold(true);
												row.choose();
											}}
											className={cx(
												"flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-label,12px)] text-[var(--ink-muted)] outline-none hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)] disabled:opacity-40",
												MOTION,
												FOCUS_RING,
											)}
										>
											<span
												aria-hidden="true"
												className="w-3 shrink-0 text-[var(--accent)]"
											>
												{row.checked === true ? "\u2713" : ""}
											</span>
											{row.glyph === undefined ? null : (
												<span aria-hidden="true" className="shrink-0">
													{row.glyph}
												</span>
											)}
											<span className="min-w-0 flex-1">
												<span className="block truncate">{row.label}</span>
												{row.description === undefined ? null : (
													<span className="block truncate text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
														{row.description}
													</span>
												)}
											</span>
										</button>
									))}
								</div>
							))}
						</div>,
						document.body,
					)
				: null}
			{switchOpen && switchAt !== null
				? createPortal(
						<div
							ref={switchMenu}
							role="menu"
							aria-label="All tabs"
							className="fixed z-50 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-[var(--shadow-xl)] starting:scale-95 starting:opacity-0 motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--duration-fast,100ms)] motion-safe:ease-[var(--ease-standard,cubic-bezier(0.4,0,0.2,1))]"
							style={{ left: switchAt.left, top: switchAt.top, minWidth: SWITCH_WIDTH }}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.preventDefault();
									closeSwitch(true);
									return;
								}
								menuKeyDown(event);
							}}
						>
							{tabs.map((tab) => (
								<button
									key={tab.id}
									type="button"
									role="menuitemradio"
									aria-checked={tab.id === activeTabId}
									data-tab-id={tab.id}
									onClick={() => {
										closeSwitch(true);
										onActivate?.(tab.id);
									}}
									className={cx(SWITCH_ROW, MOTION, FOCUS_RING)}
								>
									<span
										aria-hidden="true"
										className="w-3 shrink-0 text-[var(--accent)]"
									>
										{tab.id === activeTabId ? "\u2713" : ""}
									</span>
									<span className="min-w-0 flex-1 truncate">{tab.title}</span>
									<span className="shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
										{tab.kind}
									</span>
								</button>
							))}
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}
