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
 */
export interface ModalProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** Read aloud on open, and the panel's accessible name. */
    readonly label: string;
    readonly children: ReactNode;
    /** `sm` fits a confirm; `md` a form; `lg` a wizard step. */
    readonly size?: "sm" | "md" | "lg";
    readonly className?: string;
}
export declare function Modal({ open, onClose, label, children, size, className }: ModalProps): import("react").JSX.Element;
//# sourceMappingURL=Modal.d.ts.map