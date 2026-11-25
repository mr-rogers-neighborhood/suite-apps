import type { Meta, StoryObj } from "@storybook/react-vite";
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

export const Small: Story = {
  args: { size: "sm", children: <p>Small enough for a confirmation.</p> },
};

export const Closed: Story = {
  args: { open: false, children: <p>Nothing renders while closed.</p> },
};
