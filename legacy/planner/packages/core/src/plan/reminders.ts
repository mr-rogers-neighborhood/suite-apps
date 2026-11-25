import type { ReminderSchedule } from "../ports";
import type { Task } from "../schema";

/**
 * The reminders that still have to be delivered.
 *
 * A reminder is pending when it has a time, has not already fired, and belongs to a task that is
 * not done. Times in the past are left out on purpose: handing one to a platform alarm fires it
 * immediately, which turns opening the app into a burst of old notifications.
 *
 * `now` is a parameter so the rule can be tested without waiting.
 */
export function pendingReminders(
  tasks: readonly Task[],
  now: number = Date.now(),
): ReminderSchedule[] {
  return tasks
    .filter((task) => task.status !== "done" && !task.remindedAt && task.remindAt !== null)
    .map((task) => ({ id: task.id, title: task.title, at: Date.parse(task.remindAt ?? "") }))
    .filter((reminder) => Number.isFinite(reminder.at) && reminder.at > now)
    .sort((left, right) => left.at - right.at);
}
