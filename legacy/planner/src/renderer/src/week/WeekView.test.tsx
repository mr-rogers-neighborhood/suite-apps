import {
  addDaysToKey,
  type DayRecord,
  startOfWeekKey,
  type Task,
  todayKey,
  type WorkspaceSnapshot,
} from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../store/uiStore";
import { weekdayName } from "./weekLabels";

const mocks = vi.hoisted(() => ({
  scheduleTask: vi.fn(),
  snapshot: { current: null as unknown as WorkspaceSnapshot },
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => mocks.snapshot.current,
  useReplica: () => ({ document: { scheduleTask: mocks.scheduleTask } }),
}));

const { WeekView } = await import("./WeekView");

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
    createdAt: "2026-11-16T09:00:00.000Z",
    updatedAt: "2026-11-16T09:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

function dayRecord(overrides: Partial<DayRecord> = {}): DayRecord {
  return {
    dateKey: "2026-11-16",
    intention: "",
    shutdownNote: "",
    capacityMinutesOverride: null,
    plannedAt: null,
    shutdownAt: null,
    ...overrides,
  };
}

function snapshot(options: { tasks?: Task[]; days?: DayRecord[] } = {}): WorkspaceSnapshot {
  return {
    tasks: options.tasks ?? [],
    projects: [],
    tags: [],
    events: [],
    days: options.days ?? [],
    focusSessions: [],
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
      createdAt: "2026-11-16T09:00:00.000Z",
    },
  };
}

describe("WeekView", () => {
  let today: string;
  let weekStart: string;

  beforeEach(() => {
    today = todayKey();
    weekStart = startOfWeekKey(today, 1);
    mocks.scheduleTask.mockReset();
    useUiStore.setState({ selectedDate: weekStart, view: "week" });
    mocks.snapshot.current = snapshot();
  });

  afterEach(cleanup);

  function columnFor(dateKey: string): HTMLElement {
    return screen.getByRole("region", { name: weekdayName(dateKey) });
  }

  it("should render seven labelled day columns with a meter each", () => {
    mocks.snapshot.current = snapshot({
      tasks: [task({ id: "task-1", title: "Plan the week", scheduledFor: weekStart })],
      days: [dayRecord({ dateKey: addDaysToKey(weekStart, 2), capacityMinutesOverride: 120 })],
    });

    render(<WeekView />);

    for (let offset = 0; offset < 7; offset += 1) {
      const dateKey = addDaysToKey(weekStart, offset);
      expect(screen.getByRole("heading", { name: weekdayName(dateKey) })).toBeInTheDocument();
    }

    expect(screen.getAllByRole("meter")).toHaveLength(7);
    expect(within(columnFor(weekStart)).getByText("Plan the week")).toBeInTheDocument();
    expect(
      within(columnFor(addDaysToKey(weekStart, 2))).getByText(/Nothing planned/u),
    ).toBeInTheDocument();
  });

  it("should move a task to another column by dragging it", () => {
    const target = addDaysToKey(weekStart, 2);
    mocks.snapshot.current = snapshot({
      tasks: [task({ id: "task-1", title: "Plan the week", scheduledFor: weekStart })],
    });

    render(<WeekView />);

    const row = within(columnFor(weekStart)).getByText("Plan the week").closest("li");
    if (row === null) throw new Error("task row is missing");

    fireEvent.dragStart(row, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "move" },
    });
    fireEvent.dragOver(columnFor(target), { dataTransfer: { dropEffect: "move" } });
    fireEvent.drop(columnFor(target), { dataTransfer: { getData: () => "task-1" } });

    expect(mocks.scheduleTask).toHaveBeenCalledWith("task-1", target);
    expect(screen.getByRole("status")).toHaveTextContent(/^Moved Plan the week to /u);
  });

  it("should move a focused task with the keyboard shortcut", () => {
    const target = addDaysToKey(weekStart, 1);
    mocks.snapshot.current = snapshot({
      tasks: [task({ id: "task-1", title: "Plan the week", scheduledFor: weekStart })],
    });

    render(<WeekView />);

    const title = screen.getByRole("button", { name: "Plan the week" });
    expect(title).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowLeft Alt+ArrowRight");

    fireEvent.keyDown(title, { key: "ArrowRight", altKey: true });

    expect(mocks.scheduleTask).toHaveBeenCalledWith("task-1", target);
    expect(screen.getByRole("status")).toHaveTextContent(/^Moved Plan the week to /u);

    fireEvent.keyDown(title, { key: "ArrowLeft" });
    expect(mocks.scheduleTask).toHaveBeenCalledTimes(1);
  });

  it("should show carry-over and move it only when the button is used", () => {
    const yesterday = addDaysToKey(today, -1);
    mocks.snapshot.current = snapshot({
      tasks: [task({ id: "task-1", title: "Yesterday's work", scheduledFor: yesterday })],
    });

    render(<WeekView />);

    expect(screen.getByRole("heading", { name: "Carry-over" })).toBeInTheDocument();
    expect(mocks.scheduleTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move Yesterday's work to today" }));

    expect(mocks.scheduleTask).toHaveBeenCalledWith("task-1", today);
  });

  it("should leave a repeating occurrence on its series anchor", () => {
    const secondDay = addDaysToKey(weekStart, 1);
    mocks.snapshot.current = snapshot({
      tasks: [
        task({
          id: "task-repeat",
          title: "Daily standup",
          scheduledFor: weekStart,
          recurrence: { frequency: "daily", interval: 1, weekdays: [], until: null },
        }),
      ],
    });

    render(<WeekView />);

    const occurrence = within(columnFor(secondDay)).getByRole("button", { name: "Daily standup" });
    expect(occurrence).not.toHaveAttribute("aria-keyshortcuts");
    expect(occurrence.closest("li")?.getAttribute("draggable")).not.toBe("true");

    fireEvent.keyDown(occurrence, { key: "ArrowRight", altKey: true });
    expect(mocks.scheduleTask).not.toHaveBeenCalled();

    fireEvent.drop(columnFor(addDaysToKey(weekStart, 2)), {
      dataTransfer: { getData: () => "task-repeat" },
    });
    expect(mocks.scheduleTask).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Daily standup repeats, so its series stays where it is.",
    );
  });

  it("should step a week across the end of a month", () => {
    useUiStore.setState({ selectedDate: "2026-01-31" });
    render(<WeekView />);

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));

    // 2026-01-31 is a Saturday; its Monday week starts on 26 January.
    expect(useUiStore.getState().selectedDate).toBe("2026-02-02");
  });

  it("should step a week across the end of a year", () => {
    useUiStore.setState({ selectedDate: "2026-12-28" });
    render(<WeekView />);

    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(useUiStore.getState().selectedDate).toBe("2027-01-04");

    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(useUiStore.getState().selectedDate).toBe("2026-12-28");
  });

  it("should refuse a move past the last day of the week", () => {
    const lastDay = addDaysToKey(weekStart, 6);
    mocks.snapshot.current = snapshot({
      tasks: [task({ id: "task-1", title: "Last day", scheduledFor: lastDay })],
    });

    render(<WeekView />);

    fireEvent.keyDown(within(columnFor(lastDay)).getByRole("button", { name: "Last day" }), {
      key: "ArrowRight",
      altKey: true,
    });

    expect(mocks.scheduleTask).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Last day is already on the last day of this week.",
    );
  });

  it("should say when a task is already on the first day of the week", () => {
    mocks.snapshot.current = snapshot({
      tasks: [task({ id: "task-1", title: "Plan the week", scheduledFor: weekStart })],
    });

    render(<WeekView />);

    fireEvent.keyDown(screen.getByRole("button", { name: "Plan the week" }), {
      key: "ArrowLeft",
      altKey: true,
    });

    expect(mocks.scheduleTask).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Plan the week is already on the first day of this week.",
    );
  });
});
