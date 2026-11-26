import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { AppMark } from "../../../src/AppMark.js";
import { Button } from "../../../src/Button.js";
import {
  NewTabPicker,
  type NewTabPack,
  type NewTabScreen,
  type OpenDocumentRef,
} from "../../../src/chrome/NewTabPicker.js";

/**
 * The new-tab pattern in a host frame.
 *
 * The picker owns no state: this fixture does, the same way Desk does. A story presses the
 * control the person presses, then reads the sentence the host would act on, so the pattern is
 * checked end to end rather than drawn in one pose.
 */
const mark = (paths: readonly string[]) => <AppMark viewBox="0 0 24 24" paths={[...paths]} />;

const canvasIcon = mark(["M4 4h7v7H4zM13 13h7v7h-7z"]);
const plannerIcon = mark(["M5 4h14v3H5zM5 10h9v2H5zM5 15h11v2H5z"]);
const budgetIcon = mark(["M4 6h16v12H4zM7 10h4v4H7z"]);

const packs: readonly NewTabPack[] = [
  {
    id: "canvas",
    name: "Canvas",
    description: "Boards, cards and the book reader",
    icon: canvasIcon,
    noun: { singular: "Canvas", plural: "Canvases" },
    documents: [
      { id: "q3", name: "Q3 board", openedAt: 1_795_600_000_000 },
      { id: "reading", name: "Reading list", openedAt: 1_795_500_000_000 },
      { id: "empty", name: "An empty canvas" },
    ],
  },
  {
    id: "planner",
    name: "Planner",
    description: "Plans, tasks and reminders",
    icon: plannerIcon,
    noun: { singular: "Planner", plural: "Planners" },
    documents: [{ id: "autumn", name: "Autumn plan", openedAt: 1_795_400_000_000 }],
  },
  {
    id: "budget",
    name: "Budget",
    description: "Envelopes, accounts and reports",
    icon: budgetIcon,
    noun: { singular: "Budget", plural: "Budgets" },
    documents: [{ id: "home", name: "Household budget" }],
  },
  {
    id: "help",
    name: "Help",
    description: "The handbook, on this machine",
  },
];

const screens: readonly NewTabScreen[] = [
  { id: "home", name: "Home", description: "Your starting screen" },
  { id: "week-48", name: "Week 48", description: "Plan, tasks and budget" },
];

interface PatternProps {
  readonly startOpen?: boolean;
  readonly startPacks?: readonly NewTabPack[];
  readonly startScreens?: readonly NewTabScreen[];
  readonly openDocuments?: readonly OpenDocumentRef[];
}

function NewTabPattern({
  startOpen = true,
  startPacks = packs,
  startScreens = screens,
  openDocuments = [],
}: PatternProps) {
  const [open, setOpen] = useState(startOpen);
  const [opened, setOpened] = useState("Nothing opened yet.");

  return (
    <div className="relative mx-auto flex h-[640px] w-full max-w-[1080px] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--canvas)]">
      <header className="flex items-center justify-between border-b border-[var(--hairline)] px-6 py-3">
        <p className="text-[length:var(--text-label,12px)] uppercase tracking-wide text-[var(--ink-faint)]">
          Suite Desk · fixture window
        </p>
        <Button onClick={() => setOpen(true)}>New tab</Button>
      </header>
      <main className="flex flex-1 items-center justify-center p-8">
        <p
          data-testid="opened"
          className="max-w-[48ch] text-center text-[length:var(--text-body,13px)] text-[var(--ink-muted)]"
        >
          {opened}
        </p>
      </main>

      <NewTabPicker
        open={open}
        packs={startPacks}
        screens={startScreens}
        openDocuments={openDocuments}
        onClose={() => setOpen(false)}
        onOpenPack={(id) => setOpened(`The host opens the ${id} pack.`)}
        onOpenDocument={(packId, documentId) =>
          setOpened(`The host opens ${packId} › ${documentId} in its own tab.`)
        }
        onNewDocument={(packId) => setOpened(`The host asks ${packId} to create a document.`)}
        onOpenScreen={(id) => setOpened(`The host opens the ${id} Screen.`)}
        onNewScreen={() => setOpened("The host composes a new Screen.")}
        onOpenSettings={(section) =>
          setOpened(`The host opens Settings${section === undefined ? "" : `, ${section}`}.`)
        }
        onOpenFile={() => setOpened("The host shows a file dialog.")}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Patterns/New tab",
  component: NewTabPattern,
  tags: ["pack:suite", "layer:pattern", "status:experimental"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof NewTabPattern>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Recents, packs, Screens and host actions, before anything is typed. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    const list = within(dialog);
    const recents = within(list.getByRole("group", { name: "Recents" })).getAllByRole("option");
    await expect(recents[0]).toHaveTextContent("Q3 board");
    await expect(recents[0]).toHaveTextContent("Canvas");
    await expect(canvas.getByTestId("opened")).toHaveTextContent("Nothing opened yet.");
  },
};

/** A pack's own level: its recent documents, the rest, and the action that creates one. */
export const SecondLevel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    const list = within(dialog);
    await userEvent.click(list.getByRole("option", { name: /^Canvas/u }));
    await expect(list.getByRole("group", { name: "Recent Canvases" })).toBeInTheDocument();
    await expect(list.getByRole("option", { name: "New Canvas" })).toBeInTheDocument();
    await userEvent.click(list.getByRole("option", { name: "New Canvas" }));
    await expect(canvas.getByTestId("opened")).toHaveTextContent(
      "The host asks canvas to create a document.",
    );
  },
};

/** The keyboard route: type, Enter, and the same sentence the mouse produces. */
export const KeyboardOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    const input = within(dialog).getByRole("combobox");
    await userEvent.type(input, "home");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect(canvas.getByTestId("opened")).toHaveTextContent("The host opens the home Screen.");
  },
};

/** A document already in a tab is not offered again; the tab strip is one click away. */
export const OpenDocumentSkipped: Story = {
  args: { openDocuments: [{ packId: "canvas", documentId: "q3" }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    const recents = within(
      within(dialog).getByRole("group", { name: "Recents" }),
    ).getAllByRole("option");
    await expect(recents[0]).toHaveTextContent("Reading list");
    await expect(within(dialog).queryByRole("option", { name: /Q3 board/u })).toBeNull();
    await expect(canvas.getByTestId("opened")).toHaveTextContent("Nothing opened yet.");
  },
};

/** Nothing installed: one sentence, and the action that changes it. */
export const FirstRun: Story = {
  args: { startPacks: [], startScreens: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    await expect(within(dialog).getByText(/No packs are installed yet/u)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("option", { name: /^Install a pack/u }));
    await expect(canvas.getByTestId("opened")).toHaveTextContent(
      "The host opens Settings, packs.",
    );
  },
};

/** A pack that declares documents but holds none yet still offers the way to make one. */
export const EmptyPack: Story = {
  args: {
    startPacks: [
      {
        id: "canvas",
        name: "Canvas",
        description: "Boards, cards and the book reader",
        icon: canvasIcon,
        noun: { singular: "Canvas", plural: "Canvases" },
        documents: [],
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    const list = within(dialog);
    await userEvent.click(list.getByRole("option", { name: /^Canvas/u }));
    await expect(list.getByText("No Canvases yet.")).toBeInTheDocument();
    await userEvent.click(list.getByRole("option", { name: "New Canvas" }));
    await expect(canvas.getByTestId("opened")).toHaveTextContent(
      "The host asks canvas to create a document.",
    );
  },
};
