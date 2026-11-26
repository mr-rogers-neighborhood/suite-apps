import { type ReactNode } from "react";
/**
 * A dialog surface: the backdrop, the focus trap, Escape, and the ARIA.
 *
 * The behaviour is Radix Dialog's, not another hand-written focus trap. It moves focus in on
 * open, returns it on close, wraps Tab inside the panel, closes on Escape and on a press
 * outside, and marks the rest of the page inert. Those are the parts every hand-written modal
 * gets subtly wrong, and they are exactly what the chosen primitive already owns.
 *
 * The public API stays the app-facing one: `open`, `onClose`, `label`, `size`. Radix's
 * `onOpenChange` is only the bridge; a caller never learns that the implementation changed.
 *
 * A bare panel (no slots) is unchanged from the first version: `children` get the padding and
 * the panel scrolls. Passing `header`, `description` or `footer` switches to a fixed frame —
 * header and footer stay put while `children` scroll between them — so an app keeps its visible
 * title, description and close control caller-composed rather than taught to the primitive.
 */
export interface ModalProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** Read aloud on open, and the panel's accessible name. */
    readonly label: string;
    /**
     * A fixed region above the scrolling body. A caller puts its visible heading and close
     * control here; the primitive does not add a title of its own.
     */
    readonly header?: ReactNode;
    /** Shown under the header and announced as the dialog's description. */
    readonly description?: ReactNode;
    /** A fixed region below the scrolling body: the caller's actions. */
    readonly footer?: ReactNode;
    readonly children: ReactNode;
    /** `sm` fits a confirm; `md` a form; `lg` a wizard step; `xl` a wide import or table. */
    readonly size?: "sm" | "md" | "lg" | "xl";
    readonly className?: string;
    /**
     * Called before Escape closes. `preventDefault()` keeps the dialog open, which is how a caller
     * with its own levels steps back one instead of dismissing.
     */
    readonly onEscapeKeyDown?: (event: globalThis.KeyboardEvent) => void;
}
export declare function Modal({ open, onClose, label, header, description, footer, children, size, className, onEscapeKeyDown, }: ModalProps): import("react").JSX.Element;
//# sourceMappingURL=Modal.d.ts.map