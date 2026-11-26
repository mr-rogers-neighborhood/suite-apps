import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import {
  cssVariables,
  DEFAULT_DENSITY,
  defaultTheme,
  presetById,
  scaleVariables,
} from "@suite/theme";
import { AppMark } from "../../src/AppMark.js";
import { Button } from "../../src/Button.js";
import {
  FirstRun,
  type FirstRunInstall,
  type FirstRunPack,
  type FirstRunRow,
  type FirstRunTheme,
} from "../../src/chrome/FirstRun.js";
import { HostTabBar } from "../../src/chrome/HostTabBar.js";
import { SyncPill } from "../../src/menu/SyncPill.js";

/**
 * The workbench story for the host's first-run surface.
 *
 * The component is the shipped one; this file supplies the catalogue, a mock installer and the
 * post-wizard empty Home. The theme scope is story-only: the host paints the real tokens on
 * `:root`, while the story needs its controls to repaint the frame immediately.
 */
const PACKS: readonly FirstRunPack[] = [
  {
    id: "canvas",
    name: "Canvas",
    description: "Boards, cards and the book reader",
    version: "0.1.13",
    publisher: "suite.run · key 9f2c 41a0 7d3e",
    capabilities: ["documents", "files", "network", "identity.pack"],
  },
  {
    id: "planner",
    name: "Planner",
    description: "Plans, tasks and reminders",
    version: "0.5.2",
    publisher: "suite.run · key 9f2c 41a0 7d3e",
    capabilities: ["documents", "network", "notifications"],
  },
  {
    id: "budget",
    name: "Budget",
    description: "Envelopes, accounts and reports",
    version: "0.4.2",
    publisher: "suite.run · key 9f2c 41a0 7d3e",
    capabilities: ["documents"],
  },
  {
    id: "help",
    name: "Help",
    description: "The user handbook and the developer docs",
    version: "0.1.3",
    publisher: "suite.run · key 9f2c 41a0 7d3e",
    capabilities: ["documents", "files"],
  },
];

const MIXED_ROWS: readonly FirstRunRow[] = [
  { id: "canvas", state: "installed", detail: "Installed" },
  { id: "planner", state: "installing", detail: "Installing… 62%" },
  { id: "budget", state: "queued", detail: "Waiting" },
  { id: "help", state: "queued", detail: "Waiting" },
];

const FAILED_ROWS: readonly FirstRunRow[] = [
  { id: "canvas", state: "installed", detail: "Installed" },
  { id: "planner", state: "failed", detail: "Signature refused" },
  { id: "budget", state: "installed", detail: "Installed" },
  { id: "help", state: "installed", detail: "Installed" },
];

function ThemeScope({
  theme,
  children,
}: {
  readonly theme: FirstRunTheme;
  readonly children: ReactNode;
}) {
  const mode = theme.mode === "system" ? "light" : theme.mode;
  const style = {
    ...cssVariables(presetById(theme.preset) ?? defaultTheme(), mode),
    ...scaleVariables(theme.density),
    colorScheme: mode,
  } as CSSProperties;
  return (
    <div style={style} className="bg-[var(--canvas)] p-4 text-[var(--ink)]">
      {children}
    </div>
  );
}

function StoryFirstRun({
  initialStep,
  initialRows,
  failPlanner = false,
}: {
  readonly initialStep?: "apps" | "appearance" | "install";
  readonly initialRows?: readonly FirstRunRow[];
  readonly failPlanner?: boolean;
}) {
  const [theme, setTheme] = useState<FirstRunTheme>({
    preset: "suite",
    mode: "light",
    density: DEFAULT_DENSITY,
  });
  const [done, setDone] = useState(false);

  async function install(id: string): Promise<FirstRunInstall> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return id === "planner" && failPlanner
      ? { id, ok: false, detail: "Signature refused" }
      : { id, ok: true, detail: "Installed" };
  }

  return (
    <ThemeScope theme={theme}>
      {done ? (
        <EmptyHome
          onOpenPack={() => setDone(false)}
          onCreateDocument={() => setDone(false)}
          onChoosePack={() => setDone(false)}
        />
      ) : (
        <FirstRun
          packs={PACKS}
          theme={theme}
          onThemeChange={setTheme}
          onInstall={install}
          onComplete={() => setDone(true)}
          {...(initialStep === undefined ? {} : { initialStep })}
          {...(initialRows === undefined ? {} : { initialRows })}
        />
      )}
    </ThemeScope>
  );
}

function EmptyHome({
  onOpenPack,
  onCreateDocument,
  onChoosePack,
}: {
  readonly onOpenPack: () => void;
  readonly onCreateDocument: () => void;
  readonly onChoosePack: () => void;
}) {
  return (
    <div className="flex h-[720px] w-full max-w-[1240px] flex-col overflow-hidden rounded-xl border border-[var(--hairline)] bg-[var(--canvas)]">
      <HostTabBar
        tabs={[]}
        activeTabId={null}
        mark={
          <span className="flex items-center gap-2">
            <AppMark
              viewBox="0 0 24 24"
              paths={["M12 2 22 12 12 22 2 12z"]}
              label="Suite"
            />
            <span>Suite</span>
          </span>
        }
        onHome={onChoosePack}
        homeLabel="Suite home"
        onNewTab={onChoosePack}
        onOpenSearch={onChoosePack}
        searchPlaceholder="Search apps, screens and commands"
        searchShortcut="Ctrl K"
        sync={<SyncPill situation="local" label="Local only" />}
      />
      <main className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-8 py-10">
        <p className="text-[length:var(--text-caption,11px)] uppercase tracking-wide text-[var(--ink-faint)]">
          Home
        </p>
        <h1 className="mt-2 text-[length:var(--text-display,34px)] text-[var(--ink)]">
          A clean start.
        </h1>
        <p className="mt-3 max-w-[58ch] text-[length:var(--text-body,13px)] leading-relaxed text-[var(--ink-muted)]">
          Your apps are installed. Open one to make a document, or add a new widget.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="primary" onClick={onOpenPack}>
            Open Canvas
          </Button>
          <Button variant="secondary" onClick={onCreateDocument}>
            Create a document
          </Button>
          <Button variant="ghost" onClick={onChoosePack}>
            Choose an app
          </Button>
        </div>
        <p className="mt-6 text-[length:var(--text-caption,11px)] text-[var(--ink-faint)]">
          You can change Home later from a tab&apos;s menu or Settings.
        </p>
      </main>
    </div>
  );
}

const meta = {
  title: "Workbench/First run",
  component: StoryFirstRun,
  tags: ["pack:suite", "layer:workbench", "status:experimental"],
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof StoryFirstRun>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChooseApps: Story = {};

export const SelectionInteraction: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /^Planner/ }));
    await expect(canvas.getByRole("button", { name: /^Planner/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await userEvent.click(canvas.getByRole("button", { name: "Continue" }));
    await expect(canvas.getByRole("heading", { name: "Make it yours." })).toBeVisible();
  },
};

export const AppearanceStep: Story = {
  args: { initialStep: "appearance" },
};

export const Installing: Story = {
  args: { initialStep: "install", initialRows: MIXED_ROWS },
};

export const InstallFailed: Story = {
  args: { initialStep: "install", initialRows: FAILED_ROWS },
};

export const Ready: Story = {
  render: () => (
    <ThemeScope theme={{ preset: "suite", mode: "light", density: DEFAULT_DENSITY }}>
      <EmptyHome onOpenPack={() => {}} onCreateDocument={() => {}} onChoosePack={() => {}} />
    </ThemeScope>
  ),
};
