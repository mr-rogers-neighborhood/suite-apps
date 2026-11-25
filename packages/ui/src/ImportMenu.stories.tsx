import type { Meta, StoryObj } from "@storybook/react-vite";
import { ImportMenu } from "./ImportMenu.js";

const meta = {
  title: "Components/ImportMenu",
  component: ImportMenu,
  args: {
    options: [
      { label: "Bank export", detail: "A CSV from your bank", onSelect: () => {} },
      { label: "Another budget", detail: "A .budget file", onSelect: () => {} },
    ],
  },
} satisfies Meta<typeof ImportMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Disclosure: Story = {};

export const SinglePath: Story = {
  args: {
    options: [{ label: "Bank export", onSelect: () => {} }],
  },
};

export const Disabled: Story = {
  args: { disabled: true },
};
