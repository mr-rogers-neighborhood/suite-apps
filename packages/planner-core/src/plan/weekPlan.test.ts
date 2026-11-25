import { describe, expect, it } from "vitest";

import type { DayRecord, Task } from "../schema";
import { weekPlan } from "./weekPlan";

function task(overrides: Partial<Task>): Task {
  return {
    id: "task_1",
    title: "Task",
    projectId: null,
    tagIds: [],
    status: "planned",
    estimateMinutes: null,
    scheduledFor: null,
    order: 0,
    dueAt: null,
    remindAt: null,
    remindedAt: null,
    recurrence: null,
    recurrenceCompletions: [],
    priority: null,
    source: null,
    checklist: [],
    createdAt: "2026-11-16T09:00:00.000Z",
    updatedAt: "2026-11-16T09:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function dayRecord(dateKey: string, capacityMinutesOverride: number | null = null): DayRecord {
  return {
    dateKey,
    intention: "",
    shutdownNote: "",
    capacityMinutesOverride,
    plannedAt: null,
    shutdownAt: null,
  };
}

const base = {
  weekStartsOn: 1,
  dailyCapacityMinutes: 300,
  defaultEstimateMinutes: 30,
  days: [],
  today: "2026-11-18",
} as const;

describe("weekPlan", () => {
  it("should start the week on settings.weekStartsOn and return seven days", () => {
    const monday = weekPlan([], "2026-11-18", base);

    expect(monday.startDateKey).toBe("2026-11-16");
    expect(monday.endDateKey).toBe("2026-11-22");
    expect(monday.days.map((day) => day.dateKey)).toEqual([
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
    ]);
    expect(monday.days[2]?.isToday).toBe(true);

    const sunday = weekPlan([], "2026-11-18", { ...base, weekStartsOn: 0 });

    expect(sunday.startDateKey).toBe("2026-11-15");
    expect(sunday.endDateKey).toBe("2026-11-21");
  });

  it("should place tasks on their day and total capacity against per-day overrides", () => {
    const plan = weekPlan(
      [
        task({ id: "task_a", scheduledFor: "2026-11-16", estimateMinutes: 60 }),
        task({ id: "task_b", scheduledFor: "2026-11-18", estimateMinutes: 90 }),
        task({
          id: "task_done",
          scheduledFor: "2026-11-16",
          estimateMinutes: 45,
          status: "done",
          completedAt: "2026-11-16T15:00:00.000Z",
        }),
      ],
      "2026-11-18",
      { ...base, days: [dayRecord("2026-11-18", 120)] },
    );

    const monday = plan.days[0];
    const wednesday = plan.days[2];

    expect(monday?.plan.tasks.map((entry) => entry.task.id)).toEqual(["task_a"]);
    expect(monday?.capacity.plannedMinutes).toBe(60);
    expect(monday?.availableMinutes).toBe(300);

    expect(wednesday?.plan.tasks.map((entry) => entry.task.id)).toEqual(["task_b"]);
    expect(wednesday?.capacity.plannedMinutes).toBe(90);
    expect(wednesday?.availableMinutes).toBe(120);

    expect(plan.capacity.plannedMinutes).toBe(150);
    expect(plan.capacity.availableMinutes).toBe(1920);
    expect(plan.capacity.remainingMinutes).toBe(1770);
  });

  it("should span the end of a year without skipping or repeating a day", () => {
    const plan = weekPlan([], "2026-12-31", { ...base, today: "2026-12-31" });

    expect(plan.startDateKey).toBe("2026-12-28");
    expect(plan.endDateKey).toBe("2027-01-03");
    expect(plan.days.map((day) => day.dateKey)).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
    expect(plan.days[3]?.isToday).toBe(true);
  });

  it("should put a leap day in the middle of its week", () => {
    const plan = weekPlan([], "2028-02-29", { ...base, today: "2028-02-29" });

    expect(plan.startDateKey).toBe("2028-02-28");
    expect(plan.endDateKey).toBe("2028-03-05");
    expect(plan.days.map((day) => day.dateKey)).toContain("2028-02-29");
    expect(plan.days[1]?.isToday).toBe(true);
    expect(plan.days).toHaveLength(7);
  });

  it("should report unfinished work before today as carry-over without moving it", () => {
    const older = task({ id: "task_older", scheduledFor: "2026-11-10" });
    const recent = task({ id: "task_recent", scheduledFor: "2026-11-15" });
    const plan = weekPlan(
      [
        older,
        recent,
        task({
          id: "task_finished",
          scheduledFor: "2026-11-14",
          status: "done",
          completedAt: "2026-11-14T15:00:00.000Z",
        }),
        task({ id: "task_today", scheduledFor: "2026-11-18" }),
        task({
          id: "task_repeats",
          scheduledFor: "2026-11-10",
          recurrence: { frequency: "daily", interval: 1, weekdays: [], until: null },
        }),
      ],
      "2026-11-18",
      base,
    );

    expect(plan.carryOver.map((entry) => entry.id)).toEqual(["task_older", "task_recent"]);
    expect(plan.carryOver.map((entry) => entry.scheduledFor)).toEqual(["2026-11-10", "2026-11-15"]);
  });
});
