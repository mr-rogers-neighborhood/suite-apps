import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton.js";

const meta = {
  title: "Components/IconButton",
  component: IconButton,
  args: {
    label: "More actions",
    children: <span aria-hidden="true">⋯</span>,
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Quiet: Story = {};

export const Plain: Story = {
  args: { variant: "plain" },
};

export const Medium: Story = {
  args: { size: "md" },
};

export const Disabled: Story = {
  args: { disabled: true },
};
