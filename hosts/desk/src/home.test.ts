import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SuiteWidget } from "@suite/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DESK_APPS_WIDGET,
  defaultHomeScreen,
  HOME_SCREEN_ID,
  HOME_SCREEN_NAME,
  openHomeScreen,
  screenChoices,
  screenView,
  shellSurface,
  shellWidgetRegistry,
} from "./home.js";
import type { PackInfo } from "./packs.js";
import { SCREENS_INDEX_FILENAME, ScreenSet } from "./screens.js";
import type { ScreenView, ScreenWidgetView } from "./shared.js";
import { SpaceStore } from "./spaces.js";

function quickTask(overrides: Partial<SuiteWidget> = {}): SuiteWidget {
  return {
    id: "quick-task",
    title: "Quick task",
    size: "2x1",
    capabilities: ["capture"],
    action: {
      kind: "capture",
      submitLabel: "Add",
      fields: [{ id: "title", label: "Title", type: "text", required: true }],
    },
    settings: [
      { id: "project", label: "Project", type: "text", required: false, default: "inbox" },
    ],
    ...overrides,
  };
}

function pack(
  id: string,
  name: string,
  widgets: readonly SuiteWidget[] = [],
  source: PackInfo["source"] = "installed",
): PackInfo {
  return {
    id,
    name,
    version: "0.1.0",
    description: null,
    entry: "index.html",
    capabilities: [],
    widgets,
    publisher: { id: "suite", fingerprint: "AA:BB" },
    root: `/packs/${id}`,
    source,
  };
}

function widgetEntry(view: ScreenView, index: number): ScreenWidgetView {
  const entry = view.widgets[index];
  if (entry === undefined || entry.kind !== "widget") {
    throw new Error(`widget ${index} is not a widget entry`);
  }
  return entry;
}

describe("the default Home", () => {
  it("is an empty Screen named Home", () => {
    expect(defaultHomeScreen()).toEqual({
      format: "suite.screen",
      version: 3,
      id: HOME_SCREEN_ID,
      name: HOME_SCREEN_NAME,
      widgets: [],
    });
  });
});

describe("drawing a Screen", () => {
  it("still resolves the old host app grid for an existing Home", () => {
    const fakeDesk = pack("desk", "Not the host", [quickTask({ id: "apps", title: "Fake" })]);
    const registry = shellWidgetRegistry([fakeDesk]);
    const oldHome = {
      ...defaultHomeScreen(),
      widgets: [{ registryId: DESK_APPS_WIDGET, size: "full" as const, x: 0, y: 0 }],
    };
    const view = screenView(oldHome, [fakeDesk], registry);

    expect(view.widgets[0]).toMatchObject({
      registryId: DESK_APPS_WIDGET,
      source: "host",
      title: "Apps",
      size: "full",
      fields: [],
    });
    expect(widgetEntry(view, 0).note).toContain("catalogue");
  });

  it("renders an installed app widget's title and declared fields", () => {
    const planner = pack("planner", "Planner", [quickTask()]);
    const screen = {
      ...defaultHomeScreen(),
      widgets: [
        { registryId: DESK_APPS_WIDGET, size: "full" as const, x: 0, y: 0 },
        {
          registryId: "planner.quick-task",
          size: "2x1" as const,
          x: 0,
          y: 0,
          settings: { project: "work" },
        },
      ],
    };

    const view = screenView(screen, [planner], shellWidgetRegistry([planner]));
    const widget = widgetEntry(view, 1);

    expect(widget).toMatchObject({
      registryId: "planner.quick-task",
      source: "app",
      title: "Quick task",
      appId: "planner",
      appName: "Planner",
      size: "2x1",
    });
    expect(widget.fields).toEqual([{ id: "title", label: "Title", type: "text", required: true }]);
    expect(widget.settings).toEqual([{ id: "project", label: "Project", value: "work" }]);
    expect(widget.note).toContain("not available");
  });

  it("applies a declared default when the Screen has no setting", () => {
    const planner = pack("planner", "Planner", [quickTask()]);
    const screen = {
      ...defaultHomeScreen(),
      widgets: [
        { registryId: DESK_APPS_WIDGET, size: "full" as const, x: 0, y: 0 },
        { registryId: "planner.quick-task", size: "2x1" as const, x: 0, y: 0 },
      ],
    };

    const view = screenView(screen, [planner], shellWidgetRegistry([planner]));
    expect(widgetEntry(view, 1).settings).toEqual([
      { id: "project", label: "Project", value: "inbox" },
    ]);
  });

  it("keeps an unknown widget as a named placeholder with a note", () => {
    const screen = {
      ...defaultHomeScreen(),
      widgets: [
        { registryId: DESK_APPS_WIDGET, size: "full" as const, x: 0, y: 0 },
        {
          registryId: "ghost.notes",
          size: "1x1" as const,
          x: 0,
          y: 0,
          settings: { project: "inbox" },
        },
      ],
    };

    const view = screenView(screen, []);
    expect(view.widgets[1]).toMatchObject({
      registryId: "ghost.notes",
      source: "unknown",
      title: "ghost.notes",
      size: "1x1",
    });
    expect(widgetEntry(view, 1).note).toContain("not installed");
    expect(widgetEntry(view, 1).unknownSettings).toEqual(["project"]);
  });

  it("renders a row with weighted children and a phone scroll mode", () => {
    const planner = pack("planner", "Planner", [quickTask()]);
    const screen = {
      ...defaultHomeScreen(),
      widgets: [
        {
          kind: "row" as const,
          size: "full" as const,
          x: 0,
          y: 0,
          layout: "row" as const,
          items: [
            { registryId: "planner.quick-task", weight: 2, settings: { project: "work" } },
            { registryId: "ghost.notes", weight: 1 },
          ],
        },
      ],
    };

    const registry = shellWidgetRegistry([planner]);
    const wide = screenView(screen, [planner], registry, 1200);
    const row = wide.widgets[0];
    expect(row).toMatchObject({ kind: "row", size: "full", layout: "row", mode: "wrap" });
    if (row === undefined || row.kind !== "row") return;
    expect(row.items.map((item) => item.weight)).toEqual([2, 1]);
    expect(row.items[0]?.widget).toMatchObject({
      kind: "widget",
      registryId: "planner.quick-task",
      source: "app",
    });
    expect(row.items[1]?.widget).toMatchObject({
      kind: "widget",
      registryId: "ghost.notes",
      source: "unknown",
    });

    const narrow = screenView(screen, [planner], registry, 390);
    const phoneRow = narrow.widgets[0];
    expect(phoneRow).toMatchObject({ kind: "row", mode: "scroll" });
  });

  it("offers the host widget and each installed app widget to add", () => {
    const planner = pack("planner", "Planner", [quickTask()]);
    const choices = screenChoices([planner], shellWidgetRegistry([planner]));

    expect(choices.map((choice) => choice.registryId)).toEqual([
      DESK_APPS_WIDGET,
      "planner.quick-task",
    ]);
    expect(choices[1]).toMatchObject({ source: "app", appName: "Planner", size: "2x1" });
  });
});

describe("the surface", () => {
  it("is the launcher with no active tab, a screen for a screen tab, and a pack otherwise", () => {
    expect(shellSurface({ tabs: [], activeTabId: null })).toBe("launcher");
    expect(
      shellSurface({
        tabs: [{ kind: "screen", id: "s1", screenId: HOME_SCREEN_ID, title: "Home" }],
        activeTabId: "s1",
      }),
    ).toBe("screen");
    expect(
      shellSurface({
        tabs: [
          { kind: "pack", id: "p1", packId: "welcome", title: "Welcome", entry: "index.html" },
        ],
        activeTabId: "p1",
      }),
    ).toBe("pack");
  });
});

describe("Home in the space document", () => {
  let root: string;
  let spaces: SpaceStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "suite-desk-home-"));
    spaces = await SpaceStore.open(join(root, "spaces.loro"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("opens Home before any pack and keeps it first in the strip", async () => {
    const screens = await ScreenSet.open({
      directory: join(root, "screens"),
      indexFile: join(root, SCREENS_INDEX_FILENAME),
    });
    const home = await openHomeScreen(screens, spaces);

    expect(home.opened).toBe(true);
    expect(spaces.state().tabs).toEqual([
      { kind: "screen", id: home.tabId, screenId: HOME_SCREEN_ID, title: HOME_SCREEN_NAME },
    ]);
    expect(spaces.state().activeTabId).toBe(home.tabId);

    const packTab = await spaces.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });
    expect(spaces.state().tabs.map((tab) => tab.kind)).toEqual(["screen", "pack"]);
    expect(shellSurface(spaces.state())).toBe("pack");

    await spaces.activateTab(home.tabId);
    expect(shellSurface(spaces.state())).toBe("screen");
    await spaces.activateTab(packTab.id);
    expect(shellSurface(spaces.state())).toBe("pack");
  });

  it("reuses the Home tab instead of opening a second one", async () => {
    const screens = await ScreenSet.open({
      directory: join(root, "screens"),
      indexFile: join(root, SCREENS_INDEX_FILENAME),
    });
    const home = await openHomeScreen(screens, spaces);
    const packTab = await spaces.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });

    const again = await openHomeScreen(screens, spaces);
    expect(again.opened).toBe(false);
    expect(again.tabId).toBe(home.tabId);
    expect(spaces.state().tabs).toHaveLength(2);
    // The startup call does not steal focus from a restored or newly opened pack.
    expect(spaces.state().activeTabId).toBe(packTab.id);

    await spaces.activateTab(home.tabId);
    expect(shellSurface(spaces.state())).toBe("screen");
  });

  it("keeps a restored session's active pack tab when Home is added", async () => {
    const restored = await spaces.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });
    const screens = await ScreenSet.open({
      directory: join(root, "screens"),
      indexFile: join(root, SCREENS_INDEX_FILENAME),
    });

    await openHomeScreen(screens, spaces);
    expect(spaces.state().tabs[0]?.kind).toBe("screen");
    expect(spaces.state().activeTabId).toBe(restored.id);
  });

  it("closes a screen tab and selects its neighbour", async () => {
    const screens = await ScreenSet.open({
      directory: join(root, "screens"),
      indexFile: join(root, SCREENS_INDEX_FILENAME),
    });
    const home = await openHomeScreen(screens, spaces);
    const packTab = await spaces.openTab({
      packId: "welcome",
      title: "Welcome",
      entry: "index.html",
    });

    await expect(spaces.closeTab(home.tabId)).resolves.toBe(packTab.id);
    expect(spaces.state().tabs).toHaveLength(1);
    expect(spaces.state().tabs[0]?.kind).toBe("pack");
  });
});
