import {
  addDaysToKey,
  humanDayLabel,
  type Project,
  type Tag,
  type Task,
  todayKey,
} from "@suite/planner-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: { projects: [] as Project[], tags: [] as Tag[], tasks: [] as Task[] },
  setView: vi.fn(),
  setSelectedDate: vi.fn(),
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => mocks.snapshot,
}));

vi.mock("../store/uiStore", () => ({
  useUiStore: (
    select: (state: {
      setView: typeof mocks.setView;
      setSelectedDate: typeof mocks.setSelectedDate;
    }) => unknown,
  ) => select({ setView: mocks.setView, setSelectedDate: mocks.setSelectedDate }),
}));

const { UpcomingView } = await import("./UpcomingView");

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: "A task",
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
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("UpcomingView", () => {
  beforeEach(() => {
    mocks.snapshot = { projects: [], tags: [], tasks: [] };
    mocks.setView.mockReset();
    mocks.setSelectedDate.mockReset();
  });

  afterEach(cleanup);

  it("should group open tasks after today by day", () => {
    const today = todayKey();
    const tomorrow = addDaysToKey(today, 1);
    const later = addDaysToKey(today, 2);
    mocks.snapshot.tasks = [
      task({ id: "task-1", title: "Tomorrow one", scheduledFor: tomorrow }),
      task({ id: "task-2", title: "Tomorrow two", scheduledFor: tomorrow }),
      task({ id: "task-3", title: "Later", scheduledFor: later }),
      task({ id: "task-4", title: "Today only", scheduledFor: today }),
      task({ id: "task-5", title: "Past", scheduledFor: addDaysToKey(today, -1) }),
      task({ id: "task-6", title: "Done ahead", status: "done", scheduledFor: tomorrow }),
    ];

    render(<UpcomingView />);

    expect(screen.getByRole("heading", { name: "Tomorrow" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: humanDayLabel(later, today) })).toBeInTheDocument();
    expect(screen.getByText("Tomorrow one")).toBeInTheDocument();
    expect(screen.getByText("Tomorrow two")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
    expect(screen.queryByText("Today only")).not.toBeInTheDocument();
    expect(screen.queryByText("Past")).not.toBeInTheDocument();
    expect(screen.queryByText("Done ahead")).not.toBeInTheDocument();
  });

  it("should name the action that fills an empty upcoming list", () => {
    render(<UpcomingView />);

    expect(screen.getByText("Nothing scheduled ahead")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open inbox" }));

    expect(mocks.setView).toHaveBeenCalledWith("inbox");
  });

  it("should open the task's day in the registry", () => {
    const tomorrow = addDaysToKey(todayKey(), 1);
    mocks.snapshot.tasks = [task({ id: "task-1", title: "Tomorrow one", scheduledFor: tomorrow })];

    render(<UpcomingView />);

    fireEvent.click(screen.getByRole("button", { name: "Tomorrow one" }));

    expect(mocks.setSelectedDate).toHaveBeenCalledWith(tomorrow);
    expect(mocks.setView).toHaveBeenCalledWith("today");
  });
});
