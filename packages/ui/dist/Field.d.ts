import { type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
/**
 * A label, a control, a hint and an error, as one unit.
 *
 * The point is not the layout, it is that the wiring cannot be forgotten: the label gets the
 * `htmlFor` the control gets the `id`, the hint is `aria-describedby`, and an error is both
 * described and marked `aria-invalid`. Every app has a form somewhere that leaves one of those
 * out, and a shared `Field` is the only version that cannot.
 *
 * Without `children` it renders the suite's `TextInput`. With one — a `<select>`, a date input
 * or an app's picker — it labels and describes that control instead, as long as the control
 * forwards `id` and the `aria-*` props to the element that takes focus.
 */
export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "id"> {
    readonly label: string;
    /** What the value should be, when that is not obvious. Announced with the control. */
    readonly hint?: ReactNode;
    /** What is wrong with it. Presence also sets `aria-invalid`. */
    readonly error?: ReactNode;
    /** Rendered after the control: a suffix, a unit, a picker. */
    readonly trailing?: ReactNode;
    /** Forces an id when a caller needs to reference the control from elsewhere. */
    readonly id?: string;
    /** A control to label instead of the built-in input. */
    readonly children?: ReactElement<Record<string, unknown>>;
}
export declare function Field({ label, hint, error, trailing, id, className, children, ...props }: FieldProps): import("react").JSX.Element;
//# sourceMappingURL=Field.d.ts.map