import { jsx as _jsx } from "react/jsx-runtime";
import { cx } from "./cx.js";
const SIZES = {
    // `rounded-lg` and `rounded-xl` compile to `var(--radius-lg)` / `var(--radius-xl)`, so a
    // preset or a host scale reaches the tile. The old 9px middle step was not on any scale.
    sm: { tile: "h-6 w-6 rounded-lg", inset: "h-4 w-4" },
    md: { tile: "h-7 w-7 rounded-lg", inset: "h-[18px] w-[18px]" },
    lg: { tile: "h-12 w-12 rounded-xl", inset: "h-7 w-7" },
};
export function AppMark({ viewBox, paths, label, size = "md", className, }) {
    const { tile, inset } = SIZES[size];
    const named = label !== undefined;
    return (_jsx("span", { className: cx("inline-flex shrink-0 items-center justify-center", tile, 
        // The tile is the paint; the glyph inherits what the theme says is readable on it.
        "bg-[var(--accent)] text-[var(--on-accent)]", className), ...(named ? { role: "img", "aria-label": label } : { "aria-hidden": true }), children: _jsx("svg", { viewBox: viewBox, className: inset, fill: "currentColor", focusable: "false", "aria-hidden": "true", children: paths.map((d) => (_jsx("path", { d: d }, d))) }) }));
}
//# sourceMappingURL=AppMark.js.map