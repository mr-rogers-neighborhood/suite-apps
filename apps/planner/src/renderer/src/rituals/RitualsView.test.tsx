import type { DayRecord, Task, WorkspaceSnapshot } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../store/uiStore";

const DATE = "2026-01-05";

const mocks = vi.hoisted(() => ({
  updateDay: vi.fn(),
  markDayPlanned: vi.fn(),
  markDayShutdown: vi.fn(),
  scheduleTask: vi.fn(),
  snapshot: { current: null as unknown as WorkspaceSnapshot },
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => mocks.snapshot.current,
  useReplica: () => ({
    document: {
      updateDay: mocks.updateDay,
      markDayPlanned: mocks.markDayPlanned,
      markDayShutdown: mocks.markDayShutdown,
      scheduleTask: mocks.scheduleTask,
    },
  }),
}));

const { RitualsView } = await import("./RitualsView");

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Write the docs",
    projectId: null,
    tagIds: [],
    status: "planned",
    estimateMinutes: 45,
    scheduledFor: DATE,
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

function dayRecord(overrides: Partial<DayRecord> = {}): DayRecord {
  return {
    dateKey: DATE,
    intention: "",
    shutdownNote: "",
    capacityMinutesOverride: null,
    plannedAt: null,
    shutdownAt: null,
    ...overrides,
  };
}

function snapshot(options: {
  days?: DayRecord[];
  tasks?: Task[];
  defaultEstimateMinutes?: number;
}): WorkspaceSnapshot {
  return {
    tasks: options.tasks ?? [],
    projects: [],
    tags: [],
    events: [],
    days: options.days ?? [dayRecord()],
    focusSessions: [],
    settings: {
      weekStartsOn: 1,
      workdayStart: "09:00",
      workdayEnd: "17:00",
      dailyCapacityMinutes: 300,
      defaultEstimateMinutes: options.defaultEstimateMinutes ?? 30,
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

function plannedRecord(plannedAt = "2026-01-05T09:00:00.000Z"): DayRecord {
  return dayRecord({ plannedAt });
}

function shutdownRecord(shutdownAt = "2026-01-05T17:00:00.000Z"): DayRecord {
  return dayRecord({ shutdownAt });
}

function submitCapacity(): void {
  const form = screen.getByRole("button", { name: "Save capacity" }).closest("form");
  if (form === null) throw new Error("capacity form is missing");
  fireEvent.submit(form);
}

describe("RitualsView", () => {
  beforeEach(() => {
    mocks.updateDay.mockReset();
    mocks.markDayPlanned.mockReset();
    mocks.markDayShutdown.mockReset();
    mocks.scheduleTask.mockReset();
    mocks.markDayPlanned.mockReturnValue(plannedRecord());
    mocks.markDayShutdown.mockReturnValue(shutdownRecord());
    useUiStore.setState({ selectedDate: DATE, view: "rituals" });
    mocks.snapshot.current = snapshot({});
  });

  afterEach(cleanup);

  it("should save the intention to the shared day record", () => {
    render(<RitualsView />);

    const intention = screen.getByLabelText("Day intention");
    fireEvent.change(intention, { target: { value: "Ship the ritual" } });
    fireEvent.blur(intention);

    expect(mocks.updateDay).toHaveBeenCalledWith(DATE, { intention: "Ship the ritual" });
  });

  it("should write a capacity override the meter can read", () => {
    render(<RitualsView />);

    fireEvent.change(screen.getByLabelText("Capacity override in minutes"), {
      target: { value: "240" },
    });
    submitCapacity();

    expect(mocks.updateDay).toHaveBeenCalledWith(DATE, { capacityMinutesOverride: 240 });
    expect(screen.getByText("Capacity set to 4h.")).toBeInTheDocument();
  });

  it("should clear the capacity override back to the default", () => {
    mocks.snapshot.current = snapshot({
      days: [dayRecord({ capacityMinutesOverride: 240 })],
    });
    render(<RitualsView />);

    fireEvent.change(screen.getByLabelText("Capacity override in minutes"), {
      target: { value: "" },
    });
    submitCapacity();

    expect(mocks.updateDay).toHaveBeenCalledWith(DATE, { capacityMinutesOverride: null });
  });

  it("should mark the day planned and explain a repeat", () => {
    render(<RitualsView />);

    fireEvent.click(screen.getByRole("button", { name: "Plan the day" }));

    expect(mocks.markDayPlanned).toHaveBeenCalledWith(DATE);
    expect(screen.getByText(/^Planned at /u)).toBeInTheDocument();
  });

  it("should say a second plan updates the time instead of duplicating it", () => {
    mocks.snapshot.current = snapshot({ days: [plannedRecord()] });
    render(<RitualsView />);

    fireEvent.click(screen.getByRole("button", { name: "Plan again" }));

    expect(mocks.markDayPlanned).toHaveBeenCalledWith(DATE);
    expect(screen.getByText(/Planned again at /u)).toHaveTextContent(/not duplicated/u);
  });

  it("should shut down with a note and leave carry-over for an explicit move", () => {
    mocks.snapshot.current = snapshot({ tasks: [task()] });
    render(<RitualsView />);

    fireEvent.change(screen.getByLabelText("Shutdown note"), {
      target: { value: "Shipped the surface" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Shut down the day" }));

    expect(mocks.updateDay).toHaveBeenCalledWith(DATE, { shutdownNote: "Shipped the surface" });
    expect(mocks.markDayShutdown).toHaveBeenCalledWith(DATE);
    expect(mocks.scheduleTask).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Move Write the docs to tomorrow" }));

    expect(mocks.scheduleTask).toHaveBeenCalledWith("task-1", "2026-01-06");
  });

  it("should explain a second shutdown rather than adding another", () => {
    mocks.snapshot.current = snapshot({ days: [shutdownRecord()] });
    render(<RitualsView />);

    fireEvent.click(screen.getByRole("button", { name: "Update shutdown" }));

    expect(mocks.markDayShutdown).toHaveBeenCalledWith(DATE);
    expect(screen.getByText(/^Shutdown updated at /u)).toBeInTheDocument();
  });
});
