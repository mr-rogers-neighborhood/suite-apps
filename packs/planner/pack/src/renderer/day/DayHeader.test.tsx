import { addDaysToKey, todayKey } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../store/uiStore";

const updateDay = vi.fn();

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => ({ days: [] }),
  useReplica: () => ({ document: { updateDay } }),
}));

const { DayHeader } = await import("./DayHeader");

/** The day view passes the selected date; the header must follow the store like it does there. */
function DayHarness() {
  const date = useUiStore((state) => state.selectedDate);
  return <DayHeader date={date} />;
}

describe("DayHeader", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedDate: todayKey() });
  });

  afterEach(() => {
    cleanup();
    updateDay.mockReset();
  });

  it("should name the intention field for the day it edits", () => {
    render(<DayHeader date={addDaysToKey(todayKey(), 1)} />);

    expect(screen.getByLabelText("Intention for Tomorrow")).toBeInTheDocument();
    expect(screen.queryByLabelText("Today's intention")).toBeNull();
  });

  it("should cross a month with the day arrows", () => {
    useUiStore.setState({ selectedDate: "2026-01-31" });
    render(<DayHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));

    expect(useUiStore.getState().selectedDate).toBe("2026-02-01");
  });

  it("should cross a year with the day arrows", () => {
    useUiStore.setState({ selectedDate: "2026-12-31" });
    render(<DayHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));

    expect(useUiStore.getState().selectedDate).toBe("2027-01-01");
  });

  it("should put focus on the new day when Back to today removes itself", async () => {
    const user = userEvent.setup();
    useUiStore.setState({ selectedDate: addDaysToKey(todayKey(), 1) });
    render(<DayHarness />);

    await user.click(screen.getByRole("button", { name: "Back to today" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Today" })).toHaveFocus());
    expect(useUiStore.getState().selectedDate).toBe(todayKey());
  });
});
