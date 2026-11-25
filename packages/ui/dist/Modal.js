import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef } from "react";
import { cx } from "./cx.js";
import { EDGE, INK, SURFACE } from "./tokens.js";
const SIZES = {
    sm: "w-[min(400px,calc(100vw-2rem))]",
    md: "w-[min(560px,calc(100vw-2rem))]",
    lg: "w-[min(760px,calc(100vw-2rem))]",
};
export function Modal({ open, onClose, label, children, size = "md", className }) {
    // Radix restores focus on close, but capture the opener explicitly as well: a caller may
    // unmount the dialog in the same render that closes it, and the explicit target survives
    // that. This is the one behaviour the package owned before Radix and still promises.
    const restoreTo = useRef(null);
    return (_jsx(DialogPrimitive.Root, { open: open, onOpenChange: (next) => {
            // A caller's `onClose` is the only close event it cares about. Opening is controlled
            // by `open`; Radix never asks to open a dialog from inside one.
            if (!next)
                onClose();
        }, children: _jsxs(DialogPrimitive.Portal, { children: [_jsx(DialogPrimitive.Overlay, { className: "fixed inset-0 z-[70] bg-[color-mix(in_srgb,var(--ink)_30%,transparent)] backdrop-blur-[2px]" }), _jsxs(DialogPrimitive.Content
                // A visible heading belongs to the caller. The hidden title is what names the
                // dialog for assistive technology; there is no description unless the caller adds one.
                , { "aria-describedby": undefined, "aria-modal": "true", onOpenAutoFocus: () => {
                        restoreTo.current =
                            document.activeElement instanceof HTMLElement ? document.activeElement : null;
                    }, onCloseAutoFocus: (event) => {
                        event.preventDefault();
                        if (restoreTo.current?.isConnected === true)
                            restoreTo.current.focus();
                    }, className: cx("fixed left-1/2 top-1/2 z-[71] max-h-[calc(100vh-4rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border p-5 shadow-[var(--shadow-2xl)] outline-none", SURFACE.base, EDGE.hairline, INK.base, SIZES[size], className), children: [_jsx(DialogPrimitive.Title, { asChild: true, children: _jsx("span", { className: "sr-only", children: label }) }), children] })] }) }));
}
//# sourceMappingURL=Modal.js.map