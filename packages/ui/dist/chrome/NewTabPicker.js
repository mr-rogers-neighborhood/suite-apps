import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../cx.js";
import { Modal } from "../Modal.js";
import { FOCUS_RING, INK, MOTION, SURFACE } from "../tokens.js";
export function NewTabPicker({ open, packs, screens, onClose, onOpenPack, onOpenScreen, onNewScreen, onOpenSettings, initialQuery = "", "data-testid": testId = "new-tab-picker", }) {
    const [query, setQuery] = useState(initialQuery);
    const [active, setActive] = useState(0);
    const input = useRef(null);
    const listId = useId();
    useEffect(() => {
        if (!open)
            return;
        setQuery(initialQuery);
        setActive(0);
        // Radix focuses the first control, which is the input; this keeps the intent explicit for
        // a caller that mounts the dialog already open.
        input.current?.focus();
    }, [open, initialQuery]);
    const items = [
        ...packs.map((pack) => ({
            key: `pack:${pack.id}`,
            group: "Packs",
            label: pack.name,
            ...(pack.description === undefined ? {} : { description: pack.description }),
            ...(pack.icon === undefined ? {} : { icon: pack.icon }),
            disabled: pack.unavailable === true,
            run: () => onOpenPack(pack.id),
        })),
        ...screens.map((screen) => ({
            key: `screen:${screen.id}`,
            group: "Screens",
            label: screen.name,
            ...(screen.description === undefined ? {} : { description: screen.description }),
            disabled: false,
            run: () => onOpenScreen(screen.id),
        })),
        {
            key: "action:new-screen",
            group: "Host",
            label: "New screen",
            description: "Compose a new Screen",
            disabled: false,
            run: onNewScreen,
        },
        {
            key: "action:settings",
            group: "Host",
            label: "Settings",
            description: "Appearance, packs, sync and backups",
            disabled: false,
            run: onOpenSettings,
        },
    ];
    const needle = query.trim().toLowerCase();
    const visible = needle.length === 0
        ? items
        : items.filter((item) => `${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle));
    const activeIndex = Math.min(active, Math.max(visible.length - 1, 0));
    const activeItem = visible[activeIndex];
    const groups = [];
    for (const item of visible) {
        const last = groups[groups.length - 1];
        if (last?.label === item.group)
            last.items.push(item);
        else
            groups.push({ label: item.group, items: [item] });
    }
    function activate(item) {
        if (item === undefined || item.disabled)
            return;
        item.run();
        onClose();
    }
    function onKeyDown(event) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive(visible.length === 0 ? 0 : (activeIndex + 1) % visible.length);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive(visible.length === 0 ? 0 : (activeIndex - 1 + visible.length) % visible.length);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            activate(activeItem);
        }
    }
    return (_jsxs(Modal, { open: open, onClose: onClose, label: "New tab", size: "lg", header: _jsxs("div", { className: "flex items-center gap-2", "data-testid": testId, children: [_jsx("input", { ref: input, type: "text", role: "combobox", "aria-label": "Search apps, screens and commands", "aria-expanded": open, "aria-controls": listId, "aria-autocomplete": "list", "aria-activedescendant": activeItem === undefined ? undefined : `${listId}-option-${activeIndex}`, autoComplete: "off", spellCheck: false, placeholder: "Search apps, screens and commands", value: query, onChange: (event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }, onKeyDown: onKeyDown, className: cx("h-9 min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-sunk)] px-2.5 text-[length:var(--text-body,13px)]", INK.base, FOCUS_RING) }), _jsx("button", { type: "button", "aria-label": "Close", onClick: onClose, className: cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "\u00d7" }) })] }), footer: _jsxs("p", { className: "text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: [_jsx("span", { "aria-hidden": "true", children: "\u2191\u2193" }), " to move \u00B7 Enter to open \u00B7 Esc to close"] }), children: [_jsx("div", { id: listId, role: "listbox", "aria-label": "Open a tab", children: _jsx("div", { className: "flex flex-col gap-3", "data-testid": `${testId}-list`, children: groups.map((group) => (_jsxs("div", { role: "group", "aria-label": group.label, children: [_jsx("p", { "aria-hidden": "true", className: "px-2 pb-1 text-[length:var(--text-caption,11px)] uppercase tracking-wide text-[var(--ink-faint)]", children: group.label }), _jsx("div", { className: "flex flex-col gap-0.5", children: group.items.map((item) => {
                                    const index = visible.indexOf(item);
                                    const selected = index === activeIndex;
                                    return (_jsxs("div", { id: `${listId}-option-${index}`, role: "option", "aria-selected": selected, "aria-disabled": item.disabled ? true : undefined, tabIndex: -1, onClick: () => activate(item), onMouseMove: () => setActive(index), className: cx("flex items-center gap-3 rounded-md px-2 py-2", selected && !item.disabled ? SURFACE.sunk : undefined, item.disabled
                                            ? "cursor-not-allowed opacity-50"
                                            : "cursor-pointer hover:bg-[var(--surface-sunk)]", MOTION), children: [item.icon === undefined ? (_jsx("span", { "aria-hidden": "true", className: cx("h-1.5 w-1.5 shrink-0 rounded-full", item.group === "Packs"
                                                    ? "bg-[var(--accent)]"
                                                    : "bg-[var(--ink-faint)]") })) : (_jsx("span", { "aria-hidden": "true", className: "flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md [&_img]:h-full [&_img]:w-full [&_img]:object-contain", children: item.icon })), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate text-[length:var(--text-body,13px)] text-[var(--ink)]", children: item.label }), item.description === undefined ? null : (_jsx("span", { className: "block truncate text-[length:var(--text-caption,11px)] text-[var(--ink-muted)]", children: item.description }))] }), item.disabled ? (_jsx("span", { className: "shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: "unavailable" })) : null] }, item.key));
                                }) })] }, group.label))) }) }), visible.length === 0 ? (_jsxs("p", { role: "status", className: "px-2 py-3 text-[length:var(--text-body,13px)] text-[var(--ink-muted)]", children: ["Nothing matches \u201C", query.trim(), "\u201D. Try a pack, a screen or \u201CSettings\u201D."] })) : null] }));
}
//# sourceMappingURL=NewTabPicker.js.map