import { type DayTask, WorkspaceDocument } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../platform/bridge", () => ({
  getBridge: () => ({ commit: async () => undefined }),
}));

const { DocumentReplica, WorkspaceContext } = await import("../store/snapshotStore");
const { TaskRow } = await import("../day/TaskRow");
const { useUiStore } = await import("../store/uiStore");
const { TaskDetail } = await import("./TaskDetail");

function makeDocument(): { doc: WorkspaceDocument; replica: InstanceType<typeof DocumentReplica> } {
  const doc = WorkspaceDocument.create();
  return { doc, replica: new DocumentReplica(doc) };
}

function renderDetail(replica: InstanceType<typeof DocumentReplica>) {
  return render(
    <WorkspaceContext.Provider value={replica}>
      <TaskDetail />
    </WorkspaceContext.Provider>,
  );
}

function open(taskId: string): void {
  useUiStore.setState({ selectedTaskId: taskId });
}

function dayEntry(doc: WorkspaceDocument, taskId: string): DayTask {
  const task = doc.getTask(taskId);
  if (!task) throw new Error(`missing ${taskId}`);
  return { task, occurrence: task.scheduledFor ?? "2026-11-20", done: false, recurring: false };
}

describe("TaskDetail", () => {
  beforeEach(() => {
    useUiStore.setState({ selectedTaskId: null });
  });

  afterEach(cleanup);

  it("should show the record, its note, checklist and completion history", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({
      title: "A task",
      scheduledFor: "2026-11-20",
      estimateMinutes: 45,
      recurrence: { frequency: "weekly", interval: 1, weekdays: [], until: null },
    });
    doc.setNote(task.id, "Remember the details");
    doc.updateTask(task.id, {
      checklist: [{ id: "check_1", title: "Write the tests", done: false }],
      recurrenceCompletions: ["2026-11-13"],
    });
    open(task.id);

    renderDetail(replica);

    expect(screen.getByRole("dialog", { name: "Task details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("A task");
    expect(screen.getByLabelText("Notes")).toHaveValue("Remember the details");
    expect(screen.getByText("Write the tests")).toBeInTheDocument();
    expect(screen.getByText(/Occurrence done/u)).toBeInTheDocument();
  });

  it("should refuse an empty title in place and leave the record alone", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    const title = screen.getByLabelText("Title");
    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.blur(title);

    expect(screen.getByText("A task needs a title.")).toBeInTheDocument();
    expect(doc.getTask(task.id)?.title).toBe("A task");
  });

  it("should clear an estimate that is allowed to be null", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({
      title: "A task",
      scheduledFor: "2026-11-20",
      estimateMinutes: 45,
    });
    open(task.id);
    renderDetail(replica);

    const estimate = screen.getByLabelText("Estimate (minutes)");
    fireEvent.change(estimate, { target: { value: "" } });
    fireEvent.blur(estimate);

    expect(doc.getTask(task.id)?.estimateMinutes).toBeNull();
  });

  it("should refuse an estimate that is not whole positive minutes", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({
      title: "A task",
      scheduledFor: "2026-11-20",
      estimateMinutes: 45,
    });
    open(task.id);
    renderDetail(replica);

    const estimate = screen.getByLabelText("Estimate (minutes)");
    fireEvent.change(estimate, { target: { value: "0" } });
    fireEvent.blur(estimate);

    expect(
      screen.getByText("Enter whole minutes greater than zero, or leave the field empty."),
    ).toBeInTheDocument();
    expect(doc.getTask(task.id)?.estimateMinutes).toBe(45);
  });

  it("should write notes into the task's Loro text", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "A new note" } });

    expect(doc.getNote(task.id)).toBe("A new note");
  });

  it("should add, toggle and remove a checklist item", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    const draft = screen.getByLabelText("New checklist item");
    fireEvent.change(draft, { target: { value: "Buy milk" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(doc.getTask(task.id)?.checklist.map((item) => item.title)).toEqual(["Buy milk"]);

    fireEvent.click(screen.getByRole("checkbox", { name: "Toggle Buy milk" }));
    expect(doc.getTask(task.id)?.checklist[0]?.done).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Remove Buy milk" }));
    expect(doc.getTask(task.id)?.checklist).toEqual([]);
  });

  it("should refuse a blank checklist item in place", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    fireEvent.change(screen.getByLabelText("New checklist item"), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(screen.getByText("Name the checklist item before adding it.")).toBeInTheDocument();
    expect(doc.getTask(task.id)?.checklist).toEqual([]);
  });

  it("should set and clear a recurrence preset", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "daily" } });
    expect(doc.getTask(task.id)?.recurrence).toMatchObject({ frequency: "daily", interval: 1 });

    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "none" } });
    expect(doc.getTask(task.id)?.recurrence).toBeNull();
  });

  it("should refuse a recurrence on a task with no day", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "An inbox task" });
    open(task.id);
    renderDetail(replica);

    fireEvent.change(screen.getByLabelText("Repeats"), { target: { value: "weekly" } });

    expect(screen.getByText("Give the task a day before it can repeat.")).toBeInTheDocument();
    expect(doc.getTask(task.id)?.recurrence).toBeNull();
  });

  it("should clear due and reminder times, which are allowed to be null", () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({
      title: "A task",
      scheduledFor: "2026-11-20",
      dueAt: "2026-11-20T17:00:00.000Z",
      remindAt: "2026-11-20T16:00:00.000Z",
    });
    open(task.id);
    renderDetail(replica);

    const due = screen.getByLabelText("Due");
    fireEvent.change(due, { target: { value: "" } });
    fireEvent.blur(due);

    const remind = screen.getByLabelText("Remind me");
    fireEvent.change(remind, { target: { value: "" } });
    fireEvent.blur(remind);

    expect(doc.getTask(task.id)?.dueAt).toBeNull();
    expect(doc.getTask(task.id)?.remindAt).toBeNull();
  });

  it("should return focus to the row when it closes", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    render(
      <WorkspaceContext.Provider value={replica}>
        <TaskRow entry={dayEntry(doc, task.id)} tags={[]} />
        <TaskDetail />
      </WorkspaceContext.Provider>,
    );

    const opener = screen.getByRole("button", { name: "Open details for A task" });
    fireEvent.click(opener);
    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("should open from the row's actions menu", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    render(
      <WorkspaceContext.Provider value={replica}>
        <TaskRow entry={dayEntry(doc, task.id)} tags={[]} />
        <TaskDetail />
      </WorkspaceContext.Provider>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Actions for A task" }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    fireEvent.click(await screen.findByText("Open details"));

    expect(await screen.findByRole("dialog", { name: "Task details" })).toBeInTheDocument();
    expect(useUiStore.getState().selectedTaskId).toBe(task.id);
  });
});
