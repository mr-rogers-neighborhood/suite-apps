import type { Meta, StoryObj } from "@storybook/react-vite";
import type { MonthState } from "@suite/budget-core";

import "../theme/styles.css";
import { MonthHeader } from "../plan/MonthHeader";

/**
 * A real Budget surface in the workbench theme matrix.
 *
 * The plan header is where a person lands each month: the month, what is ready to assign,
 * and the actions that shape the plan. It reads the pack's aliases and the host's tokens.
 */
const state: MonthState = {
  month: "2026-11",
  firstMonth: "2026-01",
  readyToAssignMinor: 128_400,
  onBudgetBalanceMinor: 412_000,
  assignedMinor: 386_000,
  activityMinor: -74_200,
  availableMinor: 412_000,
  overspentMinor: 0,
  uncategorized: { count: 0, amountMinor: 0 },
  groups: [],
  targetCount: 4,
  fundedTargetCount: 3,
};

const meta = {
  title: "Packs/Budget/Month header",
  component: MonthHeader,
  tags: ["pack:budget", "layer:surface", "status:experimental"],
  args: {
    state,
    currency: "USD",
    scale: 2,
    onPrevious: () => {},
    onNext: () => {},
    onToday: () => {},
    onAutoAssign: () => {},
    onMoveMoney: () => {},
    onAddGroup: () => {},
  },
} satisfies Meta<typeof MonthHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// The matrix uses Storybook's globals, not a per-cell wrapper: a host paints the tokens on
// `:root`, and a pack's `@theme` aliases are computed there. An override below the root does
// not reach them.
export const SuiteLight: Story = { globals: { theme: "suite", mode: "light" } };
export const SuiteDark: Story = { globals: { theme: "suite", mode: "dark" } };
export const SolarizedLight: Story = { globals: { theme: "solarized", mode: "light" } };
export const SolarizedDark: Story = { globals: { theme: "solarized", mode: "dark" } };
export const WarmLight: Story = { globals: { theme: "warm", mode: "light" } };
export const WarmDark: Story = { globals: { theme: "warm", mode: "dark" } };

export const Compact: Story = {
  globals: { theme: "suite", mode: "light", density: "compact" },
};
export const Cozy: Story = { globals: { theme: "suite", mode: "light", density: "cozy" } };
export const Comfortable: Story = {
  globals: { theme: "suite", mode: "light", density: "comfortable" },
};
