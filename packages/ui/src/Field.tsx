import {
  cloneElement,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  useId,
} from "react";
import { cx } from "./cx.js";
import { INK } from "./tokens.js";
import { TextInput } from "./TextInput.js";

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
export interface FieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "children" | "id"> {
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

export function Field({
  label,
  hint,
  error,
  trailing,
  id,
  className,
  children,
  ...props
}: FieldProps) {
  const generated = useId();
  const childId = children?.props["id"];
  const fieldId = id ?? (typeof childId === "string" ? childId : generated);
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === undefined ? null : errorId]
    .filter((value): value is string => value !== null)
    .join(" ");

  const control =
    children === undefined ? (
      <TextInput
        id={fieldId}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy.length === 0 ? undefined : describedBy}
        {...props}
      />
    ) : (
      cloneElement(children, {
        id: fieldId,
        ...(error === undefined ? {} : { "aria-invalid": true }),
        "aria-describedby":
          children.props["aria-describedby"] ??
          (describedBy.length === 0 ? undefined : describedBy),
      })
    );

  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={fieldId}
        className={cx("text-[length:var(--text-label,12px)] font-medium", INK.base)}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        {control}
        {trailing}
      </div>
      {hint === undefined ? null : (
        <p id={hintId} className={cx("text-[length:var(--text-caption,11px)]", INK.muted)}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={errorId} className={cx("text-[length:var(--text-caption,11px)]", INK.danger)}>
          {error}
        </p>
      )}
    </div>
  );
}
