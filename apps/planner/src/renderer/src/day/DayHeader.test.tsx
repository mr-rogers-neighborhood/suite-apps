import { addDaysToKey, todayKey } from "@suite/planner-core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const updateDay = vi.fn();

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => ({ days: [] }),
  useReplica: () => ({ document: { updateDay } }),
}));

const { DayHeader } = await import("./DayHeader");

describe("DayHeader", () => {
  afterEach(() => {
    cleanup();
    updateDay.mockReset();
  });

  it("should name the intention field for the day it edits", () => {
    render(<DayHeader date={addDaysToKey(todayKey(), 1)} />);

    expect(screen.getByLabelText("Intention for Tomorrow")).toBeInTheDocument();
    expect(screen.queryByLabelText("Today's intention")).toBeNull();
  });
});
