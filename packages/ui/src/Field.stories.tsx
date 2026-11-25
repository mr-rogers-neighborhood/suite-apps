import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { Field } from "./Field.js";

const meta = {
  title: "Components/Field",
  component: Field,
  args: {
    label: "Amount",
    placeholder: "0.00",
  },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithHint: Story = {
  args: { hint: "In your own currency." },
};

export const WithError: Story = {
  args: {
    defaultValue: "not a number",
    error: "Enter an amount, not words.",
  },
};

export const WithTrailing: Story = {
  args: {
    label: "Search",
    trailing: <span className="text-[var(--ink-muted)]">⌘K</span>,
  },
};

export const WithSelect: Story = {
  args: {
    label: "Account",
    hint: "Only open accounts can receive a transaction.",
    children: (
      <select className="h-[var(--control-height,2.25rem)] w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-[var(--control-padding-x,0.75rem)] text-[length:var(--text-body,13px)] text-[var(--ink)]">
        <option>Checking</option>
        <option>Savings</option>
      </select>
    ),
  },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Locked" },
};

export const WithAction: Story = {
  args: {
    label: "Budget name",
    hint: "Shown in the launcher and the window title.",
    trailing: (
      <Button variant="secondary" size="sm">
        Rename
      </Button>
    ),
  },
};
