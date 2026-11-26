import type { Meta, StoryObj } from "@storybook/react-vite";
import { PackCard } from "./PackCard.js";

const icon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='3' width='8' height='8' rx='1.5' fill='%237c9eff'/%3E%3Crect x='13' y='13' width='8' height='8' rx='1.5' fill='%237c9eff'/%3E%3C/svg%3E";

const meta = {
  title: "Components/Pack card",
  component: PackCard,
  tags: ["pack:suite", "layer:host", "status:experimental"],
  args: {
    name: "Canvas",
    description: "Boards, cards and the book reader",
    status: "installed",
    onSelect: () => {},
  },
  parameters: { layout: "centered" },
} satisfies Meta<typeof PackCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Installed: Story = { args: { icon, version: "0.4.3" } };

export const UpdateAvailable: Story = {
  args: {
    name: "Planner",
    description: "Plans, tasks and reminders",
    status: "update",
    icon,
    version: "0.4.2",
  },
};

export const Available: Story = {
  args: {
    name: "Budget",
    description: "Envelopes, accounts and reports",
    status: "available",
    icon,
    version: "0.4.4",
  },
};

export const Unavailable: Story = {
  args: {
    name: "Help",
    description: "The handbook, on this machine",
    status: "unavailable",
  },
};

export const Selected: Story = {
  args: { selected: true, icon, version: "0.4.3" },
};

export const NoIcon: Story = {
  args: { name: "Notes", description: "A pack with no artwork yet" },
};
