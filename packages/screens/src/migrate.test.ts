import { describe, expect, it } from "vitest";
import dashboardFixture from "./fixtures/start-dashboard.json" with { type: "json" };
import {
  defaultStartDashboard,
  migrateStartDashboard,
  migrateStartDashboardJson,
  START_HOME_SCREEN_ID,
  START_HOME_SCREEN_NAME,
} from "./migrate.js";

describe("Start's dashboard migration", () => {
  it("migrates a realistic dashboard file whole", () => {
    const migrated = migrateStartDashboard(dashboardFixture);
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.screen.format).toBe("suite.screen");
    expect(migrated.screen.version).toBe(1);
    expect(migrated.screen.id).toBe(START_HOME_SCREEN_ID);
    expect(migrated.screen.name).toBe(START_HOME_SCREEN_NAME);
    expect(migrated.screen.widgets).toEqual([
      { registryId: "start.apps", size: "full" },
      { registryId: "start.recents", size: "2x1" },
      // A widget this build cannot resolve is kept, not dropped.
      { registryId: "planner.quick-task", size: "1x1" },
    ]);
  });

  it("migrates the same value from its JSON text", () => {
    const migrated = migrateStartDashboardJson(JSON.stringify(dashboardFixture));
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.screen.widgets).toHaveLength(3);
  });

  it("refuses text that is not JSON at all", () => {
    const migrated = migrateStartDashboardJson("{not json");
    expect(migrated.ok).toBe(false);
    if (migrated.ok) return;
    expect(migrated.reason).toBe("corrupt");
    expect(migrated.message).toContain("not migrated");
    expect(migrated.message).toContain("unchanged");
  });

  it("refuses another format", () => {
    const migrated = migrateStartDashboard({
      format: "suite.screen",
      version: 1,
      widgets: [],
    });
    expect(migrated.ok).toBe(false);
  });

  it("refuses a newer dashboard rather than guessing", () => {
    const migrated = migrateStartDashboard({ ...dashboardFixture, version: 2 });
    expect(migrated.ok).toBe(false);
    if (migrated.ok) return;
    expect(migrated.reason).toBe("newer");
    expect(migrated.message).toContain("newer Start");
    expect(migrated.message).toContain("unchanged");
  });

  it.each([
    ["no widgets array", { format: "suite.start.dashboard", version: 1 }],
    [
      "an entry with no id",
      { format: "suite.start.dashboard", version: 1, widgets: [{ size: "full" }] },
    ],
    [
      "an unknown size",
      {
        format: "suite.start.dashboard",
        version: 1,
        widgets: [{ id: "start.apps", size: "3x1" }],
      },
    ],
    [
      "a repeated id",
      {
        format: "suite.start.dashboard",
        version: 1,
        widgets: [
          { id: "start.apps", size: "full" },
          { id: "start.apps", size: "1x1" },
        ],
      },
    ],
    [
      "an id that is not <app>.<widget>",
      { format: "suite.start.dashboard", version: 1, widgets: [{ id: "apps", size: "full" }] },
    ],
  ])("refuses %s", (_name, value) => {
    const migrated = migrateStartDashboard(value);
    expect(migrated.ok).toBe(false);
    if (migrated.ok) return;
    expect(migrated.reason).toBe("corrupt");
    expect(migrated.message).toContain("not migrated");
  });

  it("refuses an empty dashboard instead of producing a blank Home", () => {
    const migrated = migrateStartDashboard({
      format: "suite.start.dashboard",
      version: 1,
      widgets: [],
    });
    expect(migrated.ok).toBe(false);
    if (migrated.ok) return;
    expect(migrated.reason).toBe("empty");
  });

  it("never half-migrates: a refusal has no screen", () => {
    const migrated = migrateStartDashboard({ format: "suite.start.dashboard", version: 1 });
    expect("screen" in migrated).toBe(false);
  });

  it("has a default dashboard with the host app grid", () => {
    const fallback = defaultStartDashboard();
    expect(fallback.screen.widgets).toEqual([{ registryId: "start.apps", size: "full" }]);
  });
});
