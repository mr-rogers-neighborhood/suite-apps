import {
  type FocusSession,
  type Task,
  todayKey,
  type WorkspaceSnapshot,
} from "@suite/planner-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startFocusSession: vi.fn(),
  endFocusSession: vi.fn(),
  snapshot: { current: null as unknown as WorkspaceSnapshot },
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => mocks.snapshot.current,
  useReplica: () => ({
    document: {
      startFocusSession: mocks.startFocusSession,
      endFocusSession: mocks.endFocusSession,
    },
  }),
}));

const { FocusView } = await import("./FocusView");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Write the plan",
    projectId: null,
    tagIds: [],
    status: "planned",
    estimateMinutes: 45,
    scheduledFor: todayKey(),
    order: 0,
    dueAt: null,
    remindAt: null,
    remindedAt: null,
    recurrence: null,
    recurrenceCompletions: [],
    priority: null,
    source: null,
    checklist: [],
    createdAt: "2026-01-05T09:00:00.000Z",
    updatedAt: "2026-01-05T09:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function session(overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "focus-1",
    taskId: "task-1",
    startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    plannedMinutes: 25,
    endedAt: null,
    ...overrides,
  };
}

function snapshot(options: { tasks?: Task[]; focusSessions?: FocusSession[] }): WorkspaceSnapshot {
  return {
    tasks: options.tasks ?? [],
    projects: [],
    tags: [],
    events: [],
    days: [],
    focusSessions: options.focusSessions ?? [],
    settings: {
      weekStartsOn: 1,
      workdayStart: "09:00",
      workdayEnd: "17:00",
      dailyCapacityMinutes: 300,
      defaultEstimateMinutes: 30,
      theme: "system",
      remindersEnabled: true,
      notificationsAskedAt: null,
    },
    meta: {
      workspaceId: "workspace-1",
      schemaVersion: 2,
      createdAt: "2026-01-05T09:00:00.000Z",
    },
  };
}

describe("FocusView", () => {
  beforeEach(() => {
    mocks.startFocusSession.mockReset();
    mocks.endFocusSession.mockReset();
    mocks.snapshot.current = snapshot({});
  });

  afterEach(cleanup);

  it("should start a session for the chosen task and planned length", () => {
    mocks.snapshot.current = snapshot({ tasks: [task()] });
    render(<FocusView />);

    fireEvent.change(screen.getByLabelText("Task"), { target: { value: "task-1" } });
    fireEvent.change(screen.getByLabelText("Planned minutes"), { target: { value: "50" } });
    fireEvent.click(screen.getByRole("button", { name: "Start focus" }));

    expect(mocks.startFocusSession).toHaveBeenCalledWith({
      taskId: "task-1",
      plannedMinutes: 50,
    });
  });

  it("should stop the running session from the document", () => {
    mocks.snapshot.current = snapshot({ tasks: [task()], focusSessions: [session()] });
    render(<FocusView />);

    expect(screen.getByRole("region", { name: "Running focus session" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop session" }));

    expect(mocks.endFocusSession).toHaveBeenCalledWith("focus-1");
  });

  it("should show a finished session's actual duration, not its planned length", () => {
    const startedAt = new Date();
    startedAt.setHours(9, 0, 0, 0);
    const endedAt = new Date(startedAt.getTime() + 12 * 60_000);
    mocks.snapshot.current = snapshot({
      tasks: [task()],
      focusSessions: [
        session({ startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString() }),
      ],
    });
    render(<FocusView />);

    expect(screen.getByText("12m")).toBeInTheDocument();
    expect(screen.queryByText("25m")).toBeNull();
  });
});
