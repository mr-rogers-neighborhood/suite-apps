import { describe, expect, it } from "vitest";
import { describeIssues } from "./parse.js";
import {
  parseWidgetCapture,
  parseWidgetCaptureResult,
  splitWidgetRegistryId,
  suiteWidgetsSchema,
  widgetRegistryId,
} from "./widgets.js";

const quickTask = {
  id: "quick-task",
  title: "New task",
  size: "2x1",
  capabilities: ["capture"],
  action: {
    kind: "capture",
    submitLabel: "Add task",
    fields: [
      { id: "title", label: "Task", type: "text", required: true, maxLength: 120 },
      { id: "day", label: "Day", type: "day" },
      { id: "estimate", label: "Estimate (minutes)", type: "number" },
    ],
  },
};

describe("the widget descriptor", () => {
  it("accepts a capture widget and fills the additive defaults", () => {
    const parsed = suiteWidgetsSchema.safeParse([
      {
        ...quickTask,
        action: {
          kind: "capture",
          fields: [{ id: "title", label: "Task", type: "text" }],
        },
      },
    ]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data[0]?.action.submitLabel).toBe("Save");
    expect(parsed.data[0]?.action.fields[0]?.required).toBe(false);
  });

  it("refuses an unknown size class", () => {
    const parsed = suiteWidgetsSchema.safeParse([{ ...quickTask, size: "3x1" }]);
    expect(parsed.success).toBe(false);
  });

  it("refuses an unknown action", () => {
    const parsed = suiteWidgetsSchema.safeParse([
      { ...quickTask, action: { kind: "publish", fields: [] } },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("refuses a capture action the widget did not declare as a capability", () => {
    const parsed = suiteWidgetsSchema.safeParse([{ ...quickTask, capabilities: [] }]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.message).join(" ")).toContain("capability");
  });

  it("refuses two widgets with the same id", () => {
    const parsed = suiteWidgetsSchema.safeParse([quickTask, quickTask]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.message).join(" ")).toContain("duplicate");
  });

  it("refuses two fields with the same id", () => {
    const parsed = suiteWidgetsSchema.safeParse([
      {
        ...quickTask,
        action: {
          ...quickTask.action,
          fields: [
            { id: "title", label: "Task", type: "text" },
            { id: "title", label: "Again", type: "text" },
          ],
        },
      },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("refuses a length ceiling on a field that has its own", () => {
    const parsed = suiteWidgetsSchema.safeParse([
      {
        ...quickTask,
        action: {
          ...quickTask.action,
          fields: [{ id: "day", label: "Day", type: "day", maxLength: 10 }],
        },
      },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("refuses an executable key on a widget", () => {
    expect(suiteWidgetsSchema.safeParse([{ ...quickTask, entry: "widget.js" }]).success).toBe(
      false,
    );
  });
});

describe("the registry id", () => {
  it("joins an app id and a widget id", () => {
    expect(widgetRegistryId("planner", "quick-task")).toBe("planner.quick-task");
  });

  it("splits one back into its halves", () => {
    expect(splitWidgetRegistryId("start.apps")).toEqual({ appId: "start", widgetId: "apps" });
  });

  it.each(["apps", "start.apps.extra", "Start.apps", "start.", ".apps", "start.apps/extra"])(
    "refuses %j",
    (value) => {
      expect(splitWidgetRegistryId(value)).toBeNull();
    },
  );
});

const widget = {
  id: "quick-task",
  action: {
    kind: "capture" as const,
    submitLabel: "Add task",
    fields: [
      { id: "title", label: "Task", type: "text" as const, required: true, maxLength: 10 },
      { id: "day", label: "Day", type: "day" as const, required: false },
      { id: "estimate", label: "Estimate", type: "number" as const, required: false },
    ],
  },
};

describe("parseWidgetCapture", () => {
  it("accepts a capture that names the widget and fills its fields", () => {
    const parsed = parseWidgetCapture(
      {
        widget: "quick-task",
        action: "capture",
        values: { title: "Ship it", day: "2026-11-21", estimate: "30" },
      },
      widget,
    );
    expect(parsed.ok).toBe(true);
  });

  it("refuses a missing required field", () => {
    const parsed = parseWidgetCapture(
      { widget: "quick-task", action: "capture", values: { day: "2026-11-21" } },
      widget,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(describeIssues(parsed.issues)).toContain("values.title");
  });

  it("refuses a field the widget did not declare", () => {
    const parsed = parseWidgetCapture(
      { widget: "quick-task", action: "capture", values: { title: "Ship", project: "Beta" } },
      widget,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues.map((issue) => issue.path)).toContain("values.project");
  });

  it("refuses a value over the declared ceiling", () => {
    const parsed = parseWidgetCapture(
      { widget: "quick-task", action: "capture", values: { title: "a".repeat(11) } },
      widget,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(describeIssues(parsed.issues)).toContain("10 characters");
  });

  it("refuses a capture addressed to another widget", () => {
    const parsed = parseWidgetCapture(
      { widget: "weekly-review", action: "capture", values: { title: "Ship" } },
      widget,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(describeIssues(parsed.issues)).toContain("quick-task");
  });

  it("refuses a path or a document in the payload", () => {
    const parsed = parseWidgetCapture(
      {
        widget: "quick-task",
        action: "capture",
        values: { title: "Ship" },
        path: "/home/person/Documents/Suite/Planner/plan.planner",
      },
      widget,
    );
    expect(parsed.ok).toBe(false);
  });
});

describe("the capture result", () => {
  it("accepts a success with a link to what it created", () => {
    expect(
      parseWidgetCaptureResult({
        ok: true,
        message: "Added to the inbox",
        open: "suite://planner/workspace/plan.planner",
      }).ok,
    ).toBe(true);
  });

  it("accepts a refusal with its reason", () => {
    const parsed = parseWidgetCaptureResult({ ok: false, message: "That day is not a date." });
    expect(parsed.ok).toBe(true);
  });

  it("refuses a refusal with no sentence to show", () => {
    expect(parseWidgetCaptureResult({ ok: false }).ok).toBe(false);
  });
});
