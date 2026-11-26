import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("keeps Budget's title, description, footer and Close control", () => {
    const onOpenChange = vi.fn();
    render(
      <Modal
        open
        onOpenChange={onOpenChange}
        title="Merge payees"
        description="Every transaction on the first payee moves to the second."
        footer={<button type="button">Merge</button>}
      >
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Merge payees" });
    // A phone keyboard changes the visual viewport; the frame follows it below `md`.
    expect(dialog).toHaveClass("max-md:max-h-[calc(100dvh-1rem)]");
    expect(dialog).toHaveAccessibleDescription(
      "Every transaction on the first payee moves to the second.",
    );
    expect(screen.getByRole("heading", { name: "Merge payees" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still closes on Escape", () => {
    const onOpenChange = vi.fn();
    render(
      <Modal open onOpenChange={onOpenChange} title="Settings">
        <p>body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("omits the description when the caller has none", () => {
    render(
      <Modal open onOpenChange={() => {}} title="Settings">
        <p>body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Settings" })).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
