import type { CalendarEvent, WorkspaceSnapshot } from "@suite/planner-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../store/uiStore";

const mocks = vi.hoisted(() => ({
  events: [] as CalendarEvent[],
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () =>
    ({ events: mocks.events, settings: {}, tasks: [], days: [] }) as unknown as WorkspaceSnapshot,
}));

const { DayCalendar } = await import("./DayCalendar");

function event(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: "A meeting",
    dateKey: "2026-11-20",
    startTime: "09:00",
    endTime: "10:00",
    notes: "",
    color: null,
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    ...overrides,
  } as CalendarEvent;
}

function blockFor(title: string): HTMLElement {
  const text = screen.getByText(title);
  const block = text.parentElement;
  if (block === null) throw new Error(`no block for ${title}`);
  return block;
}

describe("DayCalendar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 10, 0));
    useUiStore.setState({ selectedDate: "2026-11-20" });
    mocks.events = [];
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("should show the selected day's events at the hour they start", () => {
    mocks.events = [
      event({ id: "selected", title: "Standup", startTime: "09:00", endTime: "10:00" }),
      event({ id: "other", title: "Other day", dateKey: "2026-11-19" }),
    ];

    render(<DayCalendar />);

    expect(screen.getByText("Standup")).toBeInTheDocument();
    expect(screen.queryByText("Other day")).toBeNull();
    expect(parseFloat(blockFor("Standup").style.top)).toBeCloseTo(14.29, 1);
    expect(parseFloat(blockFor("Standup").style.height)).toBeCloseTo(7.14, 1);
  });

  it("should not draw an event that lies entirely before the visible day", () => {
    mocks.events = [
      event({ id: "early", title: "Early flight", startTime: "06:00", endTime: "06:30" }),
    ];

    render(<DayCalendar />);

    expect(screen.queryByText("Early flight")).toBeNull();
  });

  it("should not draw an event that lies entirely after the visible day", () => {
    mocks.events = [
      event({ id: "late-only", title: "After close", startTime: "21:30", endTime: "22:00" }),
    ];

    render(<DayCalendar />);

    expect(screen.queryByText("After close")).toBeNull();
  });

  it("should clip an event that starts before the window to the top edge", () => {
    mocks.events = [
      event({ id: "straddle", title: "Before seven", startTime: "06:30", endTime: "07:30" }),
    ];

    render(<DayCalendar />);

    expect(parseFloat(blockFor("Before seven").style.top)).toBe(0);
    expect(parseFloat(blockFor("Before seven").style.height)).toBeCloseTo(3.57, 1);
  });

  it("should clip an event that runs past the window to the bottom edge", () => {
    mocks.events = [
      event({ id: "late", title: "Late call", startTime: "20:30", endTime: "21:30" }),
    ];

    render(<DayCalendar />);

    expect(parseFloat(blockFor("Late call").style.top)).toBeCloseTo(96.43, 1);
    expect(parseFloat(blockFor("Late call").style.height)).toBeCloseTo(3.57, 1);
  });

  it("should name the day it is describing when another day is selected", () => {
    useUiStore.setState({ selectedDate: "2026-11-19" });

    render(<DayCalendar />);

    expect(screen.getByText("No events on this day.")).toBeInTheDocument();
    expect(screen.queryByText("No events today.")).toBeNull();
  });

  it("should call today today", () => {
    render(<DayCalendar />);

    expect(screen.getByText("No events today.")).toBeInTheDocument();
  });
});
