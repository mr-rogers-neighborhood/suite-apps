import { describe, expect, it } from "vitest";
import { flattenScreenEntries, screenLayout } from "./layout.js";
import type { Screen } from "./screen.js";

const screen: Screen = {
  format: "suite.screen",
  version: 3,
  id: "work",
  name: "Work",
  widgets: [
    { registryId: "desk.apps", size: "full", x: 0, y: 0 },
    {
      kind: "row",
      size: "2x1",
      x: 0,
      y: 1,
      layout: "row",
      items: [
        { registryId: "planner.quick-task", weight: 2, settings: { project: "work" } },
        { registryId: "budget.saved-views", weight: 1 },
      ],
    },
    { registryId: "canvas.recent-cards", size: "1x1", x: 2, y: 1 },
    {
      kind: "row",
      size: "full",
      x: 0,
      y: 2,
      layout: "carousel",
      items: [
        { registryId: "ghost.notes", weight: 1 },
        { registryId: "welcome.notes", weight: 1 },
      ],
    },
  ],
};

describe("the Screen layout", () => {
  it("orders by the grid and computes row weights on a wide window", () => {
    const layout = screenLayout(screen, { width: 1200 });

    expect(layout.narrow).toBe(false);
    expect(layout.columns).toBe(4);
    expect(layout.entries.map((entry) => entry.kind)).toEqual(["widget", "row", "widget", "row"]);
    expect(layout.entries.map((entry) => entry.index)).toEqual([0, 1, 2, 3]);
    expect(layout.entries.map((entry) => [entry.x, entry.y, entry.w, entry.h])).toEqual([
      [0, 0, 4, 1],
      [0, 1, 2, 1],
      [2, 1, 1, 1],
      [0, 2, 4, 1],
    ]);

    const row = layout.entries[1];
    expect(row).toMatchObject({ kind: "row", mode: "wrap", size: "2x1" });
    if (row?.kind !== "row") return;
    expect(row.items).toEqual([
      {
        registryId: "planner.quick-task",
        weight: 2,
        basis: "66.6667%",
      },
      {
        registryId: "budget.saved-views",
        weight: 1,
        basis: "33.3333%",
      },
    ]);
  });

  it("turns every row into a scrolling line on a phone instead of squeezing it", () => {
    const layout = screenLayout(screen, { width: 390 });

    expect(layout.narrow).toBe(true);
    expect(layout.columns).toBe(1);
    expect(layout.entries.map((entry) => entry.kind)).toEqual(["widget", "row", "widget", "row"]);
    for (const entry of layout.entries) {
      expect(entry).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
      if (entry.kind === "widget") expect(entry.span).toBe(1);
      else expect(entry.mode).toBe("scroll");
    }
  });

  it("keeps a carousel scrolling at every width", () => {
    const carousel = screenLayout(screen, { width: 1400 }).entries[3];
    expect(carousel).toMatchObject({ kind: "row", mode: "scroll" });
  });

  it("spans a wide widget by its size class and a narrow one by one column", () => {
    const wide = screenLayout(screen, { width: 1200 });
    expect(wide.entries[0]).toMatchObject({ kind: "widget", size: "full", span: 4, w: 4 });
    expect(wide.entries[2]).toMatchObject({ kind: "widget", size: "1x1", span: 1, w: 1 });

    const narrow = screenLayout(screen, { width: 600 });
    expect(narrow.entries[0]).toMatchObject({ kind: "widget", span: 1, w: 1 });
    expect(narrow.entries[2]).toMatchObject({ kind: "widget", span: 1, w: 1 });
  });

  it("lays out by coordinates, not by the order the entries were written", () => {
    const moved: Screen = {
      ...screen,
      widgets: [
        { registryId: "desk.apps", size: "full", x: 0, y: 1 },
        { registryId: "canvas.recent-cards", size: "1x1", x: 0, y: 0 },
      ],
    };
    const layout = screenLayout(moved, { width: 1200 });
    expect(layout.entries.map((entry) => entry.index)).toEqual([1, 0]);
    expect(layout.entries[0]).toMatchObject({ kind: "widget", index: 1, y: 0 });
  });

  it("flattens a row for a host that cannot draw it, keeping order and settings", () => {
    expect(
      flattenScreenEntries(screen).map((entry) =>
        "registryId" in entry ? entry.registryId : "row",
      ),
    ).toEqual([
      "desk.apps",
      "planner.quick-task",
      "budget.saved-views",
      "canvas.recent-cards",
      "ghost.notes",
      "welcome.notes",
    ]);
    const child = flattenScreenEntries(screen)[1];
    expect(child).toEqual({
      registryId: "planner.quick-task",
      size: "2x1",
      settings: { project: "work" },
      x: 0,
      y: 1,
    });
  });

  it("does not mutate the Screen", () => {
    const before = JSON.parse(JSON.stringify(screen));
    screenLayout(screen, { width: 390 });
    expect(screen).toEqual(before);
  });
});
