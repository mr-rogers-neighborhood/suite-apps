import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { ScreenDocument } from "./document.js";
import { isScreenRow, type Screen, type ScreenEntry, screenEntryRegistryIds } from "./screen.js";

function entryIds(entries: readonly ScreenEntry[]): string[] {
  return entries.flatMap(screenEntryRegistryIds);
}

function entryId(entry: ScreenEntry | undefined): string | undefined {
  return entry === undefined || isScreenRow(entry) ? undefined : entry.registryId;
}

const initial: Screen = {
  format: "suite.screen",
  version: 2,
  id: "home",
  name: "Home",
  widgets: [
    { registryId: "desk.apps", size: "full" },
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
    expect(document.add({ registryId: "budget.saved-views", size: "2x1" })).toBe(true);
    expect(entryId(document.state().widgets.at(-1))).toBe("budget.saved-views");

    expect(
      document.add({ registryId: "canvas.recent-cards", size: "1x1" }, { before: "desk.apps" }),
    ).toBe(true);
    expect(entryId(document.state().widgets[0])).toBe("canvas.recent-cards");

    expect(document.add({ registryId: "budget.month", size: "full" }, { after: "desk.apps" })).toBe(
      true,
    );
    expect(entryIds(document.state().widgets)).toEqual([
      "canvas.recent-cards",
      "desk.apps",
      "budget.month",
      "planner.quick-task",
      "future.unknown-widget",
      "budget.saved-views",
    ]);
  });

  it("refuses a duplicate instance and an unknown placement anchor", () => {
    const document = ScreenDocument.create(initial);
    expect(document.add({ registryId: "desk.apps", size: "1x1" })).toBe(false);
    expect(
      document.add({ registryId: "canvas.recent-cards", size: "1x1" }, { before: "nothing.here" }),
    ).toBe(false);
    expect(document.add({ registryId: "not-a-registry", size: "1x1" })).toBe(false);
  });

  it("moves an instance before and after another", () => {
    const document = ScreenDocument.create(initial);
    expect(document.move("future.unknown-widget", { before: "desk.apps" })).toBe(true);
    expect(entryIds(document.state().widgets)).toEqual([
      "future.unknown-widget",
      "desk.apps",
      "planner.quick-task",
    ]);
    expect(document.move("desk.apps", { after: "planner.quick-task" })).toBe(true);
    expect(entryIds(document.state().widgets)).toEqual([
      "future.unknown-widget",
      "planner.quick-task",
      "desk.apps",
    ]);
  });

  it("does not move to an unknown anchor", () => {
    const document = ScreenDocument.create(initial);
    expect(document.move("desk.apps", { after: "nothing.here" })).toBe(false);
  });

  it("removes an instance and keeps the rest in order", () => {
    const document = ScreenDocument.create(initial);
    expect(document.remove("planner.quick-task")).toBe(true);
    expect(entryIds(document.state().widgets)).toEqual(["desk.apps", "future.unknown-widget"]);
    expect(document.remove("planner.quick-task")).toBe(false);
  });

  it("resizes an instance and refuses an unknown size", () => {
    const document = ScreenDocument.create(initial);
    expect(document.resize("desk.apps", "1x1")).toBe(true);
    expect(document.state().widgets[0]?.size).toBe("1x1");
    // The type refuses this at compile time; a stored file can still ask at runtime.
    expect(document.resize("desk.apps", "3x1" as never)).toBe(false);
    expect(document.resize("nothing.here", "1x1")).toBe(false);
  });

  it("sets and clears a setting without losing the unknown one", () => {
    const document = ScreenDocument.create(initial);
    expect(document.setSetting("planner.quick-task", "project", "beta")).toBe(true);
    expect(document.settings("planner.quick-task")).toEqual({ project: "beta" });

    expect(document.setSetting("planner.quick-task", "future-setting", "new")).toBe(true);
    expect(document.settings("planner.quick-task")).toEqual({
      project: "beta",
      "future-setting": "new",
    });

    expect(document.clearSetting("planner.quick-task", "project")).toBe(true);
    expect(document.settings("planner.quick-task")).toEqual({ "future-setting": "new" });
    expect(document.clearSetting("planner.quick-task", "project")).toBe(false);
    expect(document.setSetting("planner.quick-task", "bad field", "x")).toBe(false);
    expect(document.setSetting("nothing.here", "project", "x")).toBe(false);
  });

  it("reports no settings after the last one is cleared", () => {
    const document = ScreenDocument.create(initial);
    expect(document.clearSetting("planner.quick-task", "project")).toBe(true);
    expect(document.settings("planner.quick-task")).toEqual({});
  });

  it("round-trips a snapshot with unknown widgets and settings intact", () => {
    const document = ScreenDocument.create(initial);
    document.resize("desk.apps", "2x1");
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
    header.set("version", 3);
    header.set("id", "home");
    header.set("name", "Home");
    doc.getList("order").push("desk.apps");
    doc.getMap("widgets").ensureMergeableMap("desk.apps").set("size", "full");
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

  it("adds a row and round-trips its children, weights and settings", () => {
    const document = ScreenDocument.create(initial);
    expect(
      document.addRow({
        kind: "row",
        size: "full",
        layout: "row",
        items: [
          { registryId: "welcome.notes", weight: 2, settings: { project: "work" } },
          { registryId: "budget.saved-views", weight: 1 },
        ],
      }),
    ).toBe(true);

    const row = document.state().widgets.at(-1);
    expect(row !== undefined && isScreenRow(row)).toBe(true);
    if (row === undefined || !isScreenRow(row)) return;
    expect(row.items).toEqual([
      { registryId: "welcome.notes", weight: 2, settings: { project: "work" } },
      { registryId: "budget.saved-views", weight: 1 },
    ]);

    const reopened = ScreenDocument.open(document.export());
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.document.state()).toEqual(document.state());
  });

  it("refuses a duplicate row child or a nested row", () => {
    const document = ScreenDocument.create(initial);
    expect(
      document.addRow({
        kind: "row",
        size: "full",
        layout: "row",
        items: [
          { registryId: "desk.apps", weight: 1 },
          { registryId: "budget.saved-views", weight: 1 },
        ],
      }),
    ).toBe(false);

    expect(
      document.addRow({
        kind: "row",
        size: "full",
        layout: "row",
        items: [
          { registryId: "budget.month", weight: 1 },
          { registryId: "budget.saved-views", weight: 1 },
        ],
      }),
    ).toBe(true);

    expect(
      document.addRow({
        kind: "row",
        size: "full",
        layout: "row",
        items: [{ registryId: "canvas.recent-cards", weight: 1 }],
      }),
    ).toBe(false);
  });

  it("moves a flat widget one entry earlier or later with moveBy", () => {
    const document = ScreenDocument.create(initial);
    document.addRow({
      kind: "row",
      size: "full",
      layout: "row",
      items: [
        { registryId: "welcome.notes", weight: 2 },
        { registryId: "budget.saved-views", weight: 1 },
      ],
    });
    expect(document.add({ registryId: "canvas.recent-cards", size: "1x1" })).toBe(true);

    expect(document.moveBy("canvas.recent-cards", "earlier")).toBe(true);
    expect(entryIds(document.state().widgets)).toEqual([
      "desk.apps",
      "planner.quick-task",
      "future.unknown-widget",
      "canvas.recent-cards",
      "welcome.notes",
      "budget.saved-views",
    ]);
    expect(document.moveBy("canvas.recent-cards", "earlier")).toBe(true);
    expect(entryIds(document.state().widgets).at(-1)).toBe("budget.saved-views");
  });

  it("keeps a row when a flat widget is added, moved or resized", () => {
    const document = ScreenDocument.create(initial);
    document.addRow({
      kind: "row",
      size: "full",
      layout: "row",
      items: [
        { registryId: "welcome.notes", weight: 2 },
        { registryId: "budget.saved-views", weight: 1 },
      ],
    });

    expect(document.add({ registryId: "canvas.recent-cards", size: "1x1" })).toBe(true);
    expect(document.move("canvas.recent-cards", { before: "desk.apps" })).toBe(true);
    expect(document.resize("desk.apps", "1x1")).toBe(true);

    const row = document.state().widgets.find((entry) => isScreenRow(entry));
    expect(row).toBeDefined();
    if (row === undefined || !isScreenRow(row)) return;
    expect(row.items.map((item) => item.registryId)).toEqual([
      "welcome.notes",
      "budget.saved-views",
    ]);
  });

  it("keeps unknown settings on a row child across a snapshot", () => {
    const document = ScreenDocument.create({
      ...initial,
      widgets: [
        {
          kind: "row",
          size: "full",
          layout: "row",
          items: [
            { registryId: "ghost.notes", weight: 1, settings: { "future-setting": "kept" } },
            { registryId: "welcome.notes", weight: 1 },
          ],
        },
      ],
    });

    const reopened = ScreenDocument.open(document.export());
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.document.settings("ghost.notes")).toEqual({ "future-setting": "kept" });
  });
});
