import type { SuiteWidgetSize } from "@suite/contracts";
import { describe, expect, it } from "vitest";
import {
  APPS_WIDGET_ID,
  addWidget,
  DASHBOARD_FORMAT,
  DASHBOARD_VERSION,
  type DashboardLayout,
  DEFAULT_DASHBOARD,
  defaultDashboard,
  HOST_WIDGETS,
  hostWidgetIds,
  moveWidget,
  parseDashboard,
  RECENTS_WIDGET_ID,
  removeWidget,
  resizeWidget,
  serializeDashboard,
} from "./dashboard.js";

/**
 * The layout file.
 *
 * Each test is a state a real machine can be in: the first launch, a file a person edited,
 * a file written by a newer Start, an id whose app was uninstalled. The rule under all of
 * them is that Start shows something true and says what it had to change.
 */

function layout(ids: readonly string[], size: SuiteWidgetSize = "full"): DashboardLayout {
  return {
    format: DASHBOARD_FORMAT,
    version: DASHBOARD_VERSION,
    widgets: ids.map((id) => ({ id, size })),
  };
}

describe("the default layout", () => {
  it("is the app grid at full width and nothing else", () => {
    expect(DEFAULT_DASHBOARD.widgets).toEqual([{ id: APPS_WIDGET_ID, size: "full" }]);
  });

  it("is what a machine with no file gets, with nothing to explain", () => {
    const read = defaultDashboard();
    expect(read.layout).toEqual(DEFAULT_DASHBOARD);
    expect(read.note).toBeNull();
  });
});

describe("parseDashboard", () => {
  it("honours a layout it understands", () => {
    const read = parseDashboard(layout([APPS_WIDGET_ID, RECENTS_WIDGET_ID], "2x1"));
    expect(read.layout.widgets.map((widget) => widget.id)).toEqual([
      APPS_WIDGET_ID,
      RECENTS_WIDGET_ID,
    ]);
    expect(read.note).toBeNull();
  });

  it("falls back to the default when the file is not JSON-shaped", () => {
    for (const value of [null, "dashboard", 7, []]) {
      const read = parseDashboard(value);
      expect(read.layout).toEqual(DEFAULT_DASHBOARD);
      expect(read.note).toContain("could not read");
    }
  });

  it("falls back when the file names another format", () => {
    const read = parseDashboard({ format: "something.else", version: 1, widgets: [] });
    expect(read.layout).toEqual(DEFAULT_DASHBOARD);
    expect(read.note).toContain("could not read");
  });

  it("falls back when a newer Start wrote it", () => {
    const read = parseDashboard({
      format: DASHBOARD_FORMAT,
      version: DASHBOARD_VERSION + 1,
      widgets: [{ id: APPS_WIDGET_ID, size: "full" }],
    });
    expect(read.layout).toEqual(DEFAULT_DASHBOARD);
    expect(read.note).toContain("newer Start");
  });

  it("falls back when an entry has an unknown size class", () => {
    const read = parseDashboard({
      format: DASHBOARD_FORMAT,
      version: DASHBOARD_VERSION,
      widgets: [{ id: APPS_WIDGET_ID, size: "3x1" }],
    });
    expect(read.layout).toEqual(DEFAULT_DASHBOARD);
    expect(read.note).toContain("could not read");
  });

  it("drops a widget id this build does not know, and names it", () => {
    const read = parseDashboard(layout([APPS_WIDGET_ID, "planner.quick-task"]));
    expect(read.layout.widgets.map((widget) => widget.id)).toEqual([APPS_WIDGET_ID]);
    expect(read.note).toContain("planner.quick-task");
  });

  it("shows a widget whose manifest registered it", () => {
    const known = new Set([...hostWidgetIds(), "planner.quick-task"]);
    const read = parseDashboard(layout(["planner.quick-task"]), known);
    expect(read.layout.widgets).toEqual([{ id: "planner.quick-task", size: "full" }]);
    expect(read.note).toBeNull();
  });

  it("shows a repeated widget once", () => {
    const read = parseDashboard(layout([APPS_WIDGET_ID, APPS_WIDGET_ID]));
    expect(read.layout.widgets).toHaveLength(1);
    expect(read.note).toContain("repeated");
  });

  it("falls back when nothing in the file can be shown", () => {
    const read = parseDashboard(layout(["planner.quick-task", "budget.spending"]));
    expect(read.layout).toEqual(DEFAULT_DASHBOARD);
    expect(read.note).toContain("no widget this build can show");
  });

  it("keeps a stored size the widget still offers", () => {
    const read = parseDashboard(layout([RECENTS_WIDGET_ID], "1x1"));
    expect(read.layout.widgets[0]?.size).toBe("1x1");
  });

  it("uses the widget's default when the stored size is no longer offered", () => {
    const read = parseDashboard(layout([APPS_WIDGET_ID], "1x1"));
    expect(read.layout.widgets[0]?.size).toBe("full");
    expect(read.note).toBeNull();
  });
});

describe("moveWidget", () => {
  const two = layout([APPS_WIDGET_ID, RECENTS_WIDGET_ID]);

  it("moves a widget one place later", () => {
    const next = moveWidget(two, APPS_WIDGET_ID, "later");
    expect(next.widgets.map((widget) => widget.id)).toEqual([RECENTS_WIDGET_ID, APPS_WIDGET_ID]);
  });

  it("moves a widget one place earlier", () => {
    const next = moveWidget(two, RECENTS_WIDGET_ID, "earlier");
    expect(next.widgets.map((widget) => widget.id)).toEqual([RECENTS_WIDGET_ID, APPS_WIDGET_ID]);
  });

  it("does nothing at either end", () => {
    expect(moveWidget(two, APPS_WIDGET_ID, "earlier")).toBe(two);
    expect(moveWidget(two, RECENTS_WIDGET_ID, "later")).toBe(two);
  });

  it("does nothing for an id that is not on the dashboard", () => {
    expect(moveWidget(two, "planner.quick-task", "later")).toBe(two);
  });

  it("does not mutate the layout it was given", () => {
    moveWidget(two, APPS_WIDGET_ID, "later");
    expect(two.widgets.map((widget) => widget.id)).toEqual([APPS_WIDGET_ID, RECENTS_WIDGET_ID]);
  });
});

describe("resizeWidget", () => {
  const sizes = HOST_WIDGETS.find((widget) => widget.id === RECENTS_WIDGET_ID)?.sizes ?? [];

  it("places a widget at a class it offers", () => {
    expect(
      resizeWidget(layout([RECENTS_WIDGET_ID]), RECENTS_WIDGET_ID, "1x1", sizes).widgets[0]?.size,
    ).toBe("1x1");
  });

  it("refuses a class the widget does not offer", () => {
    const current = layout([RECENTS_WIDGET_ID]);
    expect(resizeWidget(current, RECENTS_WIDGET_ID, "full", [])).toBe(current);
  });

  it("refuses an id that is not on the dashboard", () => {
    const current = layout([APPS_WIDGET_ID]);
    expect(resizeWidget(current, RECENTS_WIDGET_ID, "1x1", sizes)).toBe(current);
  });
});

describe("addWidget and removeWidget", () => {
  it("adds a host widget at its declared default size", () => {
    const next = addWidget(layout([APPS_WIDGET_ID]), RECENTS_WIDGET_ID);
    expect(next.widgets.map((widget) => [widget.id, widget.size])).toEqual([
      [APPS_WIDGET_ID, "full"],
      [RECENTS_WIDGET_ID, "2x1"],
    ]);
  });

  it("does not add the same widget twice", () => {
    const current = layout([APPS_WIDGET_ID]);
    expect(addWidget(current, APPS_WIDGET_ID)).toBe(current);
  });

  it("does not add an id the host does not provide", () => {
    const current = layout([APPS_WIDGET_ID]);
    expect(addWidget(current, "planner.quick-task")).toBe(current);
  });

  it("removes a widget", () => {
    const next = removeWidget(layout([APPS_WIDGET_ID, RECENTS_WIDGET_ID]), RECENTS_WIDGET_ID);
    expect(next.widgets.map((widget) => widget.id)).toEqual([APPS_WIDGET_ID]);
  });

  it("refuses to remove the last widget", () => {
    const current = layout([APPS_WIDGET_ID]);
    expect(removeWidget(current, APPS_WIDGET_ID)).toBe(current);
  });
});

describe("serializeDashboard", () => {
  it("writes the shape the parser reads", () => {
    const text = serializeDashboard(layout([RECENTS_WIDGET_ID], "1x1"));
    expect(text.endsWith("\n")).toBe(true);
    const read = parseDashboard(JSON.parse(text));
    expect(read.layout.widgets).toEqual([{ id: RECENTS_WIDGET_ID, size: "1x1" }]);
    expect(read.note).toBeNull();
  });
});
