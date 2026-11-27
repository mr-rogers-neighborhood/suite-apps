import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { AppMark } from "../AppMark.js";
import { IconButton } from "../IconButton.js";
import { SyncPill } from "../menu/SyncPill.js";
import { HostTabBar, type HostTab } from "./HostTabBar.js";
import { packMenuZones } from "./PackMenuSlots.js";

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

/**
 * The pack row the host draws under its own, from the same descriptors a pack publishes.
 * It is a real `packMenuZones` result rather than hand-written JSX, so the story fails if
 * the host and the contract ever drift.
 */
const canvasPack = packMenuZones(
  {
    format: "suite.menu-slots",
    title: "Q3 board",
    navigation: [
      {
        kind: "menu",
        id: "canvas.boards",
        label: "Q3 board",
        items: [
          { id: "canvas.board.q3", label: "Q3 board", checked: true },
          { id: "canvas.board.roadmap", label: "Roadmap" },
          { id: "canvas.board.new", label: "New board", separatorBefore: true },
        ],
      },
      {
        kind: "tabs",
        id: "canvas.board",
        label: "Open boards",
        items: [
          { id: "canvas.board.q3", label: "Q3 board", active: true },
          { id: "canvas.board.roadmap", label: "Roadmap", active: false },
        ],
      },
      {
        kind: "buttons",
        id: "canvas.history",
        items: [
          { id: "canvas.undo", label: "Undo", glyph: "\u21b6" },
          { id: "canvas.redo", label: "Redo", glyph: "\u21b7", disabled: true },
          { id: "canvas.history", label: "Version history", glyph: "\u25f4" },
          { id: "canvas.outline", label: "Board outline", glyph: "\u2630" },
        ],
      },
    ],
    actions: [
      {
        id: "canvas.explain",
        label: "Explain mode",
        glyph: "\u25c8",
        pressed: false,
        help: {
          title: "Explain mode",
          body: "Gathers what you have selected into a context you can talk about.",
        },
      },
    ],
  },
  () => {},
);

const meta = {
  title: "Components/HostTabBar",
  component: HostTabBar,
  tags: ["pack:suite", "layer:host", "status:experimental"],
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

/** A document costs two thin rows: the host's, then the active pack's own material. */
export const TwoRows: Story = {
  args: { pack: canvasPack, packKey: "canvas" },
};

/** Home published nothing, so the pack row is absent and the chrome is one row. */
export const HomeIsOneRow: Story = {
  args: { activeTabId: "home" },
};

export const ManyTabs: Story = {
  args: {
    tabs: [
      ...tabs,
      ...Array.from({ length: 16 }, (_, index) => ({
        id: `screen-${index}`,
        title: `Planning week ${index + 1}`,
        kind: "screen" as const,
      })),
    ],
    activeTabId: "screen-15",
  },
};

/** The switch list is the strip's overflow surface, opened on intent. */
export const SwitchListOpen: Story = {
  args: {
    tabs: [...tabs, { id: "help", title: "Help", kind: "pack" }],
  },
  play: async () => {
    await userEvent.click(screen.getByRole("button", { name: "All tabs" }));
    const menu = await screen.findByRole("menu", { name: "All tabs" });
    await expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(5);
    await expect(within(menu).getByRole("menuitemradio", { name: /^Canvas/u })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  },
};

/** Both rows together, with the pack's dropdown open in the second. */
export const TwoRowsWithMenu: Story = {
  args: { pack: canvasPack, packKey: "canvas" },
  play: async () => {
    await userEvent.click(screen.getByRole("button", { name: "Q3 board" }));
    const menu = await screen.findByRole("menu", { name: "Q3 board" });
    await expect(within(menu).getByRole("menuitemradio", { name: /Q3 board/u })).toHaveAttribute(
      "aria-checked",
      "true",
    );
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
