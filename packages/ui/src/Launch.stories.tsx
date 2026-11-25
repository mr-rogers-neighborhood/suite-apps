import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppMark } from "./AppMark.js";
import { Button } from "./Button.js";
import { Launch } from "./Launch.js";

const meta = {
  title: "Components/Launch",
  component: Launch,
  args: {
    mark: <AppMark viewBox="0 0 24 24" paths={["M4 4h16v16H4z"]} />,
    title: "Suite Budget",
    tagline: "Envelope budgeting that stays on your disk.",
    hint: "Open a budget file, pick up a recent one, or start a new one.",
    actions: (
      <>
        <Button variant="primary">New budget</Button>
        <Button>Open budget file…</Button>
      </>
    ),
    recents: [
      { id: "home", name: "Home", detail: "Budget · opened yesterday" },
      { id: "studio", name: "Studio", detail: "Budget · opened last week" },
    ],
  },
} satisfies Meta<typeof Launch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: {
    recents: [],
    recentEmpty: <p className="text-[var(--ink-muted)]">Nothing opened yet.</p>,
  },
};

export const WithNotice: Story = {
  args: {
    notice: <p className="text-[var(--ink-muted)]">Suite is alpha software.</p>,
  },
};
