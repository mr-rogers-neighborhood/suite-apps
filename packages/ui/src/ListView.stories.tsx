import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState.js";
import { ListView } from "./ListView.js";

const meta = {
  title: "Components/ListView",
  component: ListView,
  args: {
    label: "Accounts",
    className: "max-w-sm",
    selectedId: "checking",
    onSelect: () => {},
    onActivate: () => {},
    items: [
      { id: "checking", content: "Everyday checking" },
      { id: "savings", content: "Rainy-day savings" },
      { id: "card", content: "Travel card" },
    ],
  },
} satisfies Meta<typeof ListView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NothingSelected: Story = {
  args: { selectedId: null },
};

export const WithSections: Story = {
  args: {
    selectedId: "groceries",
    sections: [
      {
        id: "this-month",
        title: "This month",
        items: [
          { id: "groceries", content: "Groceries" },
          { id: "transport", content: "Transport" },
        ],
      },
      {
        id: "last-month",
        title: "Last month",
        items: [{ id: "rent", content: "Rent" }],
      },
    ],
  },
};

export const WithDisabledRow: Story = {
  args: {
    items: [
      { id: "checking", content: "Everyday checking" },
      { id: "savings", content: "Rainy-day savings" },
      { id: "archived", content: "Archived account", disabled: true },
    ],
  },
};

export const Empty: Story = {
  args: {
    items: [],
    selectedId: null,
  },
};

export const CustomEmpty: Story = {
  args: {
    items: [],
    selectedId: null,
    empty: (
      <EmptyState title="No accounts yet">
        Add an account to start tracking where the money goes.
      </EmptyState>
    ),
  },
};
