import type { ProjectedReminder } from "@suite/pack-runtime";
import { pendingReminders, WorkspaceDocument } from "@suite/planner-core";

/**
 * Planner's declared reminder projection.
 *
 * The manifest names `reminders`; the pack binds that entry in its prelude. The
 * host calls it with a read-only handle and receives display rows. Nothing here
 * schedules or shows a notification, and nothing here reads a task's note
 * document: one snapshot decodes the flat task list the app already writes on
 * every save.
 *
 * `now` is a parameter so the rows are reproducible in a test. The projection is
 * idempotent: the same snapshot and instant produce the same rows in the same
 * order.
 */

export const REMINDER_PROJECTION = "reminders";
export const REMINDER_PACK_ID = "planner";

export interface ReminderProjectionOptions {
  readonly packId: string;
  readonly now: Date;
}

export function projectReminders(
  snapshot: Uint8Array,
  options: ReminderProjectionOptions,
): readonly ProjectedReminder[] {
  const document = WorkspaceDocument.fromSnapshot(snapshot);
  if (!document.getSettings().remindersEnabled) return [];

  // Read only what a reminder needs: the flat task list and the project names
  // a row can carry. Tags, events, days, focus sessions and notes are not walked.
  const workspaceTasks = document.listTasks();
  const projects = new Map(document.listProjects().map((project) => [project.id, project.name]));
  const tasks = new Map(workspaceTasks.map((task) => [task.id, task]));

  return pendingReminders(workspaceTasks, options.now.getTime()).map((reminder) => {
    const task = tasks.get(reminder.id);
    const project =
      task?.projectId === null || task?.projectId === undefined
        ? ""
        : (projects.get(task.projectId) ?? "");
    return {
      id: reminder.id,
      title: task?.title.trim().length ? task.title.trim() : "Untitled task",
      body: project,
      at: reminder.at,
      deepLink: reminderLink(options.packId, reminder.id),
    };
  });
}

export function reminderLink(packId: string, taskId: string): string {
  return `suite://${packId}/task/${encodeURIComponent(taskId)}`;
}

/** The task id a `suite://<pack>/task/<id>` launch names, or null. */
export function taskIdFromLaunch(url: string, packId: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "suite:" || parsed.hostname.toLowerCase() !== packId.toLowerCase()) {
    return null;
  }
  const match = /^\/task\/(.+)$/u.exec(parsed.pathname);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return null;
  }
}
