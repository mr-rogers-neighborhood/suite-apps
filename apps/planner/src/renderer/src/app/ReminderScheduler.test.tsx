import type { Task } from "@suite/planner-core";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setNotice: vi.fn(),
  syncReminders: vi.fn(),
  tasks: [] as readonly Task[],
}));

vi.mock("../platform/bridge", () => ({
  getBridge: () => ({ syncReminders: mocks.syncReminders }),
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => ({ tasks: mocks.tasks }),
}));

vi.mock("../store/uiStore", () => ({
  useUiStore: (select: (state: { setNotice: typeof mocks.setNotice }) => unknown) =>
    select({ setNotice: mocks.setNotice }),
}));

const { ReminderScheduler } = await import("./ReminderScheduler");

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
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
    createdAt: "2026-01-05T09:00:00.000Z",
    completedAt: null,
    notes: "",
    ...overrides,
  } as Task;
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe("ReminderScheduler", () => {
  beforeEach(() => {
    mocks.setNotice.mockReset();
    mocks.syncReminders.mockReset();
    mocks.tasks = [];
  });

  it("should hand the pending reminder to a bridge that can deliver it", async () => {
    mocks.tasks = [task({ id: "a", remindAt: FUTURE })];
    mocks.syncReminders.mockResolvedValue({ permission: "granted" });

    render(<ReminderScheduler />);

    await waitFor(() => expect(mocks.syncReminders).toHaveBeenCalledTimes(1));
    expect(mocks.syncReminders).toHaveBeenCalledWith([
      { id: "a", title: "A task", at: Date.parse(FUTURE) },
    ]);
    expect(mocks.setNotice).not.toHaveBeenCalled();
  });

  it("should say so when a reminder cannot arrive because notifications are blocked", async () => {
    mocks.tasks = [task({ id: "a", remindAt: FUTURE })];
    mocks.syncReminders.mockResolvedValue({ permission: "denied" });

    render(<ReminderScheduler />);

    await waitFor(() =>
      expect(mocks.setNotice).toHaveBeenCalledWith(
        "Reminders are off: notifications are blocked for Suite Go in system settings.",
      ),
    );
  });

  it("should not mention reminders when there are none to deliver", async () => {
    mocks.syncReminders.mockResolvedValue({ permission: "denied" });

    render(<ReminderScheduler />);

    await waitFor(() => expect(mocks.syncReminders).toHaveBeenCalled());
    expect(mocks.setNotice).not.toHaveBeenCalled();
  });
});
