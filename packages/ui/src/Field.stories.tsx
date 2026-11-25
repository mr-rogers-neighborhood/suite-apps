import type { Meta, StoryObj } from "@storybook/react-vite";
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

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Locked" },
};
