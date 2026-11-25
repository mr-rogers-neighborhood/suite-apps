import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field.js";
import { TextInput } from "./TextInput.js";

describe("Field", () => {
  it("labels and describes the input it renders", () => {
    render(<Field label="Amount" hint="In your own currency." defaultValue="10" />);
    const input = screen.getByLabelText("Amount");
    const hint = screen.getByText("In your own currency.");
    expect(input).toHaveAttribute("aria-describedby", hint.getAttribute("id"));
  });

  it("marks an error as invalid and announces it", () => {
    render(<Field label="Amount" error="Enter a number." defaultValue="x" />);
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a number.");
  });

  it("labels a child control instead of rendering an input", () => {
    render(
      <Field label="Account" hint="Open accounts only.">
        <select defaultValue="checking">
          <option value="checking">Checking</option>
        </select>
      </Field>,
    );
    const select = screen.getByLabelText("Account");
    const hint = screen.getByText("Open accounts only.");
    expect(select.tagName).toBe("SELECT");
    expect(select).toHaveAttribute("aria-describedby", hint.getAttribute("id"));
  });

  it("keeps a child control's own id", () => {
    render(
      <Field label="Account">
        <select id="account" defaultValue="checking">
          <option value="checking">Checking</option>
        </select>
      </Field>,
    );
    const select = screen.getByLabelText("Account");
    expect(select).toHaveAttribute("id", "account");
    expect(screen.getByText("Account")).toHaveAttribute("for", "account");
  });
});

describe("TextInput", () => {
  it("renders the shared input with its own name", () => {
    render(<TextInput aria-label="Amount" defaultValue="10" />);
    expect(screen.getByLabelText("Amount")).toHaveValue("10");
  });

  it("paints the error edge when invalid", () => {
    render(<TextInput aria-label="Amount" invalid />);
    expect(screen.getByLabelText("Amount")).toHaveClass("border-[var(--danger)]");
  });
});
