import { addDaysToKey, type DateKey, startOfWeekKey } from "../dates";
import type { DayRecord, Task } from "../schema";
import { type Capacity, capacityFor } from "./capacity";
import { type DayPlan, type DayTask, dayPlan } from "./dayPlan";

export type WeekDay = {
  dateKey: DateKey;
  availableMinutes: number;
  isToday: boolean;
  plan: DayPlan;
  capacity: Capacity;
};

export type WeekPlan = {
  startDateKey: DateKey;
  endDateKey: DateKey;
  days: WeekDay[];
  /** Unfinished, non-recurring tasks scheduled before today, in their original plan. */
  carryOver: Task[];
  /** The seven days together: planned minutes against their combined capacity. */
  capacity: Capacity;
};

export type WeekPlanOptions = {
  weekStartsOn: number;
  dailyCapacityMinutes: number;
  defaultEstimateMinutes: number;
  days: readonly DayRecord[];
  today: DateKey;
};

const DAYS_IN_WEEK = 7;

/**
 * Project a week of days from the tasks that point at them.
 *
 * A week is seven day plans sharing one start, so the same task and capacity rules apply as the
 * day view. Carry-over is the day view's overdue list: it is reported, never rescheduled.
 */
export function weekPlan(
  tasks: readonly Task[],
  dateKey: DateKey,
  options: WeekPlanOptions,
): WeekPlan {
  const startDateKey = startOfWeekKey(dateKey, options.weekStartsOn);
  const records = new Map(options.days.map((record) => [record.dateKey, record]));
  const days: WeekDay[] = [];
  const scheduled: Array<DayTask["task"]> = [];
  let availableMinutes = 0;

  for (let offset = 0; offset < DAYS_IN_WEEK; offset += 1) {
    const dayKey = addDaysToKey(startDateKey, offset);
    const available = records.get(dayKey)?.capacityMinutesOverride ?? options.dailyCapacityMinutes;
    const plan = dayPlan(tasks, dayKey, {
      defaultEstimateMinutes: options.defaultEstimateMinutes,
    });
    const capacity = capacityFor(
      plan.tasks.map((entry) => entry.task),
      available,
      options.defaultEstimateMinutes,
    );

    availableMinutes += available;
    scheduled.push(...plan.tasks.map((entry) => entry.task));
    days.push({
      dateKey: dayKey,
      availableMinutes: available,
      isToday: dayKey === options.today,
      plan,
      capacity,
    });
  }

  return {
    startDateKey,
    endDateKey: addDaysToKey(startDateKey, DAYS_IN_WEEK - 1),
    days,
    carryOver: dayPlan(tasks, options.today, {
      defaultEstimateMinutes: options.defaultEstimateMinutes,
    }).overdue,
    capacity: capacityFor(scheduled, availableMinutes, options.defaultEstimateMinutes),
  };
}
