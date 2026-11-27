import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import { cx } from "../cx.js";
import { MenuBar } from "../menu/MenuBar.js";
import { FOCUS_RING, MOTION } from "../tokens.js";

/**
 * The host's tab strip on the shared `MenuBar`.
 *
 * Every host draws the same question: which surfaces are open, which one is in front, and how do
 * I open another. The strip owns that question and nothing else: the host keeps the tab list, the
 * active id and the pack frames, and hands them in. It is the navigation zone of the one menu bar,
 * so a pack that draws a `MenuBar` inside its own surface is not asked to draw a second strip.
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
	 * The pack fills the middle of this bar; the host keeps the marks at each end. A pack's
	 * takeover lands after the tab strip, because the tabs say which surface is open and the
	 * takeover says what that surface is showing.
	 */
	readonly pack?: {
		readonly context?: ReactNode;
		readonly navigation: ReactNode;
		readonly actions?: ReactNode;
	};
	readonly "data-testid"?: string;
}

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
	"data-testid": testId = "host-tab-bar",
}: HostTabBarProps): ReactNode {
	const tabButtons = useRef(new Map<string, HTMLButtonElement>());
	const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);

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

	const navigation = (
		<div className="flex min-w-0 items-center gap-2">
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
										MOTION,
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
			{/*
        The active pack's takeover, after the tabs. The strip answers "which surface is
        open"; the takeover answers "what is that surface showing", so it reads second and
        moves with the tab rather than beside the mark.
      */}
			{pack === undefined ? null : (
				<div className="flex min-w-0 items-center overflow-x-auto border-l border-[var(--hairline)] pl-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					{pack.navigation}
				</div>
			)}
		</div>
	);

	return (
		<MenuBar
			data-testid={testId}
			aria-label="Suite"
			{...(mark === undefined ? {} : { mark })}
			{...(pack?.context === undefined ? {} : { context: pack.context })}
			{...(onHome === undefined
				? {}
				: { onNavigateHome: onHome, homeAriaLabel: homeLabel })}
			navigation={navigation}
			{...(search === undefined ? {} : { search })}
			{...(onOpenSearch === undefined ? {} : { onOpenSearch })}
			{...(searchPlaceholder === undefined ? {} : { searchPlaceholder })}
			{...(searchShortcut === undefined ? {} : { searchShortcut })}
			{...(sync === undefined ? {} : { sync })}
			{...(pack?.actions === undefined ? {} : { actions: pack.actions })}
			{...(controls === undefined ? {} : { controls })}
		/>
	);
}
