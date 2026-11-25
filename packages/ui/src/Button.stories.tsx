import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";

const meta = {
  title: "Components/Button",
  component: Button,
  args: {
    children: "Save changes",
    variant: "secondary",
    size: "md",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Secondary: Story = {};

export const Primary: Story = {
  args: { variant: "primary" },
};

export const Ghost: Story = {
  args: { variant: "ghost" },
};

export const Danger: Story = {
  args: { variant: "danger", children: "Delete budget" },
};

export const Small: Story = {
  args: { size: "sm", children: "Small" },
};

export const WithIcon: Story = {
  args: {
    variant: "primary",
    icon: <span aria-hidden="true">+</span>,
    children: "New budget",
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
