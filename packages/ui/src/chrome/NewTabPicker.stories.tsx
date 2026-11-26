import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { AppMark } from "../AppMark.js";
import { NewTabPicker, type NewTabPack, type NewTabScreen } from "./NewTabPicker.js";

const canvas = (
  <AppMark viewBox="0 0 24 24" paths={["M4 4h7v7H4zM13 13h7v7h-7z"]} />
);
const planner = (
  <AppMark viewBox="0 0 24 24" paths={["M5 4h14v3H5zM5 10h9v2H5zM5 15h11v2H5z"]} />
);
const budget = <AppMark viewBox="0 0 24 24" paths={["M4 6h16v12H4zM7 10h4v4H7z"]} />;

const packs: NewTabPack[] = [
  {
    id: "canvas",
    name: "Canvas",
    description: "Boards, cards and the book reader",
    icon: canvas,
    noun: { singular: "Canvas", plural: "Canvases" },
    documents: [
      { id: "q3", name: "Q3 board", openedAt: 1_795_600_000_000 },
      { id: "reading", name: "Reading list", openedAt: 1_795_500_000_000 },
      { id: "empty", name: "An empty canvas" },
    ],
  },
  {
    id: "planner",
    name: "Planner",
    description: "Plans, tasks and reminders",
    icon: planner,
    noun: { singular: "Planner", plural: "Planners" },
    documents: [{ id: "week", name: "Week 48", openedAt: 1_795_400_000_000 }],
  },
  {
    id: "budget",
    name: "Budget",
    description: "Envelopes, accounts and reports",
    icon: budget,
    noun: { singular: "Budget", plural: "Budgets" },
    documents: [{ id: "home", name: "Household budget" }],
  },
  {
    id: "help",
    name: "Help",
    description: "The handbook, on this machine",
  },
];

const screens: NewTabScreen[] = [
  { id: "home", name: "Home", description: "Your starting screen" },
  { id: "week-48", name: "Week 48", description: "Plan, tasks and budget" },
];

const meta = {
  title: "Components/NewTabPicker",
  component: NewTabPicker,
  tags: ["pack:suite", "layer:host", "status:experimental"],
  args: {
    open: true,
    packs,
    screens,
    onClose: () => {},
    onOpenPack: () => {},
    onOpenDocument: () => {},
    onNewDocument: () => {},
    onOpenScreen: () => {},
    onNewScreen: () => {},
    onOpenSettings: () => {},
    onOpenFile: () => {},
  },
} satisfies Meta<typeof NewTabPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Recents first, then packs with a document count, Screens and the host's own actions. */
export const Default: Story = {};

/** A pack that declares documents opens its own level; the search filters what is inside it. */
export const SecondLevel: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    const list = within(dialog);
    await userEvent.click(list.getByRole("option", { name: /^Canvas/u }));
    await expect(list.getByRole("group", { name: "Recent Canvases" })).toBeInTheDocument();
    await expect(list.getByRole("option", { name: "New Canvas" })).toBeInTheDocument();
    await userEvent.click(list.getByRole("option", { name: "An empty canvas" }));
  },
};

/** A recent document is one click from the root, and says which pack it belongs to. */
export const RecentDocument: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    const options = within(within(dialog).getByRole("group", { name: "Recents" })).getAllByRole(
      "option",
    );
    await expect(options[0]).toHaveTextContent("Q3 board");
    await expect(options[0]).toHaveTextContent("Canvas");
  },
};

/** A pack that declares no documents opens directly and never shows a second level. */
export const PackWithoutDocuments: Story = {};

/** A pack that declares documents but holds none yet still opens its level, so New is reachable. */
export const EmptyPack: Story = {
  args: {
    packs: [
      {
        id: "fresh",
        name: "Fresh",
        description: "Installed, nothing in it yet",
        noun: { singular: "Canvas", plural: "Canvases" },
        documents: [],
      },
    ],
  },
};

export const FirstRun: Story = {
  args: { packs: [], screens: [] },
};

export const NoMatches: Story = {
  args: { initialQuery: "zzzz" },
};

export const UnavailablePack: Story = {
  args: {
    packs: [
      ...packs,
      {
        id: "old",
        name: "Retired app",
        description: "Kept, but this build cannot draw it",
        unavailable: true,
        documents: [{ id: "one", name: "One" }],
      },
    ],
  },
};
