import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState, } from "react";
import { createPortal } from "react-dom";
import { cx } from "../cx.js";
import { MenuBar } from "../menu/MenuBar.js";
import { menuKeyDown } from "../menu/menuKeys.js";
import { FOCUS_RING, MOTION, MOTION_ALL } from "../tokens.js";
const SWITCH_WIDTH = 240;
const FOLD_BOX = "fixed z-50 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-[var(--shadow-xl)] starting:scale-95 starting:opacity-0 motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--duration-fast,100ms)] motion-safe:ease-[var(--ease-standard,cubic-bezier(0.4,0,0.2,1))]";
/** A menu row: the switch list's one entry per open tab. */
const SWITCH_ROW = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-label,12px)] outline-none text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]";
export function HostTabBar({ tabs, activeTabId = null, onActivate, onClose, onTabMenu, onNewTab, mark, onHome, homeLabel = "Home", sync, controls, search, onOpenSearch, searchPlaceholder, searchShortcut, pack, packKey, "data-testid": testId = "host-tab-bar", }) {
    const tabButtons = useRef(new Map());
    const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
    const switchTrigger = useRef(null);
    const switchMenu = useRef(null);
    const [switchOpen, setSwitchOpen] = useState(false);
    const [switchAt, setSwitchAt] = useState(null);
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
        if (activeTabId === null)
            return;
        tabButtons.current.get(activeTabId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [activeTabId]);
    function moveTo(index) {
        if (tabs.length === 0)
            return;
        const next = tabs[(index + tabs.length) % tabs.length];
        if (next === undefined)
            return;
        tabButtons.current.get(next.id)?.focus();
        onActivate?.(next.id);
    }
    function tabKeyDown(event, index, id) {
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
                if (onClose === undefined)
                    return;
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
        if (trigger === undefined)
            return;
        const left = Math.max(8, Math.min(trigger.right - SWITCH_WIDTH, window.innerWidth - SWITCH_WIDTH - 8));
        setSwitchAt({ left, top: trigger.bottom + 4 });
    }, []);
    function closeSwitch(returnFocus) {
        setSwitchOpen(false);
        setSwitchAt(null);
        if (returnFocus)
            switchTrigger.current?.focus();
    }
    useEffect(() => {
        if (!switchOpen)
            return;
        // Focus the tab in front, so the list opens where the person's attention already is.
        const target = switchMenu.current?.querySelector("[aria-checked='true']:not([disabled]), [role='menuitemradio']:not([disabled])");
        target?.focus();
        const onPointerDown = (event) => {
            const inside = switchTrigger.current?.contains(event.target) === true ||
                switchMenu.current?.contains(event.target) === true;
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
    const foldTrigger = useRef(null);
    const foldMenu = useRef(null);
    const [foldOpen, setFoldOpen] = useState(false);
    const [foldAt, setFoldAt] = useState(null);
    const placeFold = useCallback(() => {
        const trigger = foldTrigger.current?.getBoundingClientRect();
        if (trigger === undefined)
            return;
        const width = 240;
        const left = Math.max(8, Math.min(trigger.left, window.innerWidth - width - 8));
        setFoldAt({ left, top: trigger.bottom + 4 });
    }, []);
    function closeFold(returnFocus) {
        setFoldOpen(false);
        setFoldAt(null);
        if (returnFocus)
            foldTrigger.current?.focus();
    }
    useEffect(() => {
        if (!foldOpen)
            return;
        const target = foldMenu.current?.querySelector("[role='menuitem']:not([disabled]), [role='menuitemradio']:not([disabled]), [role='menuitemcheckbox']:not([disabled])");
        target?.focus();
        const onPointerDown = (event) => {
            const inside = foldTrigger.current?.contains(event.target) === true ||
                foldMenu.current?.contains(event.target) === true;
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
    function foldRowName(row) {
        if (row.role === "choice")
            return "menuitemradio";
        if (row.role === "toggle")
            return "menuitemcheckbox";
        return "menuitem";
    }
    const rowOne = (_jsxs("div", { className: "flex min-w-0 flex-1 items-center gap-2", children: [tabs.length === 0 ? (_jsx("span", { className: "hidden whitespace-nowrap text-[length:var(--text-caption,11px)] text-[var(--ink-faint)] sm:inline", children: "No open tabs" })) : (_jsx("nav", { "aria-label": "Open tabs", className: "flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", children: tabs.map((tab, index) => {
                    const selected = tab.id === activeTabId;
                    const reachable = selected || (activeIndex < 0 && index === 0);
                    return (_jsxs("div", { "data-kind": tab.kind, "data-active": selected ? "true" : "false", className: cx("group/tab flex shrink-0 items-center rounded-md", tab.unavailable === true ? "opacity-60" : undefined), children: [_jsxs("button", { ref: (node) => {
                                    if (node === null)
                                        tabButtons.current.delete(tab.id);
                                    else
                                        tabButtons.current.set(tab.id, node);
                                }, type: "button", "aria-current": selected ? "page" : undefined, "aria-disabled": tab.unavailable === true ? true : undefined, tabIndex: reachable ? 0 : -1, title: tab.title, onClick: () => onActivate?.(tab.id), onContextMenu: (event) => {
                                    if (onTabMenu === undefined)
                                        return;
                                    event.preventDefault();
                                    onTabMenu(tab.id);
                                }, onKeyDown: (event) => {
                                    if (onTabMenu !== undefined &&
                                        (event.key === "ContextMenu" ||
                                            (event.shiftKey && event.key === "F10"))) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        onTabMenu(tab.id);
                                        return;
                                    }
                                    tabKeyDown(event, index, tab.id);
                                }, className: cx("flex h-7 max-w-[220px] items-center gap-1.5 rounded-md pl-2 text-[length:var(--text-label,12px)]", selected
                                    ? "bg-[var(--surface)] text-[var(--ink)] shadow-[inset_0_-2px_0_var(--accent)]"
                                    : "text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION_ALL, FOCUS_RING), children: [tab.icon === undefined ? (_jsx("span", { "aria-hidden": "true", className: cx("h-1.5 w-1.5 shrink-0 rounded-full", tab.kind === "pack"
                                            ? "bg-[var(--accent)]"
                                            : "bg-[var(--ink-faint)]") })) : (_jsx("span", { "aria-hidden": "true", className: "flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:h-full [&_img]:w-full [&_img]:object-contain", children: tab.icon })), _jsx("span", { className: "min-w-0 truncate", children: tab.title })] }), onClose === undefined ? null : (_jsx("button", { type: "button", "aria-label": `Close ${tab.title}`, title: `Close ${tab.title}`, onClick: (event) => {
                                    event.stopPropagation();
                                    onClose(tab.id);
                                }, className: cx("mr-1 flex h-5 w-5 items-center justify-center rounded-sm text-[var(--ink-faint)] opacity-0 hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover/tab:opacity-100 [@media(pointer:coarse)]:opacity-100", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "\u00d7" }) }))] }, tab.id));
                }) })), onNewTab === undefined ? null : (_jsx("button", { type: "button", "aria-label": "New tab", title: "New tab", onClick: onNewTab, className: cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[length:var(--text-body,13px)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "+" }) })), tabs.length > 1 ? (_jsx("button", { ref: switchTrigger, type: "button", "aria-haspopup": "menu", "aria-expanded": switchOpen, "aria-label": "All tabs", title: "All tabs", onClick: () => {
                    if (!switchOpen)
                        placeSwitch();
                    setSwitchOpen(!switchOpen);
                }, className: cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[length:var(--text-body,13px)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "\u25be" }) })) : null] }));
    return (_jsxs("div", { className: "flex flex-col", children: [_jsx(MenuBar, { "data-testid": testId, "aria-label": "Suite", style: { "--menu-bar-height": "var(--control-height, 36px)" }, ...(mark === undefined ? {} : { mark }), ...(onHome === undefined
                    ? {}
                    : { onNavigateHome: onHome, homeAriaLabel: homeLabel }), navigation: rowOne, ...(search === undefined ? {} : { search }), ...(onOpenSearch === undefined ? {} : { onOpenSearch }), ...(searchPlaceholder === undefined ? {} : { searchPlaceholder }), ...(searchShortcut === undefined ? {} : { searchShortcut }), ...(sync === undefined ? {} : { sync }), ...(controls === undefined ? {} : { controls }) }), pack === undefined ? null : (_jsxs("div", { "data-testid": `${testId}-pack`, "data-handbook-region": "pack-bar", className: cx("@container flex h-[var(--control-height,36px)] shrink-0 items-center gap-2 border-t border-[var(--hairline)] bg-[color-mix(in_srgb,var(--surface)_72%,transparent)] px-4 text-[length:var(--text-label,12px)] text-[var(--ink)] shadow-[inset_0_-1px_0_var(--hairline)] backdrop-blur-md starting:translate-y-1 starting:opacity-0", MOTION_ALL), children: [_jsxs("div", { className: "flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", children: [pack.context, packControls.length === 0
                                ? pack.navigation
                                : packControls.map((control, index) => (_jsx("div", { className: cx("flex shrink-0 items-center", 
                                    // Below the row's own width, everything after the
                                    // first control moves into the `…` menu. The nodes
                                    // stay mounted but not rendered, so no control is
                                    // lost and no pack React is touched.
                                    index > 0 && foldControls.length > 0
                                        ? "@max-5xl:hidden"
                                        : undefined), children: control.node }, control.key))), foldControls.length === 0 ? null : (_jsx("div", { className: "hidden shrink-0 @max-5xl:flex", children: _jsx("button", { ref: foldTrigger, type: "button", "aria-haspopup": "menu", "aria-expanded": foldOpen, "aria-label": "More controls", title: "More controls", onClick: () => {
                                        if (!foldOpen)
                                            placeFold();
                                        setFoldOpen(!foldOpen);
                                    }, className: cx("flex h-7 w-7 items-center justify-center rounded-md text-[length:var(--text-body,13px)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "\u22ef" }) }) }))] }), pack.actions === undefined ? null : (_jsx("div", { className: "flex shrink-0 items-center gap-1", children: pack.actions }))] }, packKey ?? "pack")), foldOpen && foldAt !== null
                ? createPortal(_jsx("div", { ref: foldMenu, role: "menu", "aria-label": "More controls", className: FOLD_BOX, style: { left: foldAt.left, top: foldAt.top, minWidth: SWITCH_WIDTH }, onKeyDown: (event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeFold(true);
                            return;
                        }
                        menuKeyDown(event);
                    }, children: foldControls.map((control) => (_jsx("div", { role: "group", "aria-label": control.label, children: control.rows.map((row) => (_jsxs("button", { type: "button", role: foldRowName(row), "aria-checked": row.role === "command" ? undefined : row.checked === true, disabled: row.disabled === true, title: row.disabledReason ?? row.description ?? row.label, "data-slot-id": row.key, onClick: () => {
                                closeFold(true);
                                row.choose();
                            }, className: cx("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[length:var(--text-label,12px)] text-[var(--ink-muted)] outline-none hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)] disabled:opacity-40", MOTION, FOCUS_RING), children: [_jsx("span", { "aria-hidden": "true", className: "w-3 shrink-0 text-[var(--accent)]", children: row.checked === true ? "\u2713" : "" }), row.glyph === undefined ? null : (_jsx("span", { "aria-hidden": "true", className: "shrink-0", children: row.glyph })), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate", children: row.label }), row.description === undefined ? null : (_jsx("span", { className: "block truncate text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: row.description }))] })] }, row.key))) }, control.key))) }), document.body)
                : null, switchOpen && switchAt !== null
                ? createPortal(_jsx("div", { ref: switchMenu, role: "menu", "aria-label": "All tabs", className: "fixed z-50 overflow-hidden rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-[var(--shadow-xl)] starting:scale-95 starting:opacity-0 motion-safe:transition-[opacity,transform] motion-safe:duration-[var(--duration-fast,100ms)] motion-safe:ease-[var(--ease-standard,cubic-bezier(0.4,0,0.2,1))]", style: { left: switchAt.left, top: switchAt.top, minWidth: SWITCH_WIDTH }, onKeyDown: (event) => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            closeSwitch(true);
                            return;
                        }
                        menuKeyDown(event);
                    }, children: tabs.map((tab) => (_jsxs("button", { type: "button", role: "menuitemradio", "aria-checked": tab.id === activeTabId, "data-tab-id": tab.id, onClick: () => {
                            closeSwitch(true);
                            onActivate?.(tab.id);
                        }, className: cx(SWITCH_ROW, MOTION, FOCUS_RING), children: [_jsx("span", { "aria-hidden": "true", className: "w-3 shrink-0 text-[var(--accent)]", children: tab.id === activeTabId ? "\u2713" : "" }), _jsx("span", { className: "min-w-0 flex-1 truncate", children: tab.title }), _jsx("span", { className: "shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: tab.kind })] }, tab.id))) }), document.body)
                : null] }));
}
//# sourceMappingURL=HostTabBar.js.map