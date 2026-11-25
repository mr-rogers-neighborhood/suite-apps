import { WorkspaceDocument } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../store/uiStore";

const bridge = vi.hoisted(() => ({ commit: vi.fn(async () => undefined) }));

vi.mock("../platform/bridge", () => ({
  getBridge: () => ({ commit: bridge.commit }),
}));

const { DocumentReplica, WorkspaceContext } = await import("../store/snapshotStore");
const { DayView } = await import("./DayView");

const DATE = "2026-11-20";

function makeReplica(): {
  doc: WorkspaceDocument;
  replica: InstanceType<typeof DocumentReplica>;
} {
  const doc = WorkspaceDocument.create({ now: new Date(`${DATE}T08:00:00.000Z`) });
  return { doc, replica: new DocumentReplica(doc) };
}

function renderDay(replica: InstanceType<typeof DocumentReplica>) {
  return render(
    <WorkspaceContext.Provider value={replica}>
      <DayView />
    </WorkspaceContext.Provider>,
  );
}

describe("DayView", () => {
  beforeEach(() => {
    bridge.commit.mockClear();
    useUiStore.setState({ selectedDate: DATE, selectedTaskId: null, view: "today" });
  });

  afterEach(cleanup);

  it("should show the day's tasks in order and measure them against the day's capacity", () => {
    const { doc, replica } = makeReplica();
    doc.updateDay(DATE, { capacityMinutesOverride: 60 });
    doc.createTask({ title: "First", scheduledFor: DATE, estimateMinutes: 45 });
    doc.createTask({ title: "Second", scheduledFor: DATE });

    renderDay(replica);

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("First");
    expect(rows[1]).toHaveTextContent("Second");

    const meter = screen.getByRole("meter", { name: "Planned time against daily capacity" });
    expect(meter).toHaveAttribute("aria-valuemax", "60");
    expect(screen.getByText("15m over capacity")).toBeInTheDocument();
  });

  it("should report overdue work and move it only when asked", async () => {
    const { doc, replica } = makeReplica();
    const overdue = doc.createTask({
      title: "Yesterday's work",
      scheduledFor: "2026-11-19",
      estimateMinutes: 30,
    });

    renderDay(replica);

    const section = screen.getByRole("heading", { name: "Overdue" }).parentElement;
    if (section === null) throw new Error("overdue section is missing");
    expect(within(section).getByText("Yesterday's work")).toBeInTheDocument();
    expect(doc.getTask(overdue.id)?.scheduledFor).toBe("2026-11-19");

    fireEvent.click(screen.getByRole("button", { name: "Pull to this day" }));

    await waitFor(() => expect(doc.getTask(overdue.id)?.scheduledFor).toBe(DATE));
  });

  it("should say the day is empty and point at the inbox when there is work waiting", () => {
    const { doc, replica } = makeReplica();
    doc.createTask({ title: "Unplanned" });

    renderDay(replica);

    expect(screen.getByText("Nothing planned yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open inbox · 1 waiting" })).toBeInTheDocument();
  });
});
