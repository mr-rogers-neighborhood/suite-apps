import type { Meta, StoryObj } from "@storybook/react-vite";

import "../../../../../packs/help/pack/src/renderer/styles.css";
import { Note } from "../../../../../packs/help/pack/src/renderer/explorer/note";

/**
 * A real Help surface in the workbench theme matrix.
 *
 * A handbook note is Markdown rendered by the same component the handbook reads. It exercises
 * the Help aliases (`fd-*`) and the shared tokens without mounting the router or the explorer.
 */
const note = `## Keep the file

Suite stores this plan in a file you choose. It is not uploaded to an account, and the app does
not need a connection to open it.

- **Local first.** The file is the source of truth.
- **Share on purpose.** A relay only carries sealed frames between devices you invite.
- **Export any time.** A portable copy stays readable without Suite.

\`Suite\` keeps the whole workspace in one file.`;

const meta = {
  title: "Packs/Help/Handbook note",
  component: Note,
  tags: ["pack:help", "layer:surface", "status:experimental"],
  args: { children: note },
  decorators: [
    (Story) => (
      <div className="w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Note>;

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
