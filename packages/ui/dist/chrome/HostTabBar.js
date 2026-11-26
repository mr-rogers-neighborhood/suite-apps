import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { cx } from "../cx.js";
import { MenuBar } from "../menu/MenuBar.js";
import { FOCUS_RING, MOTION } from "../tokens.js";
export function HostTabBar({ tabs, activeTabId = null, onActivate, onClose, onNewTab, mark, onHome, homeLabel = "Home", sync, controls, onOpenSearch, searchPlaceholder, searchShortcut, "data-testid": testId = "host-tab-bar", }) {
    const tabButtons = useRef(new Map());
    const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);
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
    const navigation = (_jsxs("div", { className: "flex min-w-0 items-center gap-2", children: [tabs.length === 0 ? (_jsx("span", { className: "hidden whitespace-nowrap text-[length:var(--text-caption,11px)] text-[var(--ink-faint)] sm:inline", children: "No open tabs" })) : (_jsx("nav", { "aria-label": "Open tabs", className: "flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", children: tabs.map((tab, index) => {
                    const selected = tab.id === activeTabId;
                    const reachable = selected || (activeIndex < 0 && index === 0);
                    return (_jsxs("div", { "data-kind": tab.kind, "data-active": selected ? "true" : "false", className: cx("group/tab flex shrink-0 items-center rounded-md", tab.unavailable === true ? "opacity-60" : undefined), children: [_jsxs("button", { ref: (node) => {
                                    if (node === null)
                                        tabButtons.current.delete(tab.id);
                                    else
                                        tabButtons.current.set(tab.id, node);
                                }, type: "button", "aria-current": selected ? "page" : undefined, "aria-disabled": tab.unavailable === true ? true : undefined, tabIndex: reachable ? 0 : -1, title: tab.title, onClick: () => onActivate?.(tab.id), onKeyDown: (event) => tabKeyDown(event, index, tab.id), className: cx("flex h-7 max-w-[220px] items-center gap-1.5 rounded-md pl-2 text-[length:var(--text-label,12px)]", selected
                                    ? "bg-[var(--surface)] text-[var(--ink)] shadow-[inset_0_-2px_0_var(--accent)]"
                                    : "text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: [tab.icon === undefined ? (_jsx("span", { "aria-hidden": "true", className: cx("h-1.5 w-1.5 shrink-0 rounded-full", tab.kind === "pack" ? "bg-[var(--accent)]" : "bg-[var(--ink-faint)]") })) : (_jsx("span", { "aria-hidden": "true", className: "flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-sm [&_img]:h-full [&_img]:w-full [&_img]:object-contain", children: tab.icon })), _jsx("span", { className: "min-w-0 truncate", children: tab.title })] }), onClose === undefined ? null : (_jsx("button", { type: "button", "aria-label": `Close ${tab.title}`, title: `Close ${tab.title}`, onClick: (event) => {
                                    event.stopPropagation();
                                    onClose(tab.id);
                                }, className: cx("mr-1 flex h-5 w-5 items-center justify-center rounded-sm text-[var(--ink-faint)] opacity-0 hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)] focus-visible:opacity-100 group-hover/tab:opacity-100 [@media(pointer:coarse)]:opacity-100", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "\u00d7" }) }))] }, tab.id));
                }) })), onNewTab === undefined ? null : (_jsx("button", { type: "button", "aria-label": "New tab", title: "New tab", onClick: onNewTab, className: cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[length:var(--text-body,13px)] text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "+" }) }))] }));
    return (_jsx(MenuBar, { "data-testid": testId, "aria-label": "Suite", ...(mark === undefined ? {} : { mark }), ...(onHome === undefined ? {} : { onNavigateHome: onHome, homeAriaLabel: homeLabel }), navigation: navigation, ...(onOpenSearch === undefined ? {} : { onOpenSearch }), ...(searchPlaceholder === undefined ? {} : { searchPlaceholder }), ...(searchShortcut === undefined ? {} : { searchShortcut }), ...(sync === undefined ? {} : { sync }), ...(controls === undefined ? {} : { controls }) }));
}
//# sourceMappingURL=HostTabBar.js.map