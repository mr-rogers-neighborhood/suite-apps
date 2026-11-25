import type { Meta, StoryObj } from "@storybook/react-vite";
import { AppMark } from "../AppMark.js";
import { Button } from "../Button.js";
import { IconButton } from "../IconButton.js";
import { MenuBar } from "./MenuBar.js";
import { SyncPill } from "./SyncPill.js";

const meta = {
  title: "Components/MenuBar",
  component: MenuBar,
  args: {
    mark: <AppMark viewBox="0 0 24 24" paths={["M4 4h16v16H4z"]} label="Suite Budget" />,
    title: "Household",
    subtitle: "Budget",
    onOpenSearch: () => {},
    sync: <SyncPill situation="synced" label="Saved" />,
    actions: <Button size="sm">Add transaction</Button>,
    controls: (
      <IconButton label="Settings">
        <span aria-hidden="true">⚙</span>
      </IconButton>
    ),
  },
} satisfies Meta<typeof MenuBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithNavigation: Story = {
  args: {
    navigation: (
      <nav aria-label="Views" className="flex items-center gap-1">
        <Button size="sm" variant="ghost">
          Plan
        </Button>
        <Button size="sm" variant="ghost">
          Reports
        </Button>
      </nav>
    ),
  },
};
