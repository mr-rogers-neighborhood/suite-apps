import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useRef } from "react";
import { cx } from "./cx.js";
import { EmptyState } from "./EmptyState.js";
import { FOCUS_RING, INK, MOTION, SURFACE } from "./tokens.js";
/**
 * A single-select list of rows.
 *
 * The pattern is a listbox because the job is selection plus traversal: one row is current, the
 * arrow keys move it, Home and End jump to the ends, and Enter opens it. That is a listbox's
 * contract rather than a list of buttons with keys bolted on, and it is the version a screen
 * reader can describe. Selection is controlled (`selectedId` plus `onSelect`) for the same
 * reason `AppShell` owns no state: the caller already has the selected item, and a second copy
 * inside the component is a second truth.
 *
 * Rows with no `items` and no `sections` render the shared `EmptyState`, not an empty listbox:
 * a `listbox` with no options has no valid accessible description.
 */
export function ListView({ label, items, sections, selectedId = null, onSelect, onActivate, empty, className, onKeyDown, ...props }) {
    const listRef = useRef(null);
    const rows = sections === undefined ? (items ?? []) : sections.flatMap((section) => section.items);
    if (rows.length === 0) {
        return (_jsx("div", { className: cx(className), "data-empty": "true", ...props, children: empty ?? _jsx(EmptyState, { title: "Nothing here yet" }) }));
    }
    // The row that Tab lands on: the selected row when it is selectable, otherwise the first
    // enabled row. Every other row is a programmatic target only, which is the roving tab stop
    // the listbox pattern asks for.
    const firstEnabled = rows.find((item) => item.disabled !== true);
    const selectedIsSelectable = rows.some((item) => item.id === selectedId && item.disabled !== true);
    const tabStopId = selectedIsSelectable ? selectedId : firstEnabled?.id;
    function options() {
        const root = listRef.current;
        if (root === null)
            return [];
        return Array.from(root.querySelectorAll('[data-list-item="true"]:not([aria-disabled="true"])'));
    }
    function handleKeyDown(event) {
        const target = event.target;
        // Keys pressed inside a row's content belong to that control, not to the list.
        if (!(target instanceof HTMLElement) || target.dataset.listItem !== "true")
            return;
        const enabled = options();
        const current = enabled.indexOf(target);
        if (current < 0)
            return;
        let next = null;
        switch (event.key) {
            case "ArrowDown":
                next = (current + 1) % enabled.length;
                break;
            case "ArrowUp":
                next = current === 0 ? enabled.length - 1 : current - 1;
                break;
            case "Home":
                next = 0;
                break;
            case "End":
                next = enabled.length - 1;
                break;
            case "Enter":
                event.preventDefault();
                if (target.dataset.itemId !== undefined)
                    onActivate?.(target.dataset.itemId);
                return;
            case " ":
                event.preventDefault();
                if (target.dataset.itemId !== undefined)
                    onSelect?.(target.dataset.itemId);
                return;
            default:
                return;
        }
        event.preventDefault();
        const destination = enabled[next];
        if (destination === undefined)
            return;
        destination.focus();
        if (destination.dataset.itemId !== undefined)
            onSelect?.(destination.dataset.itemId);
    }
    function renderRow(item, groupId) {
        const isSelected = item.id === selectedId;
        return (_jsx("div", { role: "option", "aria-selected": isSelected, "aria-disabled": item.disabled === true ? true : undefined, "aria-label": item.label, tabIndex: item.id === tabStopId ? 0 : -1, "data-list-item": "true", "data-item-id": item.id, "data-selected": isSelected ? "true" : undefined, onClick: (event) => {
                if (item.disabled === true)
                    return;
                event.currentTarget.focus();
                onSelect?.(item.id);
            }, className: cx("flex w-full select-none items-center gap-[var(--control-gap,0.5rem)] rounded-md px-[var(--control-padding-x,0.75rem)] py-[var(--row-padding-y,0.625rem)] text-left text-[length:var(--text-body,13px)]", MOTION, FOCUS_RING, isSelected
                ? cx(SURFACE.sunk, INK.base)
                : cx("bg-transparent", INK.base, "hover:bg-[var(--surface-sunk)]"), item.disabled === true ? "cursor-not-allowed opacity-50" : "cursor-default"), children: item.content }, `${groupId}:${item.id}`));
    }
    return (_jsx("div", { ref: listRef, role: "listbox", "aria-label": label, onKeyDown: (event) => {
            onKeyDown?.(event);
            if (!event.defaultPrevented)
                handleKeyDown(event);
        }, className: cx("flex flex-col gap-0.5", className), ...props, children: sections === undefined
            ? (items ?? []).map((item) => renderRow(item, "items"))
            : sections.map((section) => (_jsxs("div", { role: "group", "aria-label": section.title, className: "flex flex-col gap-0.5", children: [_jsx("div", { "aria-hidden": "true", className: cx("px-[var(--control-padding-x,0.75rem)] pb-1 pt-2 text-[length:var(--text-caption,11px)] font-medium uppercase tracking-wide", INK.faint), children: section.title }), section.items.map((item) => renderRow(item, section.id))] }, section.id))) }));
}
//# sourceMappingURL=ListView.js.map