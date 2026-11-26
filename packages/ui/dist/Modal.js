import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef } from "react";
import { cx } from "./cx.js";
import { EDGE, INK, SURFACE } from "./tokens.js";
const SIZES = {
    sm: "w-[min(400px,calc(100vw-2rem))]",
    md: "w-[min(560px,calc(100vw-2rem))]",
    lg: "w-[min(760px,calc(100vw-2rem))]",
    xl: "w-[min(896px,calc(100vw-2rem))]",
};
export function Modal({ open, onClose, label, header, description, footer, children, size = "md", className, onEscapeKeyDown, }) {
    // Radix restores focus on close, but capture the opener explicitly as well: a caller may
    // unmount the dialog in the same render that closes it, and the explicit target survives
    // that. This is the one behaviour the package owned before Radix and still promises.
    const restoreTo = useRef(null);
    const framed = header !== undefined || description !== undefined || footer !== undefined;
    return (_jsx(DialogPrimitive.Root, { open: open, onOpenChange: (next) => {
            // A caller's `onClose` is the only close event it cares about. Opening is controlled
            // by `open`; Radix never asks to open a dialog from inside one.
            if (!next)
                onClose();
        }, children: _jsxs(DialogPrimitive.Portal, { children: [_jsx(DialogPrimitive.Overlay, { className: "fixed inset-0 z-[70] bg-[color-mix(in_srgb,var(--ink)_30%,transparent)] backdrop-blur-[2px]" }), _jsxs(DialogPrimitive.Content
                // A visible heading belongs to the caller. The hidden title names the dialog for
                // assistive technology; the description, when given, is Radix's to wire up.
                , { ...(description === undefined ? { "aria-describedby": undefined } : {}), "aria-modal": "true", onEscapeKeyDown: onEscapeKeyDown, onOpenAutoFocus: () => {
                        restoreTo.current =
                            document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    }, onCloseAutoFocus: (event) => {
                        event.preventDefault();
                        if (restoreTo.current?.isConnected === true)
                            restoreTo.current.focus();
                    }, className: cx("fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-4rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border shadow-[var(--shadow-2xl)] outline-none", SURFACE.base, EDGE.hairline, INK.base, SIZES[size], framed ? "flex flex-col overflow-hidden" : "overflow-y-auto p-5", className), children: [_jsx(DialogPrimitive.Title, { asChild: true, children: _jsx("span", { className: "sr-only", children: label }) }), framed ? (_jsxs(_Fragment, { children: [header === undefined && description === undefined ? null : (_jsxs("div", { className: cx("shrink-0 border-b px-5 py-4", EDGE.hairline), children: [header, description === undefined ? null : (_jsx(DialogPrimitive.Description, { className: cx(header === undefined ? undefined : "mt-1", "text-[length:var(--text-label,12px)] leading-relaxed", INK.muted), children: description }))] })), _jsx("div", { className: "min-h-0 flex-1 overflow-y-auto p-5", children: children }), footer === undefined ? null : (_jsx("div", { className: cx("shrink-0 border-t px-5 py-3", EDGE.hairline), children: footer }))] })) : (children)] })] }) }));
}
//# sourceMappingURL=Modal.js.map