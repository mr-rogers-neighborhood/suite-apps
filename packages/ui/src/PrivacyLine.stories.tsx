import type { Meta, StoryObj } from "@storybook/react-vite";
import { PrivacyLine } from "./PrivacyLine.js";

const meta = {
  title: "Components/PrivacyLine",
  component: PrivacyLine,
  args: {},
} satisfies Meta<typeof PrivacyLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLocation: Story = {
  args: { where: "~/Documents/Household.budget" },
};
