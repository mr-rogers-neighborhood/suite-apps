import type { Task } from "@suite/planner-core";

/**
 * The reminder times the row offers, and how a set one reads.
 *
 * Kept out of the component so each rule is a function of a clock: "this evening" is 19:00 today
 * unless that has passed, and a label says "tomorrow" only when it is tomorrow. The row renders
 * these; it does not compute them.
 */

const EVENING_HOUR = 19;
const MORNING_HOUR = 9;

/** At an hour today, or the same hour tomorrow when today's has passed. */
export function eveningReminder(now: Date = new Date()): Date {
  const at = new Date(now);
  at.setHours(EVENING_HOUR, 0, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at;
}

/** Tomorrow morning, at the hour the day view starts. */
export function tomorrowMorning(now: Date = new Date()): Date {
  const at = new Date(now);
  at.setDate(at.getDate() + 1);
  at.setHours(MORNING_HOUR, 0, 0, 0);
  return at;
}

/** In `minutes`, from now. Rounded to the minute so the label does not carry seconds. */
export function inMinutes(minutes: number, now: Date = new Date()): Date {
  const at = new Date(now.getTime() + minutes * 60_000);
  at.setSeconds(0, 0);
  return at;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * How a reminder time reads in the row: `14:30`, `tomorrow 09:00`, or `Nov 21, 09:00`.
 *
 * The time uses the reader's clock settings, the way the due time does. `now` is a parameter so
 * the day arithmetic is testable.
 */
export function reminderLabel(remindAt: string, now: Date = new Date()): string {
  const at = new Date(remindAt);
  if (Number.isNaN(at.getTime())) return "reminder";

  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);

  if (days === 0) return time;
  if (days === 1) return `tomorrow ${time}`;
  return `${at.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

/** True when this task still has a reminder waiting to happen. */
export function reminderPending(task: Task, now: Date = new Date()): boolean {
  if (!task.remindAt || task.remindedAt || task.status === "done") return false;
  const at = Date.parse(task.remindAt);
  return Number.isFinite(at) && at > now.getTime();
}
