import type { Meta, StoryObj } from "@storybook/react-vite";
import { PackRail, type PackRailPack } from "./PackRail.js";

const icon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect x='3' y='3' width='8' height='8' rx='1.5' fill='%237c9eff'/%3E%3Crect x='13' y='13' width='8' height='8' rx='1.5' fill='%237c9eff'/%3E%3C/svg%3E";

const shot = (from: string, to: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 200'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='${from}'/%3E%3Cstop offset='1' stop-color='${to}'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='200' fill='url(%23g)'/%3E%3Crect x='24' y='24' width='180' height='12' rx='6' fill='white' opacity='.55'/%3E%3Crect x='24' y='52' width='270' height='90' rx='10' fill='white' opacity='.22'/%3E%3C/svg%3E`;

const installed: PackRailPack = {
  name: "Canvas",
  description: "Boards, cards and the book reader. Every board is a file on this machine.",
  icon,
  status: "Installed · 0.4.3",
  primary: { label: "Open Canvas", onSelect: () => {} },
  actions: [{ label: "Show in folder", onSelect: () => {} }],
  screenshots: [
    { src: shot("%23c6a15b", "%238a6b3a"), alt: "A board with cards arranged in columns" },
    { src: shot("%235b7fc6", "%233a558a"), alt: "The book reader showing a chapter" },
  ],
  details: [
    { label: "Version", value: "0.4.3 (ring stable)" },
    { label: "Platforms", value: "Desktop, mobile" },
    { label: "Publisher", value: "suite" },
    { label: "Key", value: "3f9c8d1e0a2b4c6d…" },
    { label: "Capabilities", value: "Documents, Files, Recents" },
    { label: "Signature", value: "Verified against the pinned key" },
  ],
};

const meta = {
  title: "Components/Pack rail",
  component: PackRail,
  tags: ["pack:suite", "layer:host", "status:experimental"],
  args: { pack: installed, onClose: () => {} },
  parameters: { layout: "fullscreen" },
  render: (args) => (
    <div className="flex h-[720px] w-full items-stretch gap-0 bg-[var(--canvas)] p-6">
      <div className="flex-1 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-6">
        <p className="text-[length:var(--text-label,12px)] text-[var(--ink-faint)]">
          The catalogue stays here; the rail is the pack's page.
        </p>
      </div>
      <div className="h-full w-[360px] shrink-0 overflow-hidden rounded-lg border border-[var(--hairline)]">
        <PackRail {...args} />
      </div>
    </div>
  ),
} satisfies Meta<typeof PackRail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An installed pack: one action, screenshots, and the technical record behind a disclosure. */
export const Installed: Story = {};

/** Not installed yet: one action, and no screenshots to promise. */
export const Available: Story = {
  args: {
    pack: {
      ...installed,
      name: "Budget",
      description: "Envelopes, accounts and reports. No bank sync, no network.",
      status: "Available · 0.4.4",
      primary: { label: "Install Budget", onSelect: () => {} },
      actions: [],
      screenshots: [],
      details: [
        { label: "Version", value: "0.4.4 (ring stable)" },
        { label: "Size", value: "1.8 MB" },
        { label: "Publisher", value: "suite" },
        { label: "Capabilities", value: "Documents, Files" },
      ],
    },
  },
};

/** A pack this build cannot draw: the reason is on the face, not buried. */
export const Unavailable: Story = {
  args: {
    pack: {
      ...installed,
      name: "Retired app",
      status: "Available · 0.1.0",
      note: "This build cannot open Retired app. Update Suite Desk or install a build that supports it.",
      primary: { label: "Install", onSelect: () => {}, disabled: true },
      screenshots: [],
    },
  },
};

/** Nothing chosen: the host does not render the rail at all. */
export const NoSelection: Story = {
  args: { pack: null },
  render: () => (
    <div className="flex h-[240px] items-center justify-center bg-[var(--canvas)] p-6">
      <p className="text-[length:var(--text-body,13px)] text-[var(--ink-muted)]">
        Nothing selected. The rail is not in the layout.
      </p>
    </div>
  ),
};
