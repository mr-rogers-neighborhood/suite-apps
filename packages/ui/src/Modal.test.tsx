import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal.js";

describe("Modal", () => {
  it("renders nothing while closed", () => {
    render(
      <Modal open={false} onClose={() => {}} label="Settings">
        body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog with a name", () => {
    render(
      <Modal open onClose={() => {}} label="Settings">
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} label="Settings">
        <p>body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("gives focus to the first control, not to the page behind it", () => {
    render(
      <Modal open onClose={() => {}} label="Settings">
        <button type="button">First</button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("returns focus to whatever had it, on close", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const { rerender } = render(
      <Modal open onClose={() => {}} label="Settings">
        <button type="button">First</button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    rerender(
      <Modal open={false} onClose={() => {}} label="Settings">
        <button type="button">First</button>
      </Modal>,
    );
    // Radix restores focus from a zero-delay task after the focus scope unmounts.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
