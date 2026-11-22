import { describe, expect, it } from "vitest";
import { describeIssues } from "./parse.js";
import {
  parseWidgetCapture,
  parseWidgetCaptureResult,
  splitWidgetRegistryId,
  type SuiteWidget,
  suiteWidgetCaptureSchema,
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

const settingsWidget: SuiteWidget = {
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
    { id: "project", label: "Project", type: "text", default: "inbox", required: false, maxLength: 40 },
    { id: "days", label: "Days ahead", type: "number", default: "7", required: false },
    { id: "from", label: "From", type: "day", required: false },
  ],
};

describe("the widget settings descriptor", () => {
  it("leaves a widget without settings exactly as it was", () => {
    const parsed = suiteWidgetsSchema.safeParse([quickTask]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data[0]?.settings).toBeUndefined();
  });

  it("accepts settings and applies their additive defaults", () => {
    const parsed = suiteWidgetsSchema.safeParse([settingsWidget]);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data[0]?.settings?.[0]?.required).toBe(false);
  });

  it("refuses a default that does not fit its own field", () => {
    const base = {
      ...quickTask,
      settings: [{ id: "days", label: "Days", type: "number", default: "seven" }],
    };
    const parsed = suiteWidgetsSchema.safeParse([base]);
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues.map((issue) => issue.message).join(" ")).toContain("whole number");
  });

  it("refuses a day default that is not a calendar day", () => {
    const parsed = suiteWidgetsSchema.safeParse([
      {
        ...quickTask,
        settings: [{ id: "from", label: "From", type: "day", default: "2026-02-31" }],
      },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("refuses a text default over its own ceiling", () => {
    const parsed = suiteWidgetsSchema.safeParse([
      {
        ...quickTask,
        settings: [
          { id: "label", label: "Label", type: "text", maxLength: 4, default: "too long" },
        ],
      },
    ]);
    expect(parsed.success).toBe(false);
  });

  it("refuses an unknown setting field and an unknown type", () => {
    expect(
      suiteWidgetsSchema.safeParse([
        {
          ...quickTask,
          settings: [{ id: "project", label: "Project", type: "text", source: "api" }],
        },
      ]).success,
    ).toBe(false);
    expect(
      suiteWidgetsSchema.safeParse([
        { ...quickTask, settings: [{ id: "project", label: "Project", type: "colour" }] },
      ]).success,
    ).toBe(false);
  });

  it("refuses two settings with the same id", () => {
    const parsed = suiteWidgetsSchema.safeParse([
      {
        ...quickTask,
        settings: [
          { id: "project", label: "Project", type: "text" },
          { id: "project", label: "Again", type: "text" },
        ],
      },
    ]);
    expect(parsed.success).toBe(false);
  });
});

describe("settings in a capture", () => {
  it("round-trips a capture through the schema with its settings", () => {
    const parsed = suiteWidgetCaptureSchema.safeParse({
      widget: "quick-task",
      action: "capture",
      values: { title: "Ship it" },
      settings: { project: "beta", days: "14" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.settings).toEqual({ project: "beta", days: "14" });
  });

  it("fills an empty settings record for a capture written before settings", () => {
    const parsed = suiteWidgetCaptureSchema.safeParse({
      widget: "quick-task",
      action: "capture",
      values: { title: "Ship it" },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.settings).toEqual({});
  });

  it("accepts declared settings and refuses an unknown one", () => {
    const accepted = parseWidgetCapture(
      {
        widget: "quick-task",
        action: "capture",
        values: { title: "Ship" },
        settings: { project: "beta" },
      },
      settingsWidget,
    );
    expect(accepted.ok).toBe(true);

    const refused = parseWidgetCapture(
      {
        widget: "quick-task",
        action: "capture",
        values: { title: "Ship" },
        settings: { area: "beta" },
      },
      settingsWidget,
    );
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.issues.map((issue) => issue.path)).toContain("settings.area");
  });

  it("enforces a declared setting's type", () => {
    const parsed = parseWidgetCapture(
      {
        widget: "quick-task",
        action: "capture",
        values: { title: "Ship" },
        settings: { days: "later" },
      },
      settingsWidget,
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(describeIssues(parsed.issues)).toContain("whole number");
  });
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
