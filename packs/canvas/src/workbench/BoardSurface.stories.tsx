import type { Meta, StoryObj } from "@storybook/react-vite";

import "../styles/global.css";
import { BoardMiniature } from "../canvas/BoardMiniature";
import type { BoardMiniatureModel } from "../canvas/portalMiniature";

/**
 * A real Canvas surface in the workbench theme matrix.
 *
 * A board miniature is the same SVG the portal card and the camera overlay draw. It carries
 * the section colours and the card structure without mounting a canvas or reading a store.
 */
const model: BoardMiniatureModel = {
  viewBox: { width: 100, height: 64 },
  sections: [
    { sectionId: "s1", x: 4, y: 6, width: 44, height: 52, color: "blue" },
    { sectionId: "s2", x: 52, y: 6, width: 44, height: 52, color: "green" },
  ],
  cards: [
    { cardId: "c1", x: 8, y: 12, width: 14, height: 11 },
    { cardId: "c2", x: 26, y: 14, width: 18, height: 13 },
    { cardId: "c3", x: 9, y: 30, width: 34, height: 10 },
    { cardId: "c4", x: 56, y: 12, width: 26, height: 16 },
    { cardId: "c5", x: 58, y: 34, width: 18, height: 14 },
  ],
  links: [{ edgeId: "e1", x1: 22, y1: 17, x2: 58, y2: 20 }],
  cardCount: 5,
  empty: false,
};

const meta = {
  title: "Packs/Canvas/Board miniature",
  component: BoardMiniature,
  tags: ["pack:canvas", "layer:surface", "status:experimental"],
  args: { model, label: "Research board miniature" },
  decorators: [
    (Story) => (
      <div className="w-[420px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BoardMiniature>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// Storybook's globals are the matrix: the preview paints the tokens on `:root`, which is what
// the host does and what a pack's `@theme` aliases resolve against.
export const SuiteLight: Story = { globals: { theme: "suite", mode: "light" } };
export const SuiteDark: Story = { globals: { theme: "suite", mode: "dark" } };
export const CatppuccinLight: Story = { globals: { theme: "catppuccin", mode: "light" } };
export const CatppuccinDark: Story = { globals: { theme: "catppuccin", mode: "dark" } };
export const SolarizedLight: Story = { globals: { theme: "solarized", mode: "light" } };
export const SolarizedDark: Story = { globals: { theme: "solarized", mode: "dark" } };
export const WarmLight: Story = { globals: { theme: "warm", mode: "light" } };
export const WarmDark: Story = { globals: { theme: "warm", mode: "dark" } };

// Density is the second axis: the surface reads the same tokens, with more or less room.
export const Compact: Story = { globals: { density: "compact" } };
export const Cozy: Story = { globals: { density: "cozy" } };
export const Comfortable: Story = { globals: { density: "comfortable" } };
