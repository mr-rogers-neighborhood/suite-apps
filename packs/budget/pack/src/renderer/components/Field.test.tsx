import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, TextInput } from "@suite/ui";

describe("Field", () => {
  it("labels the shared input and announces the hint", () => {
    render(<Field label="Payee" hint="Who was it?" />);
    const input = screen.getByLabelText("Payee");
    const hint = screen.getByText("Who was it?");
    expect(input).toHaveAttribute("aria-describedby", hint.getAttribute("id"));
  });

  it("labels a select the pack wraps", () => {
    render(
      <Field label="Account">
        <select defaultValue="checking">
          <option value="checking">Checking</option>
        </select>
      </Field>,
    );
    expect(screen.getByLabelText("Account").tagName).toBe("SELECT");
  });

  it("renders the shared TextInput with its own name", () => {
    render(<TextInput aria-label="Amount" defaultValue="10" />);
    expect(screen.getByLabelText("Amount")).toHaveValue("10");
  });
});
