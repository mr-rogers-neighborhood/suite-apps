import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { AppMark } from "../../src/AppMark.js";
import { Button } from "../../src/Button.js";
import { IconButton } from "../../src/IconButton.js";
import { HostTabBar, type HostTab } from "../../src/chrome/HostTabBar.js";
import {
  NewTabPicker,
  type NewTabPack,
  type NewTabScreen,
} from "../../src/chrome/NewTabPicker.js";
import { SyncPill, type SyncSituation } from "../../src/menu/SyncPill.js";

/**
 * A Desk-shaped workbench: the real bar, the real picker and a fixture surface.
 *
 * This is the first place the host chrome is seen together outside Electron. It owns only the
 * fixture tab list; the components own their presentation, so the story cannot drift from the
 * component the host actually mounts.
 */
const suiteMark = (
  <AppMark viewBox="0 0 24 24" paths={["M12 2 22 12 12 22 2 12z"]} label="Suite" />
);

const packMark = (paths: readonly string[]) => (
  <AppMark viewBox="0 0 24 24" paths={[...paths]} />
);

const canvasIcon = packMark(["M4 4h7v7H4zM13 13h7v7h-7z"]);
const plannerIcon = packMark(["M5 4h14v3H5zM5 10h9v2H5zM5 15h11v2H5z"]);
const budgetIcon = packMark(["M4 6h16v12H4zM7 10h4v4H7z"]);

const packs: readonly NewTabPack[] = [
  {
    id: "canvas",
    name: "Canvas",
    description: "Boards, cards and the book reader",
    icon: canvasIcon,
    noun: { singular: "Canvas", plural: "Canvases" },
    documents: [
      { id: "q3", name: "Q3 board", openedAt: 1_795_600_000_000 },
      { id: "reading", name: "Reading list" },
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
    documents: [{ id: "household", name: "Household budget" }],
  },
];

const screens: readonly NewTabScreen[] = [
  { id: "home", name: "Home", description: "Your starting screen" },
  { id: "week", name: "Week 48", description: "Plan, tasks and budget" },
];

const initialTabs: readonly HostTab[] = [
  { id: "canvas", title: "Canvas", kind: "pack", icon: canvasIcon },
  { id: "home", title: "Home", kind: "screen" },
  { id: "budget", title: "Budget", kind: "pack", icon: budgetIcon },
];

interface HostShellProps {
  readonly startTabs?: readonly HostTab[];
  readonly startActive?: string | null;
  readonly startPickerOpen?: boolean;
  readonly startSyncOpen?: boolean;
  readonly syncSituation?: SyncSituation;
  readonly syncLabel?: string;
}

function HostShell({
  startTabs = initialTabs,
  startActive = "canvas",
  startPickerOpen = false,
  startSyncOpen = false,
  syncSituation = "local",
  syncLabel = "Local only",
}: HostShellProps) {
  const [tabs, setTabs] = useState<readonly HostTab[]>(startTabs);
  const [active, setActive] = useState<string | null>(startActive);
  const [pickerOpen, setPickerOpen] = useState(startPickerOpen);
  const [syncOpen, setSyncOpen] = useState(startSyncOpen);
  const [commandOpen, setCommandOpen] = useState(false);
  const activeTab = tabs.find((tab) => tab.id === active) ?? null;

  function openTab(tab: HostTab) {
    setTabs((current) =>
      current.some((row) => row.id === tab.id) ? current : [...current, tab],
    );
    setActive(tab.id);
    setPickerOpen(false);
  }

  function openPack(id: string) {
    const pack = packs.find((row) => row.id === id);
    if (pack === undefined) return;
    openTab({ id: pack.id, title: pack.name, kind: "pack", icon: pack.icon });
  }

  function openScreen(id: string) {
    const screen = screens.find((row) => row.id === id);
    if (screen === undefined) return;
    openTab({ id: screen.id, title: screen.name, kind: "screen" });
  }

  function openDocument(packId: string, documentId: string) {
    const pack = packs.find((row) => row.id === packId);
    const document = pack?.documents?.find((row) => row.id === documentId);
    if (pack === undefined || document === undefined) return;
    // The real host keeps one tab per pack and loads the document inside it; the fixture names
    // the tab after the document so the choice is visible in the bar.
    openTab({ id: document.id, title: document.name, kind: "pack", icon: pack.icon });
  }

  function newDocument(packId: string) {
    const pack = packs.find((row) => row.id === packId);
    if (pack === undefined) return;
    const noun = pack.noun?.singular ?? "document";
    openTab({ id: `new-${pack.id}`, title: `New ${noun}`, kind: "pack", icon: pack.icon });
  }

  function newScreen() {
    const id = `screen-${String(tabs.length + 1)}`;
    openTab({ id, title: "Untitled screen", kind: "screen" });
  }

  function openSettings() {
    openTab({ id: "settings", title: "Settings", kind: "settings" });
  }

  function closeTab(id: string) {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.id === id);
      const next = current.filter((tab) => tab.id !== id);
      if (id === active) {
        const neighbour = next[Math.max(0, index - 1)] ?? next[0] ?? null;
        setActive(neighbour?.id ?? null);
      }
      return next;
    });
  }

  return (
    <div className="relative mx-auto flex h-[720px] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--canvas)] shadow-[var(--shadow-xl)]">
      <HostTabBar
        tabs={tabs}
        activeTabId={active}
        onActivate={setActive}
        onClose={closeTab}
        onNewTab={() => setPickerOpen(true)}
        mark={suiteMark}
        onHome={() => setPickerOpen(true)}
        homeLabel="Home"
        onOpenSearch={() => setCommandOpen(true)}
        searchPlaceholder="Search apps, screens and commands"
        searchShortcut="Ctrl K"
        sync={
          <SyncPill
            situation={syncSituation}
            label={syncLabel}
            aria-expanded={syncOpen}
            aria-controls="sync-panel"
            onClick={() => setSyncOpen((open) => !open)}
          />
        }
        controls={
          <IconButton label="Settings" onClick={openSettings}>
            <span aria-hidden="true">{"\u2699"}</span>
          </IconButton>
        }
      />

      {syncOpen ? (
        <section
          id="sync-panel"
          aria-label="Sync relay"
          className="border-b border-[var(--hairline)] bg-[var(--surface)] px-6 py-4"
        >
          <p className="text-[length:var(--text-label,12px)] text-[var(--ink-muted)]">
            The relay runs on this machine. The host supervises it; a pack asks for one pinned
            connection.
          </p>
          <p className="mt-2 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
            Address <code>wss://127.0.0.1:7177/sync</code> · code <code>SUITE-4KQ2</code>
          </p>
        </section>
      ) : null}

      <main className="min-h-0 flex-1 overflow-auto px-8 py-7">
        <p className="text-[length:var(--text-caption,11px)] uppercase tracking-wide text-[var(--ink-faint)]">
          {activeTab?.kind === "pack" ? "Pack" : activeTab?.kind === "screen" ? "Screen" : "Host"}
        </p>
        <h1 className="mt-2 text-[length:var(--text-display,34px)] text-[var(--ink)]">
          {activeTab?.title ?? "Nothing open"}
        </h1>
        <p className="mt-3 max-w-[58ch] text-[length:var(--text-body,13px)] text-[var(--ink-muted)]">
          This is the fixture surface. The workbench owns the tab list and the selected id; the
          real host owns the pack frame behind it.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {["Today", "This week", "Everything"].map((label) => (
            <section
              key={label}
              className="rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-4"
            >
              <h2 className="text-[length:var(--text-title,15px)] text-[var(--ink)]">{label}</h2>
              <p className="mt-1 text-[length:var(--text-label,12px)] text-[var(--ink-muted)]">
                A fixture card so the surface has weight while the chrome is reviewed.
              </p>
            </section>
          ))}
        </div>
      </main>

      {commandOpen ? (
        <div
          role="dialog"
          aria-label="Command surface"
          className="absolute inset-x-0 top-16 mx-auto w-[min(560px,calc(100vw-2rem))] rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xl)]"
        >
          <p className="text-[length:var(--text-label,12px)] text-[var(--ink-muted)]">
            Command surface
          </p>
          <Button className="mt-3" onClick={() => setCommandOpen(false)}>
            Close
          </Button>
        </div>
      ) : null}

      <NewTabPicker
        open={pickerOpen}
        packs={packs}
        screens={screens}
        onClose={() => setPickerOpen(false)}
        onOpenPack={openPack}
        onOpenDocument={openDocument}
        onNewDocument={newDocument}
        onOpenScreen={openScreen}
        onNewScreen={newScreen}
        onOpenSettings={openSettings}
      />
    </div>
  );
}

const meta = {
  title: "Workbench/Host shell",
  component: HostShell,
  tags: ["pack:suite", "layer:workbench", "status:experimental"],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof HostShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "New tab" }));
    const dialog = await screen.findByRole("dialog", { name: "New tab" });
    await userEvent.type(within(dialog).getByRole("combobox"), "budget");
    // The pack row comes first; Enter opens its documents, and the first of those is the one
    // the fixture recorded.
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    await expect(canvas.getByRole("button", { name: "Household budget" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
};

export const PickerOpen: Story = {
  args: { startPickerOpen: true },
};

export const FirstRun: Story = {
  args: { startTabs: [], startActive: null, startPickerOpen: true },
};

export const ManyTabs: Story = {
  args: {
    startTabs: [
      ...initialTabs,
      { id: "planner", title: "Planner", kind: "pack", icon: plannerIcon },
      { id: "week", title: "Week 48", kind: "screen" },
      { id: "help", title: "Help", kind: "pack" },
      { id: "settings", title: "Settings", kind: "settings" },
    ],
    startActive: "settings",
  },
};

export const SyncRefused: Story = {
  args: { startSyncOpen: true, syncSituation: "refused", syncLabel: "Sync failed" },
};
