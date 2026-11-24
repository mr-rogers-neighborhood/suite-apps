import { WorkspaceDocument } from "@suite/planner-core";
import { describe, expect, it } from "vitest";
import { projectReminders, reminderLink, taskIdFromLaunch } from "./projection";

const NOW = new Date("2026-11-24T09:00:00.000Z");
const LATER = "2026-11-24T10:00:00.000Z";
const SOON = "2026-11-24T09:30:00.000Z";

describe("Planner's reminder projection", () => {
  it("returns display rows for pending reminders, not the document", () => {
    const doc = WorkspaceDocument.create({ now: NOW });
    const project = doc.createProject({ name: "Ship the pack" }, NOW);
    const soon = doc.createTask(
      { title: "Draft the plan", projectId: project.id, remindAt: SOON },
      NOW,
    );
    const later = doc.createTask({ title: "Send it", remindAt: LATER }, NOW);

    const rows = projectReminders(doc.snapshot(), { packId: "planner", now: NOW });

    expect(rows).toEqual([
      {
        id: soon.id,
        title: "Draft the plan",
        body: "Ship the pack",
        at: Date.parse(SOON),
        deepLink: `suite://planner/task/${soon.id}`,
      },
      {
        id: later.id,
        title: "Send it",
        body: "",
        at: Date.parse(LATER),
        deepLink: `suite://planner/task/${later.id}`,
      },
    ]);
  });

  it("leaves out a done task, a fired reminder, a past time and a disabled setting", () => {
    const doc = WorkspaceDocument.create({ now: NOW });
    const done = doc.createTask({ title: "Done", remindAt: LATER }, NOW);
    doc.completeTask(done.id, null, NOW);
    const fired = doc.createTask({ title: "Fired", remindAt: LATER }, NOW);
    doc.updateTask(fired.id, { remindedAt: NOW.toISOString() }, NOW);
    doc.createTask({ title: "Past", remindAt: "2026-11-24T08:00:00.000Z" }, NOW);
    doc.createTask({ title: "No time" }, NOW);

    expect(projectReminders(doc.snapshot(), { packId: "planner", now: NOW })).toEqual([]);

    const disabled = WorkspaceDocument.create({ now: NOW });
    disabled.createTask({ title: "Off", remindAt: LATER }, NOW);
    disabled.updateSettings({ remindersEnabled: false });

    expect(projectReminders(disabled.snapshot(), { packId: "planner", now: NOW })).toEqual([]);
  });

  it("is idempotent for the same snapshot and instant", () => {
    const doc = WorkspaceDocument.create({ now: NOW });
    doc.createTask({ title: "One", remindAt: LATER }, NOW);
    const bytes = doc.snapshot();

    const first = projectReminders(bytes, { packId: "planner", now: NOW });
    const second = projectReminders(bytes, { packId: "planner", now: NOW });

    expect(second).toEqual(first);
  });

  it("round-trips the deep link the host routes back to the pack", () => {
    const link = reminderLink("planner", "task with spaces");
    expect(taskIdFromLaunch(link, "planner")).toBe("task with spaces");
    expect(taskIdFromLaunch(link, "canvas")).toBeNull();
    expect(taskIdFromLaunch("https://planner/task/x", "planner")).toBeNull();
  });

  it("projects a large workspace in a linear pass, not a graph walk", () => {
    const doc = WorkspaceDocument.create({ now: NOW });
    const count = 500;
    for (let index = 0; index < count; index += 1) {
      doc.createTask(
        {
          title: `Task ${index}`,
          remindAt: new Date(NOW.getTime() + (index + 1) * 60_000).toISOString(),
        },
        NOW,
      );
    }
    const bytes = doc.snapshot();

    const started = performance.now();
    const rows = projectReminders(bytes, { packId: "planner", now: NOW });
    const elapsed = performance.now() - started;

    console.info(
      `reminder projection: ${rows.length} rows from ${count} tasks in ${elapsed.toFixed(1)} ms`,
    );
    expect(rows).toHaveLength(count);
    // Generous for CI: the point is that one pass over a few hundred tasks is
    // milliseconds, not that this machine is the fastest.
    expect(elapsed).toBeLessThan(500);
  });
});
