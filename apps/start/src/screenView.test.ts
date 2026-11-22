import type { SuiteWidget } from "@suite/contracts";
import { createWidgetRegistry, type Screen } from "@suite/screens";
import { describe, expect, it } from "vitest";
import {
  availableScreenWidgets,
  resolveScreenWidget,
  resolveScreenWidgets,
  screenWidgetSizes,
  widgetDefaultSize,
  widgetSettingField,
} from "./screenView.js";

/**
 * Joining a Screen to what this build can draw.
 *
 * The cases that matter are the three sources in one ordered list: the host's own table,
 * an installed app's declaration, and an id nothing provides. The last one is not an
 * error: it keeps its name and its settings and is described, because dropping it is the
 * silent partial Screen the decision forbids.
 */

const quickTask: SuiteWidget = {
  id: "quick-task",
  title: "Quick task",
  size: "2x1",
  capabilities: ["capture"],
  action: {
    kind: "capture",
    submitLabel: "Add task",
    fields: [{ id: "title", label: "Task", type: "text", required: true, maxLength: 120 }],
  },
  settings: [{ id: "project", label: "Project", type: "text", default: "inbox", required: false }],
};

const agenda: SuiteWidget = {
  id: "agenda",
  title: "Today",
  size: "1x1",
  capabilities: ["capture"],
  action: {
    kind: "capture",
    submitLabel: "Save",
    fields: [{ id: "day", label: "Day", type: "day", required: false }],
  },
};

const registry = createWidgetRegistry([{ appId: "planner", widgets: [quickTask, agenda] }]);

const screen: Screen = {
  format: "suite.screen",
  version: 1,
  id: "start-home",
  name: "Home",
  widgets: [
    { registryId: "start.apps", size: "full" },
    {
      registryId: "planner.quick-task",
      size: "2x1",
      settings: { project: "work", "future-flag": "on" },
    },
    { registryId: "future.unknown-widget", size: "1x1", settings: { "future-setting": "kept" } },
  ],
};

const byId = (id: string) => {
  const widget = resolveScreenWidgets(screen, registry).find((entry) => entry.registryId === id);
  if (widget === undefined) throw new Error(`no ${id}`);
  return widget;
};

describe("resolveScreenWidgets", () => {
  it("keeps the Screen's order and each placement's size", () => {
    expect(
      resolveScreenWidgets(screen, registry).map((widget) => [widget.registryId, widget.size]),
    ).toEqual([
      ["start.apps", "full"],
      ["planner.quick-task", "2x1"],
      ["future.unknown-widget", "1x1"],
    ]);
  });

  it("resolves the host's own widgets before the app registry", () => {
    const apps = byId("start.apps");
    expect(apps.kind).toBe("apps");
    expect(apps.title).toBe("Apps");
    expect(apps.sizes).toEqual(["2x1", "full"]);
    expect(apps.submitLabel).toBeNull();
    expect(apps.fields).toEqual([]);
  });

  it("renders an app widget's title, capture fields and settings", () => {
    const widget = byId("planner.quick-task");
    expect(widget.kind).toBe("app");
    expect(widget.title).toBe("Quick task");
    expect(widget.submitLabel).toBe("Add task");
    expect(widget.fields).toEqual([
      { id: "title", label: "Task", type: "text", required: true, maxLength: 120 },
    ]);
    expect(widget.settings).toEqual([
      {
        id: "project",
        label: "Project",
        type: "text",
        value: "work",
        required: false,
        maxLength: null,
      },
    ]);
  });

  it("names an unknown setting and keeps it on the Screen", () => {
    const widget = byId("planner.quick-task");
    expect(widget.unknownSettings).toEqual(["future-flag"]);
    expect(widget.note).toContain("future-flag");
    expect(widget.note).toContain("stay on the Screen");
  });

  it("draws an unknown registry id as a named placeholder, not a gap", () => {
    const widget = byId("future.unknown-widget");
    expect(widget.kind).toBe("unknown");
    expect(widget.title).toBe("future.unknown-widget");
    expect(widget.description).toContain("future.unknown-widget");
    expect(widget.note).toContain("settings");
    expect(widget.sizes).toEqual(["1x1", "2x1", "full"]);
  });

  it("resolves one placement on its own", () => {
    const entry = screen.widgets[1];
    if (entry === undefined) throw new Error("missing entry");
    expect(resolveScreenWidget(entry, registry).registryId).toBe("planner.quick-task");
  });
});

describe("availableScreenWidgets", () => {
  it("offers host widgets and installed app widgets the Screen does not show", () => {
    expect(availableScreenWidgets(screen, registry).map((widget) => widget.registryId)).toEqual([
      "start.recents",
      "planner.agenda",
    ]);
  });

  it("offers the size each widget asks for when it is added", () => {
    const available = availableScreenWidgets(screen, registry);
    expect(available.find((widget) => widget.registryId === "start.recents")?.defaultSize).toBe(
      "2x1",
    );
    expect(available.find((widget) => widget.registryId === "planner.agenda")?.defaultSize).toBe(
      "1x1",
    );
  });
});

describe("sizes and settings", () => {
  it("keeps a host widget's own size classes and gives an app widget all three", () => {
    expect(screenWidgetSizes("start.apps", registry)).toEqual(["2x1", "full"]);
    expect(screenWidgetSizes("planner.quick-task", registry)).toEqual(["1x1", "2x1", "full"]);
    expect(screenWidgetSizes("future.unknown-widget", registry)).toEqual(["1x1", "2x1", "full"]);
  });

  it("names the size an added placement gets, and refuses an unknown id", () => {
    expect(widgetDefaultSize("start.apps", registry)).toBe("full");
    expect(widgetDefaultSize("planner.quick-task", registry)).toBe("2x1");
    expect(widgetDefaultSize("future.unknown-widget", registry)).toBeNull();
  });

  it("returns a declared setting field and nothing for an unknown one", () => {
    expect(widgetSettingField("planner.quick-task", "project", registry)?.label).toBe("Project");
    expect(widgetSettingField("planner.quick-task", "future", registry)).toBeNull();
    expect(widgetSettingField("start.apps", "project", registry)).toBeNull();
  });
});
