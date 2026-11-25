import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useId } from "react";
import { cx } from "./cx.js";
import { EDGE, INK, SURFACE } from "./tokens.js";
export function DetailView({ title, subtitle, actions, footer, className, children, ...props }) {
    const titleId = useId();
    return (_jsxs("section", { "aria-labelledby": titleId, "data-has-footer": footer === undefined ? undefined : "true", className: cx("flex h-full min-h-0 flex-col", SURFACE.base, INK.base, className), ...props, children: [_jsxs("header", { className: cx("flex shrink-0 items-start justify-between gap-3 border-b px-5 py-4", EDGE.hairline), children: [_jsxs("div", { className: "min-w-0", children: [_jsx("h2", { id: titleId, className: "truncate text-[length:var(--text-title,15px)] font-semibold", children: title }), subtitle === undefined ? null : (_jsx("p", { className: cx("mt-1 text-[length:var(--text-label,12px)]", INK.muted), children: subtitle }))] }), actions === undefined ? null : (_jsx("div", { className: "flex shrink-0 items-center gap-2", children: actions }))] }), _jsx("div", { className: "min-h-0 flex-1 overflow-y-auto px-5 py-4", children: children }), footer === undefined ? null : (_jsx("footer", { className: cx("sticky bottom-0 z-10 shrink-0 border-t px-5 py-3", SURFACE.base, EDGE.hairline), children: footer }))] }));
}
//# sourceMappingURL=DetailView.js.map