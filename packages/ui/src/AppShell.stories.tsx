import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppShell } from "./AppShell.js";
import { Button } from "./Button.js";
import { IconButton } from "./IconButton.js";

const meta = {
  title: "Components/AppShell",
  component: AppShell,
  args: {
    title: "Household",
    className:
      "min-h-[28rem] overflow-hidden rounded-xl border border-[var(--hairline)] shadow-[var(--shadow-xl)]",
    children: (
      <div className="p-5">
        <p className="max-w-[60ch] text-[length:var(--text-body,13px)]">
          The pack draws this region. The shell owns the frame above it and nothing else.
        </p>
      </div>
    ),
  },
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

const NAVIGATION = (
  <div className="flex flex-col gap-1">
    <Button variant="ghost" size="sm" className="w-full">
      Accounts
    </Button>
    <Button variant="ghost" size="sm" className="w-full">
      Categories
    </Button>
    <Button variant="ghost" size="sm" className="w-full">
      Reports
    </Button>
  </div>
);

export const Default: Story = {};

export const WithLeadingAction: Story = {
  args: {
    leading: (
      <IconButton label="Back">
        <span aria-hidden="true">←</span>
      </IconButton>
    ),
  },
};

export const WithActions: Story = {
  args: {
    actions: (
      <>
        <Button size="sm">Import</Button>
        <Button variant="primary" size="sm">
          New account
        </Button>
      </>
    ),
  },
};

export const WithNavigation: Story = {
  args: { navigation: NAVIGATION },
};

export const WithCallerBar: Story = {
  args: {
    // A pack whose cross-app `MenuBar` is its top bar passes it here instead of a title header.
    title: undefined,
    header: (
      <header className="flex h-11 shrink-0 items-center border-b border-[var(--hairline)] bg-[var(--surface)] px-4 text-[length:var(--text-body,13px)]">
        Suite Planner
      </header>
    ),
  },
};

export const Complete: Story = {
  args: {
    leading: (
      <IconButton label="Back">
        <span aria-hidden="true">←</span>
      </IconButton>
    ),
    actions: <Button variant="primary" size="sm">New account</Button>,
    navigation: NAVIGATION,
  },
};
