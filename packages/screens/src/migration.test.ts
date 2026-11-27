import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { ScreenDocument } from "./document.js";
import v1Fixture from "./fixtures/versions/v1.screen.json" with { type: "json" };
import v2Fixture from "./fixtures/versions/v2.screen.json" with { type: "json" };
import { migrateScreen, SCREEN_MIGRATIONS } from "./migration.js";
import { parseScreen, SUITE_SCREEN_VERSION } from "./screen.js";

function v1Snapshot(value: typeof v1Fixture): Uint8Array {
  const doc = new LoroDoc();
  const header = doc.getMap("screen");
  header.set("format", value.format);
  header.set("version", value.version);
  header.set("id", value.id);
  header.set("name", value.name);
  const order = doc.getList("order");
  const table = doc.getMap("widgets");
  for (const widget of value.widgets) {
    const entry = table.ensureMergeableMap(widget.registryId);
    entry.set("size", widget.size);
    for (const [key, setting] of Object.entries(widget.settings ?? {})) {
      entry.ensureMergeableMap("settings").set(key, setting);
    }
    order.push(widget.registryId);
  }
  doc.commit();
  return doc.export({ mode: "snapshot" });
}

describe("the Screen migration chain", () => {
  it("is contiguous from every old version to the current one", () => {
    let version = 1;
    while (version < SUITE_SCREEN_VERSION) {
      const step = SCREEN_MIGRATIONS.find((candidate) => candidate.from === version);
      expect(step, `a step from version ${version}`).toBeDefined();
      if (step === undefined) return;
      expect(step.to).toBeGreaterThan(step.from);
      version = step.to;
    }
    expect(version).toBe(SUITE_SCREEN_VERSION);
  });

  it("migrates the version-1 fixture without losing a placement or a setting", () => {
    const migrated = migrateScreen(v1Fixture);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.fromVersion).toBe(1);

    const parsed = parseScreen(migrated.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.version).toBe(3);
    expect(parsed.value.widgets).toEqual([
      { registryId: "desk.apps", size: "full", x: 0, y: 0 },
      {
        registryId: "planner.quick-task",
        size: "1x1",
        x: 0,
        y: 1,
        settings: { project: "inbox" },
      },
    ]);
  });

  it("migrates the version-2 fixture onto the four-cell grid", () => {
    const migrated = migrateScreen(v2Fixture);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.fromVersion).toBe(2);

    const parsed = parseScreen(migrated.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.version).toBe(3);
    expect(parsed.value.widgets).toEqual([
      { registryId: "desk.apps", size: "full", x: 0, y: 0 },
      { ...v2Fixture.widgets[1], x: 0, y: 1 },
    ]);
  });

  it("migrates a stored version-1 snapshot on open", () => {
    const opened = ScreenDocument.open(v1Snapshot(v1Fixture));
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.fromVersion).toBe(1);
    expect(opened.document.state().version).toBe(3);
    expect(opened.document.state()).toMatchObject({
      widgets: [
        { registryId: "desk.apps", size: "full", x: 0, y: 0 },
        {
          registryId: "planner.quick-task",
          size: "1x1",
          x: 0,
          y: 1,
          settings: { project: "inbox" },
        },
      ],
    });
  });

  it("migrates JSON through the same chain as a snapshot", () => {
    const created = ScreenDocument.fromJson(v1Fixture);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.fromVersion).toBe(1);
    expect(created.document.state().version).toBe(3);
  });

  it("fills the four-cell grid and wraps to the next row", () => {
    const migrated = migrateScreen({
      format: "suite.screen",
      version: 2,
      id: "wrap",
      name: "Wrap",
      widgets: Array.from({ length: 5 }, (_, index) => ({
        registryId: `ghost.note-${index}`,
        size: "1x1",
      })),
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    const parsed = parseScreen(migrated.value);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.widgets.map((entry) => [entry.x, entry.y])).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 1],
    ]);
  });

  it("refuses a version with no migration step and names the action", () => {
    const refused = migrateScreen({ format: "suite.screen", version: 0, id: "home" });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.message).toContain("Re-export");
  });

  it("refuses a newer version with a next action", () => {
    const refused = migrateScreen({
      format: "suite.screen",
      version: SUITE_SCREEN_VERSION + 1,
      id: "home",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.reason).toBe("newer");
    expect(refused.message).toContain("newer Suite Desk");
  });
});
