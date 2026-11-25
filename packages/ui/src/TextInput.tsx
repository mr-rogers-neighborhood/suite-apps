import type { InputHTMLAttributes } from "react";
import { cx } from "./cx.js";
import { EDGE, FOCUS_RING, INK, MOTION, SURFACE } from "./tokens.js";

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

export function TextInput({ invalid = false, className, ...props }: TextInputProps) {
  return (
    <input
      className={cx(
        "h-[var(--control-height,2.25rem)] w-full rounded-lg border px-[var(--control-padding-x,0.75rem)] text-[length:var(--text-body,13px)]",
        MOTION,
        SURFACE.base,
        INK.base,
        FOCUS_RING,
        // An input's edge is the only thing saying "you can type here", so it is a
        // component boundary and clears 3:1 — `hairline` would not.
        invalid ? EDGE.danger : EDGE.strong,
        "placeholder:text-[var(--ink-faint)]",
        "disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
