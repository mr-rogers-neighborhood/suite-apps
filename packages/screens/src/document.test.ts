import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { ScreenDocument } from "./document.js";
import type { Screen } from "./screen.js";

const initial: Screen = {
  format: "suite.screen",
  version: 1,
  id: "home",
  name: "Home",
  widgets: [
    { registryId: "start.apps", size: "full" },
    {
      registryId: "planner.quick-task",
      size: "2x1",
      settings: { project: "inbox" },
    },
    { registryId: "future.unknown-widget", size: "1x1", settings: { "future-setting": "kept" } },
  ],
};

describe("ScreenDocument", () => {
  it("creates a document whose state is the Screen", () => {
    const document = ScreenDocument.create(initial);
    expect(document.state()).toEqual(initial);
  });

  it("adds an instance at the end, before, and after", () => {
    const document = ScreenDocument.create(initial);
    expect(document.add({ registryId: "start.recents", size: "2x1" })).toBe(true);
    expect(document.state().widgets.at(-1)?.registryId).toBe("start.recents");

    expect(
      document.add({ registryId: "canvas.recent-cards", size: "1x1" }, { before: "start.apps" }),
    ).toBe(true);
    expect(document.state().widgets[0]?.registryId).toBe("canvas.recent-cards");

    expect(
      document.add({ registryId: "budget.month", size: "full" }, { after: "start.apps" }),
    ).toBe(true);
    expect(document.state().widgets.map((widget) => widget.registryId)).toEqual([
      "canvas.recent-cards",
      "start.apps",
      "budget.month",
      "planner.quick-task",
      "future.unknown-widget",
      "start.recents",
    ]);
  });

  it("refuses a duplicate instance and an unknown placement anchor", () => {
    const document = ScreenDocument.create(initial);
    expect(document.add({ registryId: "start.apps", size: "1x1" })).toBe(false);
    expect(
      document.add({ registryId: "start.recents", size: "1x1" }, { before: "nothing.here" }),
    ).toBe(false);
    expect(document.add({ registryId: "not-a-registry", size: "1x1" })).toBe(false);
  });

  it("moves an instance before and after another", () => {
    const document = ScreenDocument.create(initial);
    expect(document.move("future.unknown-widget", { before: "start.apps" })).toBe(true);
    expect(document.state().widgets.map((widget) => widget.registryId)).toEqual([
      "future.unknown-widget",
      "start.apps",
      "planner.quick-task",
    ]);
    expect(document.move("start.apps", { after: "planner.quick-task" })).toBe(true);
    expect(document.state().widgets.map((widget) => widget.registryId)).toEqual([
      "future.unknown-widget",
      "planner.quick-task",
      "start.apps",
    ]);
  });

  it("does not move to an unknown anchor", () => {
    const document = ScreenDocument.create(initial);
    expect(document.move("start.apps", { after: "nothing.here" })).toBe(false);
  });

  it("removes an instance and keeps the rest in order", () => {
    const document = ScreenDocument.create(initial);
    expect(document.remove("planner.quick-task")).toBe(true);
    expect(document.state().widgets.map((widget) => widget.registryId)).toEqual([
      "start.apps",
      "future.unknown-widget",
    ]);
    expect(document.remove("planner.quick-task")).toBe(false);
  });

  it("resizes an instance and refuses an unknown size", () => {
    const document = ScreenDocument.create(initial);
    expect(document.resize("start.apps", "1x1")).toBe(true);
    expect(document.state().widgets[0]?.size).toBe("1x1");
    // The type refuses this at compile time; a stored file can still ask at runtime.
    expect(document.resize("start.apps", "3x1" as never)).toBe(false);
    expect(document.resize("nothing.here", "1x1")).toBe(false);
  });

  it("sets and clears a setting without losing the unknown one", () => {
    const document = ScreenDocument.create(initial);
    expect(document.setSetting("planner.quick-task", "project", "beta")).toBe(true);
    expect(document.settings("planner.quick-task")).toEqual({ project: "beta" });

    expect(document.setSetting("planner.quick-task", "future-setting", "new")).toBe(true);
    expect(document.state().widgets[1]?.settings).toEqual({
      project: "beta",
      "future-setting": "new",
    });

    expect(document.clearSetting("planner.quick-task", "project")).toBe(true);
    expect(document.settings("planner.quick-task")).toEqual({ "future-setting": "new" });
    expect(document.clearSetting("planner.quick-task", "project")).toBe(false);
    expect(document.setSetting("planner.quick-task", "bad field", "x")).toBe(false);
    expect(document.setSetting("nothing.here", "project", "x")).toBe(false);
  });

  it("drops the settings map when the last setting is cleared", () => {
    const document = ScreenDocument.create(initial);
    expect(document.clearSetting("planner.quick-task", "project")).toBe(true);
    expect(document.state().widgets[1]?.settings).toBeUndefined();
  });

  it("round-trips a snapshot with unknown widgets and settings intact", () => {
    const document = ScreenDocument.create(initial);
    document.resize("start.apps", "2x1");
    const opened = ScreenDocument.open(document.export());
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.document.state()).toEqual(document.state());
    expect(opened.document.state().widgets[2]).toEqual({
      registryId: "future.unknown-widget",
      size: "1x1",
      settings: { "future-setting": "kept" },
    });
  });

  it("refuses bytes that are not a snapshot", () => {
    const opened = ScreenDocument.open(new Uint8Array([1, 2, 3]));
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.reason).toBe("corrupt");
    expect(opened.message).toContain("left alone");
  });

  it("refuses a snapshot written by a newer Suite", () => {
    const doc = new LoroDoc();
    const header = doc.getMap("screen");
    header.set("format", "suite.screen");
    header.set("version", 2);
    header.set("id", "home");
    header.set("name", "Home");
    doc.getList("order").push("start.apps");
    doc.getMap("widgets").ensureMergeableMap("start.apps").set("size", "full");
    doc.commit();

    const opened = ScreenDocument.open(doc.export({ mode: "snapshot" }));
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.reason).toBe("newer");
  });

  it("creates from JSON and refuses JSON that is not a Screen", () => {
    const created = ScreenDocument.fromJson(initial);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.document.state()).toEqual(initial);

    const refused = ScreenDocument.fromJson({ format: "suite.screen", version: 1 });
    expect(refused.ok).toBe(false);
  });
});
