import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { Modal } from "./Modal.js";

const meta = {
  title: "Components/Modal",
  component: Modal,
  args: {
    open: true,
    onClose: () => {},
    label: "Move money",
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: {
    children: (
      <div className="flex flex-col gap-3">
        <h2 className="text-[length:var(--text-title,15px)] font-semibold tracking-tight">
          Move money
        </h2>
        <p className="text-[length:var(--text-label,12px)] text-[var(--ink-muted)]">
          From one envelope to another.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-md px-3 py-1.5 text-[var(--ink-muted)]">
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[var(--on-accent)]"
          >
            Move
          </button>
        </div>
      </div>
    ),
  },
};

export const Framed: Story = {
  args: {
    size: "xl",
    label: "Import transactions",
    header: (
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-[length:var(--text-title,15px)] font-semibold tracking-tight">
          Import transactions
        </h2>
        <Button variant="ghost" size="sm">
          Close
        </Button>
      </div>
    ),
    description: "CSV and QIF are read into the open budget. Nothing is written until the review.",
    footer: (
      <div className="flex justify-end gap-2">
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Import</Button>
      </div>
    ),
    children: (
      <div className="flex flex-col gap-3">
        <p className="text-[length:var(--text-label,12px)] text-[var(--ink-muted)]">
          The body scrolls between the fixed header and footer, so the actions never leave the
          screen.
        </p>
        {Array.from({ length: 12 }, (_, index) => (
          <p key={index} className="text-[length:var(--text-body,13px)]">
            Row {index + 1}
          </p>
        ))}
      </div>
    ),
  },
};

export const Small: Story = {
  args: { size: "sm", children: <p>Small enough for a confirmation.</p> },
};

export const Closed: Story = {
  args: { open: false, children: <p>Nothing renders while closed.</p> },
};
