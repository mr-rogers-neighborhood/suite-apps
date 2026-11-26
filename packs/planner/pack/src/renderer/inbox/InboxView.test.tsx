import { todayKey, WorkspaceDocument } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ commit: vi.fn(async () => undefined) }));

vi.mock("../platform/bridge", () => ({
  getBridge: () => ({ commit: bridge.commit }),
}));

const { DocumentReplica, WorkspaceContext } = await import("../store/snapshotStore");
const { useUiStore } = await import("../store/uiStore");
const { InboxView } = await import("./InboxView");

function makeReplica(): {
  doc: WorkspaceDocument;
  replica: InstanceType<typeof DocumentReplica>;
} {
  const doc = WorkspaceDocument.create();
  return { doc, replica: new DocumentReplica(doc) };
}

function renderInbox(replica: InstanceType<typeof DocumentReplica>) {
  return render(
    <WorkspaceContext.Provider value={replica}>
      <InboxView />
    </WorkspaceContext.Provider>,
  );
}

describe("InboxView labels and actions", () => {
  const today = todayKey();

  beforeEach(() => {
    bridge.commit.mockClear();
    useUiStore.setState({ selectedDate: today, selectedTaskId: null });
  });

  afterEach(cleanup);

  it("should schedule where the button says it will, and name the destination", () => {
    const { doc, replica } = makeReplica();
    const task = doc.createTask({ title: "A task" });
    renderInbox(replica);

    const schedule = screen.getByRole("button", { name: `Schedule A task for Today` });

    expect(schedule).toHaveTextContent("Schedule");
    expect(schedule).toHaveAttribute("title", "Schedule for Today");

    fireEvent.click(schedule);

    expect(doc.getTask(task.id)).toMatchObject({ scheduledFor: today, status: "planned" });
    expect(screen.queryByRole("button", { name: /^Schedule A task/u })).toBeNull();
  });

  it("should complete an inbox task from its named checkbox", () => {
    const { doc, replica } = makeReplica();
    const task = doc.createTask({ title: "A task" });
    renderInbox(replica);

    fireEvent.click(screen.getByRole("checkbox", { name: "Complete A task" }));

    expect(doc.getTask(task.id)?.status).toBe("done");
  });

  it("should open details from a named control and return focus to it on close", async () => {
    const { doc, replica } = makeReplica();
    doc.createTask({ title: "A task" });
    renderInbox(replica);

    const opener = screen.getByRole("button", { name: "Open details for A task" });
    expect(opener).toHaveAttribute("title", "Open details for A task");

    fireEvent.click(opener);

    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();
    expect(useUiStore.getState().selectedTaskId).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("should leave schedule and details visible at phone width with a thumb target", () => {
    const { doc, replica } = makeReplica();
    doc.createTask({ title: "A task" });
    renderInbox(replica);

    for (const control of [
      screen.getByRole("button", { name: "Schedule A task for Today" }),
      screen.getByRole("button", { name: "Open details for A task" }),
    ]) {
      expect(control).toHaveClass("touch");
      expect(control.className).not.toMatch(/opacity-0/u);
    }
  });
});
