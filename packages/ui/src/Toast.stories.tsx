import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toast } from "./Toast.js";

const meta = {
  title: "Components/Toast",
  component: Toast,
  args: {
    notice: { message: "Budget saved." },
    onDismiss: () => {},
    duration: 0,
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {};

export const Error: Story = {
  args: {
    notice: { message: "Could not save the budget.", tone: "error" },
  },
};
