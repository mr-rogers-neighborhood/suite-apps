import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppMark } from "../AppMark.js";
import { IconButton } from "../IconButton.js";
import { SyncPill } from "../menu/SyncPill.js";
import { HostTabBar, type HostTab } from "./HostTabBar.js";

const suiteMark = <AppMark viewBox="0 0 24 24" paths={["M12 2 22 12 12 22 2 12z"]} label="Suite" />;

const tabs: HostTab[] = [
  {
    id: "canvas",
    title: "Canvas",
    kind: "pack",
    icon: <AppMark viewBox="0 0 24 24" paths={["M4 4h7v7H4zM13 13h7v7h-7z"]} />,
  },
  {
    id: "planner",
    title: "Planner",
    kind: "pack",
    icon: <AppMark viewBox="0 0 24 24" paths={["M5 4h14v3H5zM5 10h9v2H5zM5 15h11v2H5z"]} />,
  },
  {
    id: "budget",
    title: "Budget",
    kind: "pack",
    icon: <AppMark viewBox="0 0 24 24" paths={["M4 6h16v12H4zM7 10h4v4H7z"]} />,
  },
  {
    id: "home",
    title: "Home",
    kind: "screen",
    icon: <AppMark viewBox="0 0 24 24" paths={["M4 11 12 4l8 7v9h-6v-6h-4v6H4z"]} />,
  },
];

const meta = {
  title: "Components/HostTabBar",
  component: HostTabBar,
  args: {
    tabs,
    activeTabId: "canvas",
    mark: suiteMark,
    onHome: () => {},
    onActivate: () => {},
    onClose: () => {},
    onNewTab: () => {},
    onOpenSearch: () => {},
    searchPlaceholder: "Search apps, screens and commands",
    sync: <SyncPill situation="local" label="Local only" />,
    controls: (
      <IconButton label="Settings">
        <span aria-hidden="true">{"\u2699"}</span>
      </IconButton>
    ),
  },
} satisfies Meta<typeof HostTabBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FirstRun: Story = {
  args: { tabs: [], activeTabId: null },
};

export const ManyTabs: Story = {
  args: {
    tabs: [
      ...tabs,
      { id: "help", title: "Help", kind: "pack" },
      { id: "planning-week", title: "Week 48", kind: "screen" },
      { id: "settings", title: "Settings", kind: "settings" },
      { id: "canvas-2", title: "Canvas — Marketing site", kind: "pack" },
    ],
    activeTabId: "settings",
  },
};

export const Unavailable: Story = {
  args: {
    tabs: [
      ...tabs,
      { id: "retired", title: "Retired app", kind: "pack", unavailable: true },
    ],
    activeTabId: "retired",
  },
};
