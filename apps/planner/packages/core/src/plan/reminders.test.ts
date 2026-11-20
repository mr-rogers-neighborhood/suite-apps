import { describe, expect, it } from "vitest";
import type { Task } from "../schema";
import { pendingReminders } from "./reminders";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: "A task",
    status: "inbox",
    scheduledFor: null,
    remindAt: null,
    remindedAt: null,
    ...overrides,
  } as Task;
}

describe("pendingReminders", () => {
  it("should keep a future reminder and turn its time into epoch milliseconds", () => {
    const reminders = pendingReminders(
      [task({ id: "a", remindAt: "2026-11-20T13:00:00.000Z" })],
      NOW,
    );

    expect(reminders).toEqual([
      { id: "a", title: "A task", at: Date.parse("2026-11-20T13:00:00.000Z") },
    ]);
  });

  it("should drop one that already fired, is done, or has no time", () => {
    const reminders = pendingReminders(
      [
        task({
          id: "fired",
          remindAt: "2026-11-20T13:00:00.000Z",
          remindedAt: "2026-11-20T13:00:01.000Z",
        }),
        task({ id: "done", status: "done", remindAt: "2026-11-20T13:00:00.000Z" }),
        task({ id: "none" }),
      ],
      NOW,
    );

    expect(reminders).toEqual([]);
  });

  it("should drop a time in the past rather than fire it on the next launch", () => {
    const reminders = pendingReminders(
      [task({ id: "old", remindAt: "2026-11-20T09:00:00.000Z" })],
      NOW,
    );

    expect(reminders).toEqual([]);
  });

  it("should order the soonest first", () => {
    const reminders = pendingReminders(
      [
        task({ id: "late", remindAt: "2026-11-20T18:00:00.000Z" }),
        task({ id: "soon", remindAt: "2026-11-20T12:30:00.000Z" }),
      ],
      NOW,
    );

    expect(reminders.map((reminder) => reminder.id)).toEqual(["soon", "late"]);
  });

  it("should ignore a timestamp that does not parse", () => {
    const reminders = pendingReminders([task({ id: "bad", remindAt: "not a time" })], NOW);

    expect(reminders).toEqual([]);
  });
});
