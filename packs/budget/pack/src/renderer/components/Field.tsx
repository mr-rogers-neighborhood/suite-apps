import { Field as SharedField, TextInput as SharedTextInput } from "@suite/ui";
import type { InputHTMLAttributes, ReactElement } from "react";

export type FieldProps = {
  label: string;
  hint?: string;
  children: ReactElement<Record<string, unknown>>;
  htmlFor?: string;
};

/**
 * Budget's field, on the shared one.
 *
 * The call sites keep their props; the label, hint, control and error wiring come from
 * `@suite/ui`. A child control (`<select>`, a date input, `CategoryPicker`) is labelled and
 * described by the shared component, and the shared `TextInput` is passed straight through.
 */
export function Field({ label, hint, children, htmlFor }: FieldProps) {
  return (
    <SharedField
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(htmlFor === undefined ? {} : { id: htmlFor })}
    >
      {children}
    </SharedField>
  );
}

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <SharedTextInput className={className} {...props} />;
}
