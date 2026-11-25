import { type ReminderEvent, WorkspaceDocument } from "@suite/planner-core";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceStore } from "./workspaceStore";

vi.mock("electron", () => ({
  powerMonitor: { on: vi.fn(), off: vi.fn() },
}));

const { ReminderScheduler } = await import("./scheduler");

/** The scheduler only reads the document and mutates through the store's write boundary. */
function storeFor(document: WorkspaceDocument): WorkspaceStore {
  return {
    document,
    mutate: <T>(mutation: (doc: WorkspaceDocument) => T): T => mutation(document),
  } as unknown as WorkspaceStore;
}

function workspaceTask(
  document: WorkspaceDocument,
  remindAt: string,
): { id: string; title: string } {
  const task = document.createTask({
    title: "Send the draft",
    scheduledFor: "2026-01-05",
    remindAt,
  });
  return { id: task.id, title: task.title };
}

describe("ReminderScheduler", () => {
  it("should deliver a due reminder once and record that it fired", () => {
    const document = WorkspaceDocument.create();
    const task = workspaceTask(document, "2026-01-05T09:00:00.000Z");
    const notify = vi.fn<(reminder: ReminderEvent) => void>();
    const scheduler = new ReminderScheduler(storeFor(document), notify);
    const now = new Date("2026-01-05T09:01:00.000Z");

    scheduler.tick(now);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      taskId: task.id,
      title: task.title,
      remindAt: "2026-01-05T09:00:00.000Z",
    });
    expect(document.getTask(task.id)?.remindedAt).toBe(now.toISOString());

    scheduler.tick(new Date("2026-01-05T09:02:00.000Z"));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("should not deliver a reminder that was cancelled before it was due", () => {
    const document = WorkspaceDocument.create();
    const task = workspaceTask(document, "2026-01-05T09:00:00.000Z");
    document.updateTask(task.id, { remindAt: null });
    const notify = vi.fn<(reminder: ReminderEvent) => void>();
    const scheduler = new ReminderScheduler(storeFor(document), notify);

    scheduler.tick(new Date("2026-01-05T09:01:00.000Z"));

    expect(notify).not.toHaveBeenCalled();
  });

  it("should deliver a new time after the first reminder fired", () => {
    const document = WorkspaceDocument.create();
    const task = workspaceTask(document, "2026-01-05T09:00:00.000Z");
    const notify = vi.fn<(reminder: ReminderEvent) => void>();
    const scheduler = new ReminderScheduler(storeFor(document), notify);

    scheduler.tick(new Date("2026-01-05T09:01:00.000Z"));
    document.updateTask(task.id, { remindAt: "2026-01-05T10:00:00.000Z" });
    scheduler.tick(new Date("2026-01-05T10:01:00.000Z"));

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith({
      taskId: task.id,
      title: task.title,
      remindAt: "2026-01-05T10:00:00.000Z",
    });
  });

  it("should leave a completed task alone", () => {
    const document = WorkspaceDocument.create();
    const task = workspaceTask(document, "2026-01-05T09:00:00.000Z");
    document.completeTask(task.id);
    const notify = vi.fn<(reminder: ReminderEvent) => void>();
    const scheduler = new ReminderScheduler(storeFor(document), notify);

    scheduler.tick(new Date("2026-01-05T09:01:00.000Z"));

    expect(notify).not.toHaveBeenCalled();
  });

  it("should wait for a future reminder", () => {
    const document = WorkspaceDocument.create();
    workspaceTask(document, "2026-01-05T10:00:00.000Z");
    const notify = vi.fn<(reminder: ReminderEvent) => void>();
    const scheduler = new ReminderScheduler(storeFor(document), notify);

    scheduler.tick(new Date("2026-01-05T09:01:00.000Z"));

    expect(notify).not.toHaveBeenCalled();
  });
});
