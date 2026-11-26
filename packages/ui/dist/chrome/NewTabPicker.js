import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from "react";
import { cx } from "../cx.js";
import { Modal } from "../Modal.js";
import { FOCUS_RING, INK, MOTION, SURFACE } from "../tokens.js";
/** How many documents a Recent section shows. */
const RECENT_LIMIT = 5;
const NEUTRAL_NOUN = { singular: "document", plural: "documents" };
function nounFor(pack) {
    return pack.noun ?? NEUTRAL_NOUN;
}
function documentKey(packId, documentId) {
    return `${packId}\u0000${documentId}`;
}
function byRecent(left, right) {
    return (right.openedAt ?? 0) - (left.openedAt ?? 0) || left.name.localeCompare(right.name);
}
function byName(left, right) {
    return left.name.localeCompare(right.name);
}
/**
 * The new-tab picker.
 *
 * A new tab is a question — which surface? — and, when that surface holds documents, which one?
 * The answer is one dialog in two levels: packs, Screens and the host's own actions at the root;
 * a pack's documents at the second level. That shape comes from how the host stores documents:
 * the pack owns many, and opening a pack is almost always opening one of them.
 *
 * Focus never leaves the input. The list is an ARIA listbox driven by `aria-activedescendant`,
 * so typing and arrows never compete; Enter opens the active row. A pack with no documents opens
 * directly, which is how Help stays a single level without the picker knowing what Help is.
 *
 * The picker is presentation only. The host owns the tab list, the document store, the recents
 * record and what "open" means.
 */
export function NewTabPicker({ open, packs, screens, openDocuments, onClose, onOpenPack, onOpenDocument, onNewDocument, onOpenScreen, onNewScreen, onOpenSettings, onOpenFile, initialQuery = "", "data-testid": testId = "new-tab-picker", }) {
    const [query, setQuery] = useState(initialQuery);
    const [level, setLevel] = useState(null);
    const [active, setActive] = useState(0);
    const input = useRef(null);
    const listId = useId();
    const openKeys = new Set((openDocuments ?? []).map((entry) => documentKey(entry.packId, entry.documentId)));
    const pack = level === null ? undefined : packs.find((row) => row.id === level);
    const noun = pack === undefined ? NEUTRAL_NOUN : nounFor(pack);
    const documents = pack?.documents ?? [];
    useEffect(() => {
        if (!open)
            return;
        setLevel(null);
        setQuery(initialQuery);
        setActive(0);
        // Radix focuses the first control, which is the input; this keeps the intent explicit for
        // a caller that mounts the dialog already open.
        input.current?.focus();
    }, [open, initialQuery]);
    useEffect(() => {
        setActive(0);
    }, [query, level]);
    function rootItems() {
        const items = [];
        const needle = query.trim().toLowerCase();
        if (needle.length === 0) {
            const recents = packs
                .filter((owner) => owner.unavailable !== true)
                .flatMap((owner) => (owner.documents ?? [])
                .filter((document) => document.openedAt !== undefined &&
                !openKeys.has(documentKey(owner.id, document.id)))
                .map((document) => ({ owner, document })))
                .sort((left, right) => byRecent(left.document, right.document))
                .slice(0, RECENT_LIMIT);
            for (const { owner, document } of recents) {
                items.push({
                    key: `recent:${owner.id}:${document.id}`,
                    group: "Recents",
                    rank: 1,
                    label: document.name,
                    description: document.description === undefined
                        ? owner.name
                        : `${owner.name} · ${document.description}`,
                    icon: owner.icon,
                    disabled: false,
                    run: () => onOpenDocument(owner.id, document.id),
                });
            }
        }
        for (const row of packs) {
            const count = (row.documents ?? []).length;
            items.push({
                key: `pack:${row.id}`,
                group: "Packs",
                rank: 2,
                label: row.name,
                description: row.description,
                icon: row.icon,
                disabled: row.unavailable === true,
                ...(row.documents !== undefined && row.unavailable !== true
                    ? { drill: row.id, hint: `${String(count)} ${nounFor(row).plural}` }
                    : {}),
                run: () => onOpenPack(row.id),
            });
        }
        if (needle.length > 0) {
            // The root only lists recent documents, so a query is the one way to reach the rest
            // without choosing a pack first. Each hit carries its pack, because the row alone would
            // not say which app it belongs to.
            const hits = packs
                .filter((owner) => owner.unavailable !== true)
                .flatMap((owner) => (owner.documents ?? []).map((document) => ({ owner, document })))
                .sort((left, right) => byRecent(left.document, right.document));
            for (const { owner, document } of hits) {
                items.push({
                    key: `document:${owner.id}:${document.id}`,
                    group: "Documents",
                    rank: 3,
                    label: document.name,
                    description: document.description === undefined
                        ? owner.name
                        : `${owner.name} · ${document.description}`,
                    icon: owner.icon,
                    disabled: false,
                    run: () => onOpenDocument(owner.id, document.id),
                });
            }
        }
        for (const screen of screens) {
            items.push({
                key: `screen:${screen.id}`,
                group: "Screens",
                rank: 4,
                label: screen.name,
                description: screen.description,
                disabled: false,
                run: () => onOpenScreen(screen.id),
            });
        }
        items.push({
            key: "action:new-screen",
            group: "Screens",
            rank: 4,
            label: "New screen",
            description: "Compose a new Screen",
            disabled: false,
            run: onNewScreen,
        });
        if (onOpenFile !== undefined) {
            items.push({
                key: "action:open-file",
                group: "Host",
                rank: 5,
                label: "Open a file…",
                description: "Open a file this machine already holds",
                disabled: false,
                run: onOpenFile,
            });
        }
        items.push({
            key: "action:settings",
            group: "Host",
            rank: 5,
            label: "Settings",
            description: "Appearance, packs, sync and backups",
            disabled: false,
            run: () => onOpenSettings(),
        });
        if (packs.length === 0) {
            items.push({
                key: "action:install-pack",
                group: "Start",
                rank: 0,
                label: "Install a pack",
                description: "Choose a .suitepack this machine already holds",
                disabled: false,
                run: () => onOpenSettings("packs"),
            });
        }
        return items;
    }
    function packItems(owner) {
        const items = [];
        const ownerNoun = nounFor(owner);
        const all = owner.documents ?? [];
        const recents = all
            .filter((document) => document.openedAt !== undefined &&
            !openKeys.has(documentKey(owner.id, document.id)))
            .sort(byRecent)
            .slice(0, RECENT_LIMIT);
        const recentKeys = new Set(recents.map((document) => document.id));
        const row = (document, group, rank) => ({
            key: `document:${owner.id}:${document.id}`,
            group,
            rank,
            label: document.name,
            description: document.description,
            icon: owner.icon,
            disabled: false,
            run: () => onOpenDocument(owner.id, document.id),
        });
        for (const document of recents) {
            items.push(row(document, `Recent ${ownerNoun.plural}`, 1));
        }
        for (const document of all.filter((entry) => !recentKeys.has(entry.id)).sort(byName)) {
            items.push(row(document, ownerNoun.plural, 2));
        }
        items.push({
            key: `new:${owner.id}`,
            group: "Host",
            rank: 3,
            label: `New ${ownerNoun.singular}`,
            disabled: false,
            run: () => onNewDocument(owner.id),
        });
        return items;
    }
    const source = pack === undefined ? rootItems() : packItems(pack);
    const needle = query.trim().toLowerCase();
    const visible = (needle.length === 0
        ? source
        : source.filter((item) => `${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle)))
        .slice()
        .sort((left, right) => left.rank - right.rank);
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
    function goBack() {
        setLevel(null);
        setQuery("");
        setActive(0);
        input.current?.focus();
    }
    function drillInto(packId) {
        setLevel(packId);
        setQuery("");
        setActive(0);
        input.current?.focus();
    }
    function activate(item) {
        if (item === undefined || item.disabled)
            return;
        if (item.drill !== undefined) {
            drillInto(item.drill);
            return;
        }
        item.run();
        onClose();
    }
    function move(step) {
        if (visible.length === 0)
            return;
        let next = activeIndex;
        for (let taken = 0; taken < visible.length; taken += 1) {
            next = (next + step + visible.length) % visible.length;
            if (visible[next]?.disabled !== true) {
                setActive(next);
                return;
            }
        }
    }
    function edge(fromEnd) {
        const order = fromEnd ? [...visible].reverse() : visible;
        const found = order.findIndex((item) => !item.disabled);
        if (found < 0)
            return;
        setActive(fromEnd ? visible.length - 1 - found : found);
    }
    function onKeyDown(event) {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            move(1);
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            move(-1);
            return;
        }
        if (event.key === "Home") {
            event.preventDefault();
            edge(false);
            return;
        }
        if (event.key === "End") {
            event.preventDefault();
            edge(true);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            activate(activeItem);
            return;
        }
        if (pack !== undefined && event.key === "Backspace" && query.length === 0) {
            event.preventDefault();
            goBack();
        }
    }
    const placeholder = pack === undefined
        ? "Search packs, Screens and documents"
        : `Search ${noun.plural}`;
    const escapeHint = query.length > 0 ? "Esc to clear" : pack === undefined ? "Esc to close" : "Esc to go back";
    const empty = visible.length === 0;
    return (_jsxs(Modal, { open: open, onClose: onClose, 
        // One key, one step: Escape clears a query, then leaves the level, then closes.
        onEscapeKeyDown: (event) => {
            if (query.length > 0) {
                event.preventDefault();
                setQuery("");
                setActive(0);
                return;
            }
            if (pack === undefined)
                return;
            event.preventDefault();
            goBack();
        }, label: "New tab", size: "lg", header: _jsxs("div", { className: "flex items-center gap-2", "data-testid": testId, children: [pack === undefined ? null : (_jsx("button", { type: "button", "aria-label": "Back to packs", onClick: goBack, className: cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: _jsx("svg", { "aria-hidden": "true", viewBox: "0 0 16 16", className: "h-3.5 w-3.5", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "M10 3 5 8l5 5" }) }) })), _jsx("input", { ref: input, type: "text", role: "combobox", "aria-label": placeholder, "aria-expanded": open, "aria-controls": listId, "aria-autocomplete": "list", "aria-activedescendant": activeItem === undefined ? undefined : `${listId}-option-${activeIndex}`, autoComplete: "off", spellCheck: false, placeholder: placeholder, value: query, onChange: (event) => {
                        setQuery(event.target.value);
                        setActive(0);
                    }, onKeyDown: onKeyDown, className: cx("h-9 min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-[var(--surface-sunk)] px-2.5 text-[length:var(--text-body,13px)]", INK.base, FOCUS_RING) }), _jsx("button", { type: "button", "aria-label": "Close", onClick: onClose, className: cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-sunk)] hover:text-[var(--ink)]", MOTION, FOCUS_RING), children: _jsx("span", { "aria-hidden": "true", children: "\u00d7" }) })] }), footer: _jsxs("p", { className: "text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: [_jsx("span", { "aria-hidden": "true", children: "\u2191\u2193" }), " to move \u00B7 Enter to open \u00B7 ", escapeHint, pack === undefined ? null : " · Backspace goes back"] }), children: [_jsx("p", { "aria-live": "polite", className: "sr-only", children: pack === undefined
                    ? ""
                    : `${pack.name}, ${String(documents.length)} ${noun.plural}` }), packs.length === 0 && needle.length === 0 ? (_jsx("p", { className: "px-2 pb-2 text-[length:var(--text-body,13px)] text-[var(--ink-muted)]", children: "No packs are installed yet. Install one to open its documents, or compose a Screen." })) : null, pack !== undefined && documents.length === 0 && needle.length === 0 ? (_jsxs("p", { className: "px-2 pb-2 text-[length:var(--text-body,13px)] text-[var(--ink-muted)]", children: ["No ", noun.plural, " yet."] })) : null, _jsx("div", { id: listId, role: "listbox", "aria-label": "Open a tab", children: _jsx("div", { className: "flex flex-col gap-3", "data-testid": `${testId}-list`, children: groups.map((group) => (_jsxs("div", { role: "group", "aria-label": group.label, children: [_jsx("p", { "aria-hidden": "true", className: "px-2 pb-1 text-[length:var(--text-caption,11px)] uppercase tracking-wide text-[var(--ink-faint)]", children: group.label }), _jsx("div", { className: "flex flex-col gap-0.5", children: group.items.map((item) => {
                                    const index = visible.indexOf(item);
                                    const selected = index === activeIndex;
                                    return (_jsxs("div", { id: `${listId}-option-${index}`, role: "option", "aria-selected": selected, "aria-disabled": item.disabled ? true : undefined, tabIndex: -1, onClick: () => activate(item), onMouseMove: () => setActive(index), className: cx("flex items-center gap-3 rounded-md px-2 py-2", selected ? SURFACE.sunk : undefined, item.disabled
                                            ? "cursor-not-allowed opacity-50"
                                            : "cursor-pointer hover:bg-[var(--surface-sunk)]", MOTION), children: [item.icon === undefined ? (_jsx("span", { "aria-hidden": "true", className: cx("h-1.5 w-1.5 shrink-0 rounded-full", item.group === "Packs" || item.group === "Recents"
                                                    ? "bg-[var(--accent)]"
                                                    : "bg-[var(--ink-faint)]") })) : (_jsx("span", { "aria-hidden": "true", className: "flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-md [&_img]:h-full [&_img]:w-full [&_img]:object-contain", children: item.icon })), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsx("span", { className: "block truncate text-[length:var(--text-body,13px)] text-[var(--ink)]", children: item.label }), item.description === undefined ? null : (_jsx("span", { className: "block truncate text-[length:var(--text-caption,11px)] text-[var(--ink-muted)]", children: item.description }))] }), item.disabled ? (_jsx("span", { className: "shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: "unavailable" })) : null, item.hint === undefined ? null : (_jsx("span", { className: "shrink-0 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]", children: item.hint })), item.drill === undefined ? null : (_jsx("svg", { "aria-hidden": "true", viewBox: "0 0 16 16", className: "h-3 w-3 shrink-0 text-[var(--ink-faint)]", fill: "none", stroke: "currentColor", strokeWidth: "1.5", children: _jsx("path", { d: "m6 3 5 5-5 5" }) }))] }, item.key));
                                }) })] }, group.label))) }) }), empty ? (_jsx("p", { role: "status", className: "px-2 py-3 text-[length:var(--text-body,13px)] text-[var(--ink-muted)]", children: pack === undefined
                    ? `Nothing matches “${query.trim()}”. Try a pack, a Screen or “Settings”.`
                    : `Nothing matches “${query.trim()}” in ${noun.plural}.` })) : null] }));
}
//# sourceMappingURL=NewTabPicker.js.map