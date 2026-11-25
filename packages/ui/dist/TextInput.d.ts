import type { InputHTMLAttributes } from "react";
/**
 * The suite's text input, on its own.
 *
 * `Field` uses this for the control it wires up. The standalone export exists for the places
 * that have no room for a label column — a table cell, an inline rename — so those screens use
 * the same height, edge and focus ring instead of hand-rolling an `<input>`.
 */
export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
    /** Paints the error edge without a `Field` to say so. */
    readonly invalid?: boolean;
}
export declare function TextInput({ invalid, className, ...props }: TextInputProps): import("react").JSX.Element;
//# sourceMappingURL=TextInput.d.ts.map