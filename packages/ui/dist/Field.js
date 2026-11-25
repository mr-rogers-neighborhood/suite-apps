import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cloneElement, useId, } from "react";
import { cx } from "./cx.js";
import { INK } from "./tokens.js";
import { TextInput } from "./TextInput.js";
export function Field({ label, hint, error, trailing, id, className, children, ...props }) {
    const generated = useId();
    const childId = children?.props["id"];
    const fieldId = id ?? (typeof childId === "string" ? childId : generated);
    const hintId = `${fieldId}-hint`;
    const errorId = `${fieldId}-error`;
    const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
        .filter((value) => value !== null)
        .join(" ");
    const control = children === undefined ? (_jsx(TextInput, { id: fieldId, "aria-invalid": error !== undefined, "aria-describedby": describedBy.length === 0 ? undefined : describedBy, ...props })) : (cloneElement(children, {
        id: fieldId,
        ...(error === undefined ? {} : { "aria-invalid": true }),
        "aria-describedby": children.props["aria-describedby"] ??
            (describedBy.length === 0 ? undefined : describedBy),
    }));
    return (_jsxs("div", { className: cx("flex flex-col gap-1.5", className), children: [_jsx("label", { htmlFor: fieldId, className: cx("text-[length:var(--text-label,12px)] font-medium", INK.base), children: label }), _jsxs("div", { className: "flex items-center gap-2", children: [control, trailing] }), hint === undefined ? null : (_jsx("p", { id: hintId, className: cx("text-[length:var(--text-caption,11px)]", INK.muted), children: hint })), error === undefined ? null : (_jsx("p", { id: errorId, className: cx("text-[length:var(--text-caption,11px)]", INK.danger), children: error }))] }));
}
//# sourceMappingURL=Field.js.map