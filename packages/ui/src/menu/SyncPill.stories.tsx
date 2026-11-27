import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { SyncPill } from "./SyncPill.js";

const meta = {
  title: "Components/SyncPill",
  component: SyncPill,
  tags: ["pack:suite", "layer:primitive", "status:ready"],
  args: {
    situation: "synced",
    label: "Saved",
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

export const PeerCount: Story = {
  args: {
    situation: "synced",
    label: "Saved",
    peerCount: 3,
  },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole("button");
    await expect(pill).toHaveTextContent(/Saved\s*·\s*3/);
    await userEvent.click(pill);
  },
};

export const LongLabel: Story = {
  args: {
    situation: "syncing",
    label: "Syncing changes to 4 peers on relay",
    peerCount: 4,
  },
  play: async ({ canvasElement }) => {
    const pill = within(canvasElement).getByRole("button");
    await expect(pill).toHaveTextContent(/Syncing changes to 4 peers on relay\s*·\s*4/);
  },
};
