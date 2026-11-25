import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppMark } from "./AppMark.js";

const meta = {
  title: "Components/AppMark",
  component: AppMark,
  args: {
    viewBox: "0 0 24 24",
    paths: ["M4 4h16v16H4z", "M8 8h8v8H8z"],
  },
} satisfies Meta<typeof AppMark>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Medium: Story = {};

export const Small: Story = {
  args: { size: "sm" },
};

export const Large: Story = {
  args: { size: "lg" },
};

export const Named: Story = {
  args: { label: "Suite Planner" },
};
