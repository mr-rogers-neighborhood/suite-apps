import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextInput } from "./TextInput.js";

const meta = {
  title: "Components/TextInput",
  component: TextInput,
  args: {
    "aria-label": "Amount",
    placeholder: "0.00",
  },
} satisfies Meta<typeof TextInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Invalid: Story = {
  args: { invalid: true, defaultValue: "not a number" },
};

export const Disabled: Story = {
  args: { disabled: true, defaultValue: "Locked" },
};
