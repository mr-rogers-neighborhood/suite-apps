import type { Meta, StoryObj } from "@storybook/react-vite";
import { SyncPill } from "./SyncPill.js";

const meta = {
  title: "Components/SyncPill",
  component: SyncPill,
  args: {
    situation: "synced",
    label: "Saved",
    peerCount: 2,
  },
} satisfies Meta<typeof SyncPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Synced: Story = {};

export const Syncing: Story = {
  args: { situation: "syncing", label: "Syncing" },
};

export const Offline: Story = {
  args: { situation: "offline", label: "Offline" },
};

export const Conflict: Story = {
  args: { situation: "conflict", label: "Conflict" },
};
