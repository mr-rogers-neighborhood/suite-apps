import { jsx as _jsx } from "react/jsx-runtime";
import { cx } from "./cx.js";
import { EDGE, FOCUS_RING, INK, MOTION, SURFACE } from "./tokens.js";
export function TextInput({ invalid = false, className, ...props }) {
    return (_jsx("input", { className: cx("h-[var(--control-height,2.25rem)] w-full rounded-lg border px-[var(--control-padding-x,0.75rem)] text-[length:var(--text-body,13px)]", MOTION, SURFACE.base, INK.base, FOCUS_RING, 
        // An input's edge is the only thing saying "you can type here", so it is a
        // component boundary and clears 3:1 — `hairline` would not.
        invalid ? EDGE.danger : EDGE.strong, "placeholder:text-[var(--ink-faint)]", "disabled:opacity-50", className), ...props }));
}
//# sourceMappingURL=TextInput.js.map