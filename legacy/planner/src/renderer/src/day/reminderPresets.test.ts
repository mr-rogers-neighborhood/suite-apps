import type { Task } from "@suite/planner-core";
import { describe, expect, it } from "vitest";

import {
  eveningReminder,
  inMinutes,
  reminderLabel,
  reminderPending,
  tomorrowMorning,
} from "./reminderPresets";

// Local-time constructors throughout: "this evening" is a wall-clock rule, and a UTC literal would
// make these assertions depend on the machine's zone.
const NOW = new Date(2026, 10, 20, 14, 0, 0);

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "a",
    title: "A task",
    projectId: null,
    tagIds: [],
    status: "inbox",
    scheduledFor: null,
    estimateMinutes: null,
    dueAt: null,
    remindAt: null,
    remindedAt: null,
    recurrence: null,
    recurrenceCompletions: [],
    priority: null,
    source: null,
    checklist: [],
    order: 0,
    createdAt: new Date(2026, 10, 20, 9, 0, 0).toISOString(),
    updatedAt: new Date(2026, 10, 20, 9, 0, 0).toISOString(),
    completedAt: null,
    notes: "",
    ...overrides,
  } as Task;
}

describe("reminder presets", () => {
  it("should put 'in 30 minutes' on the minute", () => {
    const at = inMinutes(30, NOW);

    expect(at.getTime() - NOW.getTime()).toBe(30 * 60_000);
    expect(at.getSeconds()).toBe(0);
  });

  it("should put this evening at 19:00 today while it is still ahead", () => {
    const at = eveningReminder(new Date(2026, 10, 20, 9, 0, 0));

    expect(at.getHours()).toBe(19);
    expect(at.getDate()).toBe(20);
  });

  it("should move this evening to tomorrow once it has passed", () => {
    const at = eveningReminder(new Date(2026, 10, 20, 21, 0, 0));

    expect(at.getHours()).toBe(19);
    expect(at.getDate()).toBe(21);
  });

  it("should find the first of next month at 19:00 once the last evening has passed", () => {
    const at = eveningReminder(new Date(2026, 0, 31, 21, 0, 0));

    expect(at.getMonth()).toBe(1);
    expect(at.getDate()).toBe(1);
    expect(at.getHours()).toBe(19);
  });

  it("should put tomorrow morning at 09:00 on the next day", () => {
    const at = tomorrowMorning(NOW);

    expect(at.getDate()).toBe(21);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(0);
  });

  it("should find the next month and the leap day at 09:00", () => {
    const nextMonth = tomorrowMorning(new Date(2026, 0, 31, 18, 0, 0));
    expect(nextMonth.getMonth()).toBe(1);
    expect(nextMonth.getDate()).toBe(1);
    expect(nextMonth.getHours()).toBe(9);

    const leapDay = tomorrowMorning(new Date(2028, 1, 28, 18, 0, 0));
    expect(leapDay.getMonth()).toBe(1);
    expect(leapDay.getDate()).toBe(29);
    expect(leapDay.getHours()).toBe(9);
  });

  it("should only call the following leap day tomorrow", () => {
    const leapMorning = new Date(2028, 1, 29, 9, 0, 0);
    const time = leapMorning.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

    expect(reminderLabel(leapMorning.toISOString(), new Date(2028, 1, 28, 18, 0, 0))).toBe(
      `tomorrow ${time}`,
    );
  });
});

describe("reminderLabel", () => {
  const time = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  it("should show only the time for today", () => {
    const at = new Date(2026, 10, 20, 16, 30, 0);

    expect(reminderLabel(at.toISOString(), NOW)).toBe(time(at));
  });

  it("should say tomorrow for the next day", () => {
    const at = tomorrowMorning(NOW);

    expect(reminderLabel(at.toISOString(), NOW)).toBe(`tomorrow ${time(at)}`);
  });

  it("should name the date for anything further out", () => {
    const at = new Date(2026, 10, 25, 16, 0, 0);

    expect(reminderLabel(at.toISOString(), NOW)).toBe(
      `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time(at)}`,
    );
  });

  it("should fall back to a word rather than an invalid date", () => {
    expect(reminderLabel("not a time", NOW)).toBe("reminder");
  });
});

describe("reminderPending", () => {
  const future = () => new Date(NOW.getTime() + 2 * 60 * 60_000).toISOString();
  const past = () => new Date(NOW.getTime() - 2 * 60 * 60_000).toISOString();

  it("should count a future reminder on an open task", () => {
    expect(reminderPending(task({ remindAt: future() }), NOW)).toBe(true);
  });

  it("should ignore one that already fired", () => {
    expect(reminderPending(task({ remindAt: future(), remindedAt: future() }), NOW)).toBe(false);
  });

  it("should ignore one on a done task", () => {
    expect(reminderPending(task({ remindAt: future(), status: "done" }), NOW)).toBe(false);
  });

  it("should ignore a time in the past, and a task with none", () => {
    expect(reminderPending(task({ remindAt: past() }), NOW)).toBe(false);
    expect(reminderPending(task(), NOW)).toBe(false);
  });
});
