import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { EmptyState } from "./EmptyState.js";

const meta = {
  title: "Components/EmptyState",
  component: EmptyState,
  args: {
    title: "No budgets yet",
    children: "Create a budget to begin.",
  },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithAction: Story = {
  args: {
    action: <Button variant="primary">New budget</Button>,
  },
};

export const TitleOnly: Story = {
  args: { children: undefined },
};
