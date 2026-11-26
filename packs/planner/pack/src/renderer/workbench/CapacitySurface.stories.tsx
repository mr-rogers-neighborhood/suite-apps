import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Capacity } from "@suite/planner-core";

import "../theme/styles.css";
import { CapacityMeter } from "../day/CapacityMeter";

/**
 * A real Planner surface in the workbench theme matrix.
 *
 * The capacity meter is the day view's smallest complete surface: it reads the pack's own
 * Tailwind aliases and the host's tokens. The matrix renders it under every preset and mode.
 */
const comfortable: Capacity = {
  plannedMinutes: 120,
  availableMinutes: 300,
  remainingMinutes: 180,
  ratio: 0.4,
  state: "comfortable",
};

const meta = {
  title: "Packs/Planner/Capacity",
  component: CapacityMeter,
  tags: ["pack:planner", "layer:surface", "status:experimental"],
  args: { capacity: comfortable },
  parameters: { mockingDate: new Date(2026, 10, 26) },
} satisfies Meta<typeof CapacityMeter>;

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
