import { parseWidgetCapture, type SuiteWidget } from "@suite/contracts";
import { describe, expect, it } from "vitest";
import {
  buildWidgetCapture,
  createWidgetRegistry,
  resolveWidgetSettings,
  resolveWidgets,
} from "./registry.js";

const quickTask: SuiteWidget = {
  id: "quick-task",
  title: "New task",
  size: "2x1",
  capabilities: ["capture"],
  action: {
    kind: "capture",
    submitLabel: "Add task",
    fields: [{ id: "title", label: "Task", type: "text", required: true, maxLength: 120 }],
  },
  settings: [
    {
      id: "project",
      label: "Project",
      type: "text",
      default: "inbox",
      required: false,
      maxLength: 40,
    },
    { id: "days", label: "Days ahead", type: "number", default: "7", required: false },
    { id: "from", label: "From", type: "day", required: false },
  ],
};

const apps: SuiteWidget = {
  id: "apps",
  title: "Apps",
  size: "full",
  capabilities: ["capture"],
  action: {
    kind: "capture",
    submitLabel: "Open",
    fields: [{ id: "app", label: "App", type: "text", required: false }],
  },
};

describe("the widget registry", () => {
  it("registers an app's widgets under its id", () => {
    const registry = createWidgetRegistry([{ appId: "planner", widgets: [quickTask] }]);
    expect(registry.widgets.map((widget) => widget.registryId)).toEqual(["planner.quick-task"]);
    expect(registry.resolve("planner.quick-task")?.widget).toBe(quickTask);
    expect(registry.resolve("planner.unknown")).toBeUndefined();
  });

  it("registers a host widget with the same id shape", () => {
    const resolved = resolveWidgets("shell", [apps]);
    expect(resolved.map((widget) => widget.registryId)).toEqual(["shell.apps"]);
  });

  it("refuses an app id that is not lower kebab-case", () => {
    expect(resolveWidgets("Planner", [quickTask])).toEqual([]);
  });

  it("keeps the first declaration when two sources claim one registry id", () => {
    const other: SuiteWidget = { ...quickTask, title: "Other" };
    const registry = createWidgetRegistry([
      { appId: "planner", widgets: [quickTask] },
      { appId: "planner", widgets: [other] },
    ]);
    expect(registry.widgets).toHaveLength(1);
    expect(registry.widgets[0]?.widget.title).toBe("New task");
  });

  it("applies defaults and keeps an unknown setting", () => {
    const resolution = resolveWidgetSettings(quickTask, {
      project: "beta",
      "future-setting": "kept",
    });
    expect(resolution.settings).toEqual({
      project: "beta",
      days: "7",
      "future-setting": "kept",
    });
    expect(resolution.unknownSettings).toEqual(["future-setting"]);
    expect(resolution.issues).toEqual([]);
  });

  it("reports a value that does not fit its field", () => {
    const resolution = resolveWidgetSettings(quickTask, { days: "later", from: "2026-02-31" });
    expect(resolution.issues.map((issue) => issue.path)).toEqual([
      "settings.days",
      "settings.from",
    ]);
    // The stored values are still there: a bad value is reported, not deleted.
    expect(resolution.settings.days).toBe("later");
    expect(resolution.settings.from).toBe("2026-02-31");
  });

  it("reports a required setting with no value and no default", () => {
    const widget: SuiteWidget = {
      ...quickTask,
      settings: [{ id: "scope", label: "Scope", type: "text", required: true }],
    };
    const resolution = resolveWidgetSettings(widget);
    expect(resolution.issues).toEqual([{ path: "settings.scope", message: "required" }]);
  });

  it("answers through the registry as well as the pure functions", () => {
    const registry = createWidgetRegistry([
      { appId: "start", widgets: [apps] },
      { appId: "planner", widgets: [quickTask] },
    ]);
    expect(registry.settings("planner.quick-task").settings).toEqual({
      project: "inbox",
      days: "7",
    });
    expect(registry.settings("planner.quick-task", { project: "beta" }).settings.project).toBe(
      "beta",
    );
  });
});

describe("the capture payload", () => {
  it("is { widget, action, values, settings } with defaults applied", () => {
    const built = buildWidgetCapture(quickTask, { title: "Ship it" }, { project: "beta" });
    expect(built.capture).toEqual({
      widget: "quick-task",
      action: "capture",
      values: { title: "Ship it" },
      settings: { project: "beta", days: "7" },
    });
    expect(built.issues).toEqual([]);
    expect(built.unknownSettings).toEqual([]);
  });

  it("round-trips through the capture schema", () => {
    const built = buildWidgetCapture(quickTask, { title: "Ship it" });
    expect(parseWidgetCapture(built.capture, quickTask).ok).toBe(true);
  });

  it("keeps an unknown setting on the Screen but does not send it", () => {
    const built = buildWidgetCapture(
      quickTask,
      { title: "Ship it" },
      { project: "beta", "future-setting": "kept" },
    );
    expect(built.capture.settings).toEqual({ project: "beta", days: "7" });
    expect(built.unknownSettings).toEqual(["future-setting"]);
    expect(built.issues).toEqual([]);
    expect(parseWidgetCapture(built.capture, quickTask).ok).toBe(true);
  });

  it("refuses a missing required value", () => {
    const built = buildWidgetCapture(quickTask, {});
    expect(built.issues.map((issue) => issue.path)).toContain("values.title");
  });

  it("refuses a setting value that does not fit its field", () => {
    const built = buildWidgetCapture(quickTask, { title: "Ship" }, { days: "later" });
    expect(built.issues.map((issue) => issue.path)).toContain("settings.days");
    expect(built.capture.settings.days).toBe("later");
  });

  it("returns undefined for an id the registry does not know", () => {
    const registry = createWidgetRegistry([{ appId: "planner", widgets: [quickTask] }]);
    expect(registry.capture("planner.unknown", {})).toBeUndefined();
  });
});
