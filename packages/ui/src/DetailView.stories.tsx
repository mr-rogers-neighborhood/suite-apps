import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";
import { DetailView } from "./DetailView.js";

const meta = {
  title: "Components/DetailView",
  component: DetailView,
  args: {
    title: "Everyday checking",
    className:
      "h-[28rem] overflow-hidden rounded-xl border border-[var(--hairline)] shadow-[var(--shadow-xl)]",
    children: (
      <div className="flex max-w-[60ch] flex-col gap-3 text-[length:var(--text-body,13px)]">
        <p>
          The body is the only scrolling region. The header stays put above it and the footer, when
          there is one, stays put below it.
        </p>
        <p>A detail pane is content, not chrome: the pack decides what belongs in it.</p>
      </div>
    ),
  },
} satisfies Meta<typeof DetailView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSubtitle: Story = {
  args: {
    subtitle: "Bank account · updated today",
  },
};

export const WithActions: Story = {
  args: {
    subtitle: "Bank account · updated today",
    actions: (
      <>
        <Button size="sm">Edit</Button>
        <Button variant="ghost" size="sm">
          Archive
        </Button>
      </>
    ),
  },
};

export const WithFooter: Story = {
  args: {
    subtitle: "Bank account · updated today",
    footer: (
      <div className="flex justify-end gap-2">
        <Button size="sm">Cancel</Button>
        <Button variant="primary" size="sm">
          Save
        </Button>
      </div>
    ),
  },
};
