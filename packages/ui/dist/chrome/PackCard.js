import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cx } from "../cx.js";
import { EDGE, FOCUS_RING, INK, MOTION, SURFACE } from "../tokens.js";
const STATUS_LABEL = {
    installed: "Installed",
    update: "Update",
    available: "Available",
    unavailable: "Unavailable",
};
/**
 * One pack in a host's catalogue.
 *
 * The card is a chooser, not a launcher: choosing it shows the pack's details and its one action
 * in the rail, which is where versions, publishers and capabilities live. A person scanning Home
 * should see a mark, a name and a sentence — not a fingerprint.
 */
export function PackCard({ name, description, icon, status = "available", version, selected = false, onSelect, }) {
    return (_jsxs("button", { type: "button", "aria-pressed": selected, onClick: onSelect, className: cx("group flex w-full items-start gap-3 rounded-lg border p-3 text-left", selected
            ? "border-[var(--accent)] bg-[var(--surface-strong)]"
            : cx(EDGE.hairline, SURFACE.base), "hover:bg-[var(--surface-sunk)]", MOTION, FOCUS_RING), children: [_jsx("span", { "aria-hidden": "true", className: cx("flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md", SURFACE.sunk, INK.muted), children: icon === undefined ? (_jsx("span", { className: "text-[length:var(--text-title,15px)]", children: name.trim().slice(0, 1).toUpperCase() })) : (_jsx("img", { src: icon, alt: "", className: "h-6 w-6 object-contain" })) }), _jsxs("span", { className: "min-w-0 flex-1", children: [_jsxs("span", { className: "flex items-baseline gap-2", children: [_jsx("span", { className: cx("min-w-0 flex-1 truncate text-[length:var(--text-title,15px)]", INK.base), children: name }), version === undefined ? null : (_jsx("span", { className: cx("shrink-0 text-[length:var(--text-caption,11px)]", INK.faint), children: version }))] }), description === undefined ? null : (_jsx("span", { className: cx("mt-0.5 block text-[length:var(--text-label,12px)] leading-relaxed", INK.muted), children: description })), _jsx("span", { className: cx("mt-2 block text-[length:var(--text-caption,11px)]", status === "installed" ? INK.muted : INK.faint, status === "update" ? "text-[var(--accent)]" : undefined), children: STATUS_LABEL[status] })] })] }));
}
//# sourceMappingURL=PackCard.js.map