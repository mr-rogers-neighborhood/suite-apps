import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppMark } from "../AppMark.js";
import { NewTabPicker } from "./NewTabPicker.js";

const meta = {
  title: "Components/NewTabPicker",
  component: NewTabPicker,
  tags: ["pack:suite", "layer:host", "status:experimental"],
  args: {
    open: true,
    packs: [
      {
        id: "canvas",
        name: "Canvas",
        description: "Boards, cards and the book reader",
        icon: <AppMark viewBox="0 0 24 24" paths={["M4 4h7v7H4zM13 13h7v7h-7z"]} />,
      },
      {
        id: "planner",
        name: "Planner",
        description: "Plans, tasks and reminders",
        icon: <AppMark viewBox="0 0 24 24" paths={["M5 4h14v3H5zM5 10h9v2H5zM5 15h11v2H5z"]} />,
      },
      {
        id: "budget",
        name: "Budget",
        description: "Envelopes, accounts and reports",
        icon: <AppMark viewBox="0 0 24 24" paths={["M4 6h16v12H4zM7 10h4v4H7z"]} />,
      },
    ],
    screens: [
      { id: "home", name: "Home", description: "Your starting screen" },
      { id: "week", name: "Week 48", description: "Plan, tasks and budget" },
    ],
    onClose: () => {},
    onOpenPack: () => {},
    onOpenScreen: () => {},
    onNewScreen: () => {},
    onOpenSettings: () => {},
  },
} satisfies Meta<typeof NewTabPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FirstRun: Story = {
  args: { packs: [], screens: [] },
};

export const NoMatches: Story = {
  args: { initialQuery: "zzzz" },
};

export const UnavailablePack: Story = {
  args: {
    packs: [
      ...meta.args.packs,
      { id: "old", name: "Retired app", description: "Kept, but this build cannot draw it", unavailable: true },
    ],
  },
};
