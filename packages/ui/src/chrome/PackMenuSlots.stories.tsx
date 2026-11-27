import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import type { MenuSlotAction, MenuSlots } from "@suite/contracts";
import { packMenuZones } from "./PackMenuSlots.js";

interface PackSlotsPreviewProps {
  readonly slots: MenuSlots | null;
  readonly onChoose?: (action: MenuSlotAction) => void;
}

function PackSlotsPreview({
  slots,
  onChoose = () => {},
}: PackSlotsPreviewProps) {
  const zones = packMenuZones(slots, onChoose);
  return (
    <header
      aria-label="Pack menu slots"
      className="relative flex h-11 w-full items-center gap-3 bg-[var(--surface)] px-4 text-[length:var(--text-body,13px)] text-[var(--ink)] shadow-[inset_0_-1px_0_var(--hairline)]"
    >
      {zones.context}
      {zones.navigation}
      {zones.actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {zones.actions}
        </div>
      ) : null}
    </header>
  );
}

const meta = {
  title: "Components/Pack slots",
  component: PackSlotsPreview,
  tags: ["pack:suite", "layer:host", "status:ready"],
  args: {
    slots: null,
    onChoose: fn(),
  },
} satisfies Meta<typeof PackSlotsPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SlotMenuCommand: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "menu",
          id: "canvas.commands",
          label: "Actions",
          items: [
            { id: "cmd.new", label: "New board" },
            { id: "cmd.duplicate", label: "Duplicate board" },
            { id: "cmd.export", label: "Export board" },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu", { name: "Actions" });
    await expect(menu).toBeInTheDocument();

    const newItem = within(menu).getByRole("menuitem", { name: "New board" });
    await userEvent.click(newItem);
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "canvas.commands",
      item: "cmd.new",
    });
  },
};

export const SlotMenuCheckedChoice: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "menu",
          id: "canvas.boards",
          label: "Q3 Strategy Board",
          items: [
            { id: "board.0", label: "Q3 Strategy Board", checked: true },
            { id: "board.1", label: "Product Roadmap" },
            { id: "board.2", label: "Sprint 42" },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Q3 Strategy Board" });
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu", { name: "Q3 Strategy Board" });
    const checked = within(menu).getByRole("menuitemradio", {
      name: /Q3 Strategy Board/u,
    });
    await expect(checked).toHaveAttribute("aria-checked", "true");

    const roadmap = within(menu).getByRole("menuitem", {
      name: /Product Roadmap/u,
    });
    await userEvent.click(roadmap);
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "canvas.boards",
      item: "board.1",
    });
  },
};

export const SlotMenuDisabledRow: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "menu",
          id: "canvas.boards",
          label: "Active board",
          items: [
            { id: "board.active", label: "Active board", checked: true },
            {
              id: "board.locked",
              label: "Locked archive",
              disabled: true,
              disabledReason: "This board is read-only.",
            },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Active board" });
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu", { name: "Active board" });
    const locked = within(menu).getByRole("menuitem", {
      name: /Locked archive/u,
    });
    await expect(locked).toBeDisabled();
    await expect(locked).toHaveAttribute("title", "This board is read-only.");
    await userEvent.keyboard("{Escape}");
  },
};

export const SlotMenuSeparator: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "menu",
          id: "canvas.boards",
          label: "Boards",
          items: [
            { id: "board.0", label: "Primary workspace" },
            { id: "board.1", label: "Secondary workspace" },
            {
              id: "board.new",
              label: "New workspace",
              separatorBefore: true,
            },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Boards" });
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu", { name: "Boards" });
    await expect(within(menu).getByRole("separator")).toBeInTheDocument();

    const newBtn = within(menu).getByRole("menuitem", {
      name: "New workspace",
    });
    await userEvent.click(newBtn);
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "canvas.boards",
      item: "board.new",
    });
  },
};

export const SlotMenuOpenKeyboardFocus: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "menu",
          id: "canvas.boards",
          label: "First board",
          items: [
            { id: "board.0", label: "First board", checked: true },
            { id: "board.1", label: "Second board" },
            { id: "board.2", label: "Third board" },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "First board" });
    await userEvent.click(trigger);

    const menu = await screen.findByRole("menu", { name: "First board" });
    const first = within(menu).getByRole("menuitemradio", {
      name: /First board/u,
    });
    await expect(first).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    const second = within(menu).getByRole("menuitem", {
      name: /Second board/u,
    });
    await expect(second).toHaveFocus();

    await userEvent.keyboard("{End}");
    const third = within(menu).getByRole("menuitem", {
      name: /Third board/u,
    });
    await expect(third).toHaveFocus();

    await userEvent.keyboard("{Home}");
    await expect(first).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    await expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await expect(trigger).toHaveFocus();
  },
};

export const SlotTabsActive: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "tabs",
          id: "planner.tabs",
          label: "Views",
          items: [
            { id: "tab.today", label: "Today", active: true },
            { id: "tab.upcoming", label: "Upcoming", active: false },
            { id: "tab.calendar", label: "Calendar", active: false },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const today = canvas.getByRole("tab", { name: "Today" });
    const upcoming = canvas.getByRole("tab", { name: "Upcoming" });
    await expect(today).toHaveAttribute("aria-selected", "true");
    await expect(upcoming).toHaveAttribute("aria-selected", "false");

    await userEvent.click(upcoming);
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "planner.tabs",
      item: "tab.upcoming",
    });
  },
};

export const SlotTabsOverflow: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "tabs",
          id: "canvas.tabs",
          label: "Open boards",
          items: [
            { id: "b.1", label: "Project Brief", active: true },
            { id: "b.2", label: "Wireframes", active: false },
            { id: "b.3", label: "User Flows", active: false },
            { id: "b.4", label: "Design System Tokens", active: false },
            { id: "b.5", label: "Competitor Research", active: false },
            { id: "b.6", label: "Feedback Notes", active: false },
            { id: "b.7", label: "Release Checklist", active: false },
            { id: "b.8", label: "Architecture Overview", active: false },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const tabs = canvas.getAllByRole("tab");
    await expect(tabs).toHaveLength(8);
    const tokenTab = canvas.getByRole("tab", { name: "Design System Tokens" });
    await userEvent.click(tokenTab);
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "canvas.tabs",
      item: "b.4",
    });
  },
};

export const SlotTabsKeyboard: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "tabs",
          id: "workflow.tabs",
          label: "Workflow steps",
          items: [
            { id: "step.1", label: "Step 1", active: true },
            { id: "step.2", label: "Step 2", active: false },
            { id: "step.3", label: "Step 3", active: false },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const step1 = canvas.getByRole("tab", { name: "Step 1" });
    const step2 = canvas.getByRole("tab", { name: "Step 2" });
    const step3 = canvas.getByRole("tab", { name: "Step 3" });

    await step1.focus();
    await expect(step1).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}");
    await expect(step2).toHaveFocus();
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "workflow.tabs",
      item: "step.2",
    });

    await userEvent.keyboard("{ArrowRight}");
    await expect(step3).toHaveFocus();
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "workflow.tabs",
      item: "step.3",
    });

    // Wraps around to first tab
    await userEvent.keyboard("{ArrowRight}");
    await expect(step1).toHaveFocus();

    // Home / End keys
    await userEvent.keyboard("{End}");
    await expect(step3).toHaveFocus();

    await userEvent.keyboard("{Home}");
    await expect(step1).toHaveFocus();
  },
};

export const SlotToggleNotPressed: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "toggle",
          id: "canvas.explain",
          label: "Explain mode",
          pressed: false,
          glyph: "\u25c8",
          help: {
            title: "Explain mode",
            body: "Gathers what you have selected into a context you can talk about.",
          },
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Explain mode" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(toggle).toHaveAttribute(
      "title",
      "Gathers what you have selected into a context you can talk about.",
    );

    await userEvent.click(toggle);
    await expect(args.onChoose).toHaveBeenCalledWith({ id: "canvas.explain" });
  },
};

export const SlotTogglePressed: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "toggle",
          id: "canvas.explain",
          label: "Stop explaining",
          pressed: true,
          glyph: "\u25c8",
          title: "Stop explaining",
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Stop explaining" });
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);
    await expect(args.onChoose).toHaveBeenCalledWith({ id: "canvas.explain" });
  },
};

export const SlotButtonsUndoRedo: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "buttons",
          id: "canvas.history-controls",
          items: [
            {
              id: "canvas.undo",
              label: "Undo",
              glyph: "\u21b6",
              disabled: true,
            },
            {
              id: "canvas.redo",
              label: "Redo",
              glyph: "\u21b7",
              disabled: false,
            },
          ],
        },
      ],
      actions: [],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const undo = canvas.getByRole("button", { name: "Undo" });
    const redo = canvas.getByRole("button", { name: "Redo" });

    await expect(undo).toBeDisabled();
    await expect(redo).not.toBeDisabled();

    await userEvent.click(undo);
    await expect(args.onChoose).not.toHaveBeenCalled();

    await userEvent.click(redo);
    await expect(args.onChoose).toHaveBeenCalledWith({ id: "canvas.redo" });
  },
};

export const StatusQuiet: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [],
      actions: [],
      status: {
        id: "status.quiet",
        label: "All changes saved",
        tone: "quiet",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByText("All changes saved");
    await expect(status).toBeInTheDocument();
    await expect(status.className).toContain("text-[var(--ink-faint)]");
  },
};

export const StatusOk: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [],
      actions: [],
      status: {
        id: "status.ok",
        label: "Synced · 2 peers",
        tone: "ok",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByText("Synced · 2 peers");
    await expect(status).toBeInTheDocument();
    await expect(status.className).toContain("text-[var(--ink-muted)]");
  },
};

export const StatusWarn: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [],
      actions: [],
      status: {
        id: "status.warn",
        label: "Connecting to peers…",
        tone: "warn",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = canvas.getByText("Connecting to peers…");
    await expect(status).toBeInTheDocument();
    await expect(status.className).toContain("text-[var(--warning)]");
  },
};

export const StatusDangerAlert: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [],
      actions: [],
      status: {
        id: "status.danger",
        label: "Save failed",
        tone: "danger",
        title: "Disk quota exceeded: changes held in memory",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveTextContent("Save failed");
    await expect(alert.className).toContain("text-[var(--danger)]");
    await expect(alert).toHaveAttribute(
      "title",
      "Disk quota exceeded: changes held in memory",
    );
  },
};

export const CanvasPack: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: "Q3 Strategy Board",
      navigation: [
        {
          kind: "menu",
          id: "canvas.boards",
          label: "Q3 Strategy Board",
          items: [
            { id: "canvas.board.0", label: "Q3 Strategy Board", checked: true },
            { id: "canvas.board.1", label: "Architecture Diagram" },
            {
              id: "canvas.boards.new",
              label: "New board",
              separatorBefore: true,
            },
          ],
          help: {
            title: "Boards",
            body: "A board is one connected space inside this canvas. This switches between them.",
          },
        },
        {
          kind: "tabs",
          id: "canvas.board",
          label: "Open boards",
          items: [
            { id: "canvas.board.0", label: "Q3 Strategy Board", active: true },
            {
              id: "canvas.board.1",
              label: "Architecture Diagram",
              active: false,
            },
          ],
        },
        {
          kind: "buttons",
          id: "canvas.history-controls",
          items: [
            {
              id: "canvas.undo",
              label: "Undo",
              glyph: "\u21b6",
              disabled: true,
            },
            {
              id: "canvas.redo",
              label: "Redo",
              glyph: "\u21b7",
              disabled: false,
            },
            {
              id: "canvas.history",
              label: "Version history",
              glyph: "\u25f4",
              pressed: false,
            },
            {
              id: "canvas.outline",
              label: "Board outline",
              glyph: "\u2630",
              pressed: false,
            },
          ],
        },
      ],
      actions: [
        {
          id: "canvas.explain",
          label: "Explain mode",
          glyph: "\u25c8",
          pressed: false,
          help: {
            title: "Explain mode",
            body: "Gathers what you have selected into a context you can talk about.",
          },
        },
      ],
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const explain = canvas.getByRole("button", { name: "Explain mode" });
    await userEvent.click(explain);
    await expect(args.onChoose).toHaveBeenCalledWith({ id: "canvas.explain" });

    const redo = canvas.getByRole("button", { name: "Redo" });
    await userEvent.click(redo);
    await expect(args.onChoose).toHaveBeenCalledWith({ id: "canvas.redo" });
  },
};

export const PlannerPack: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: null,
      navigation: [
        {
          kind: "buttons",
          id: "planner.nav",
          items: [
            {
              id: "planner.nav.open",
              label: "Open navigation",
              glyph: "\u2261",
            },
          ],
        },
        {
          kind: "menu",
          id: "planner.view",
          label: "Today",
          items: [
            { id: "planner.view.today", label: "Today", checked: true },
            { id: "planner.view.week", label: "Week" },
            { id: "planner.view.month", label: "Month" },
          ],
          help: {
            title: "Switch view",
            body: "Planner is showing Today. This chooses which surface the plan is drawn on.",
          },
        },
      ],
      actions: [
        { id: "planner.new-task", label: "New task", glyph: "+" },
        { id: "planner.export", label: "Export" },
        { id: "planner.import", label: "Import" },
      ],
      status: {
        id: "planner.sync",
        label: "Synced · 2",
        tone: "ok",
        help: {
          title: "Sync",
          body: "This plan is shared with another device.",
        },
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const newTask = canvas.getByRole("button", { name: "New task" });
    await userEvent.click(newTask);
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "planner.new-task",
    });

    const status = canvas.getByText("Synced · 2");
    await expect(status).toBeInTheDocument();
  },
};

export const BudgetPack: Story = {
  args: {
    slots: {
      format: "suite.menu-slots",
      title: "Household Budget",
      navigation: [
        {
          kind: "menu",
          id: "budget.view",
          label: "Plan",
          items: [
            { id: "budget.view.plan", label: "Plan", checked: true },
            { id: "budget.view.accounts", label: "Accounts" },
            { id: "budget.view.reports", label: "Reports" },
          ],
          help: {
            title: "Switch view",
            body: "The budget is showing Plan. This chooses which surface it is drawn on.",
          },
        },
      ],
      actions: [
        { id: "budget.undo", label: "Undo", disabled: false },
        { id: "budget.redo", label: "Redo", disabled: true },
        { id: "budget.import", label: "Import" },
        { id: "budget.add-transaction", label: "Add transaction", glyph: "+" },
      ],
      status: {
        id: "budget.save",
        label: "Save failed",
        tone: "danger",
        title: "Disk quota exceeded",
        help: {
          title: "Save failed",
          body: "The last write did not reach the file. Your changes are still open here.",
        },
      },
    },
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const alert = canvas.getByRole("alert");
    await expect(alert).toHaveTextContent("Save failed");

    const addBtn = canvas.getByRole("button", { name: "Add transaction" });
    await userEvent.click(addBtn);
    await expect(args.onChoose).toHaveBeenCalledWith({
      id: "budget.add-transaction",
    });
  },
};
