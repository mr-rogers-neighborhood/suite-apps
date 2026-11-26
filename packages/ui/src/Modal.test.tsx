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

  it("keeps the dialog open when the caller takes Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal
        open
        onClose={onClose}
        label="Settings"
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <p>body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("gives focus to the first control, not to the page behind it", () => {
    render(
      <Modal open onClose={() => {}} label="Settings">
        <button type="button">First</button>
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("renders a caller-composed header, description and footer", () => {
    render(
      <Modal
        open
        onClose={() => {}}
        label="Import"
        header={<h2>Import transactions</h2>}
        description="Nothing is written until the review."
        footer={<button type="button">Import</button>}
      >
        <p>Step one</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Import" });
    expect(dialog).toHaveAccessibleDescription("Nothing is written until the review.");
    expect(screen.getByRole("heading", { name: "Import transactions" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByText("Step one")).toBeInTheDocument();
  });

  it("does not add a close control of its own", () => {
    render(
      <Modal open onClose={() => {}} label="Settings" footer={<p>actions</p>}>
        <p>body</p>
      </Modal>,
    );
    expect(screen.queryByRole("button", { name: /close/u })).toBeNull();
  });

  it("closes on Escape while framed", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} label="Settings" header={<h2>Settings</h2>}>
        <p>body</p>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
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
