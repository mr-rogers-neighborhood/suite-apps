import { type DayTask, WorkspaceDocument } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ commit: vi.fn(async () => undefined) }));

vi.mock("../platform/bridge", () => ({
  getBridge: () => ({ commit: bridge.commit }),
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
    bridge.commit.mockClear();
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
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveTextContent(
      "Remember the details",
    );
    expect(screen.getByText("Write the tests")).toBeInTheDocument();
    expect(screen.getByText(/Occurrence done/u)).toBeInTheDocument();
  });

  it("should open an old plain-text note with its lines and literal characters", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    doc.setNote(task.id, "Line one\nLine two <&> `three`");
    open(task.id);

    renderDetail(replica);

    const editor = await screen.findByRole("textbox", { name: "Notes" });
    expect(editor).toHaveTextContent("Line oneLine two <&> `three`");
    expect(editor.querySelector("br")).not.toBeNull();
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

  it("should write a typed note into the Loro container through the bridge", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    const editor = await screen.findByRole("textbox", { name: "Notes" });
    await userEvent.click(editor);
    await userEvent.keyboard("A new note");

    await waitFor(() => expect(editor).toHaveTextContent("A new note"));
    await waitFor(() => expect(doc.getNoteDoc(task.id).get("nodeName")).toBe("doc"));
    expect(doc.getNoteDoc(task.id).size).toBeGreaterThan(0);
    expect(doc.getNote(task.id)).toBe("A new note");
    expect(bridge.commit).toHaveBeenCalled();
  });

  it("should keep a formatted note when the dialog is closed and reopened", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    const first = renderDetail(replica);

    const editor = await screen.findByRole("textbox", { name: "Notes" });
    await userEvent.click(editor);
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    await userEvent.keyboard("Bold note");

    await waitFor(() => expect(editor.querySelector("strong")).not.toBeNull());
    await waitFor(() => expect(doc.getNoteDoc(task.id).get("nodeName")).toBe("doc"));

    first.unmount();
    open(task.id);
    renderDetail(replica);

    const reopened = await screen.findByRole("textbox", { name: "Notes" });
    expect(reopened.querySelector("strong")).not.toBeNull();
    expect(reopened).toHaveTextContent("Bold note");
  });

  it("should keep <, & and backticks through a snapshot round-trip", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    const text = "a < b & c ` d";
    const editor = await screen.findByRole("textbox", { name: "Notes" });
    await userEvent.click(editor);
    await userEvent.keyboard(text);

    await waitFor(() => expect(editor).toHaveTextContent(text));
    await waitFor(() => expect(doc.getNoteDoc(task.id).get("nodeName")).toBe("doc"));

    const snapshotDocument = WorkspaceDocument.fromSnapshot(doc.snapshot());
    expect(snapshotDocument.getNote(task.id)).toBe(text);
    const restored = new DocumentReplica(snapshotDocument);
    cleanup();
    open(task.id);
    renderDetail(restored);

    const reopened = await screen.findByRole("textbox", { name: "Notes" });
    await waitFor(() => expect(reopened).toHaveTextContent(text));
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

  it("should leave a timestamp the field cannot show whole alone", () => {
    const { doc, replica } = makeDocument();
    const now = new Date("2026-11-01T09:00:00.000Z");
    const task = doc.createTask(
      {
        title: "A task",
        scheduledFor: "2026-11-20",
        dueAt: "2026-11-20T17:00:30.000Z",
      },
      now,
    );
    open(task.id);
    renderDetail(replica);

    const due = screen.getByLabelText("Due");
    fireEvent.blur(due);

    expect(doc.getTask(task.id)?.dueAt).toBe("2026-11-20T17:00:30.000Z");
    expect(doc.getTask(task.id)?.updatedAt).toBe(now.toISOString());
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

  it("should keep focus on the row title after a keyboard rename", async () => {
    const user = userEvent.setup();
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    render(
      <WorkspaceContext.Provider value={replica}>
        <TaskRow entry={dayEntry(doc, task.id)} tags={[]} />
      </WorkspaceContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "A task" }));
    const field = screen.getByRole("textbox", { name: "Edit title for A task" });
    fireEvent.change(field, { target: { value: "Renamed task" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(doc.getTask(task.id)?.title).toBe("Renamed task");
    await waitFor(() => expect(screen.getByRole("button", { name: "A task" })).toHaveFocus());
  });

  it("should keep focus on the row title after Escape cancels the rename", async () => {
    const user = userEvent.setup();
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    render(
      <WorkspaceContext.Provider value={replica}>
        <TaskRow entry={dayEntry(doc, task.id)} tags={[]} />
      </WorkspaceContext.Provider>,
    );

    await user.click(screen.getByRole("button", { name: "A task" }));
    const field = screen.getByRole("textbox", { name: "Edit title for A task" });
    await user.type(field, "Do not save{Escape}");

    expect(doc.getTask(task.id)?.title).toBe("A task");
    await waitFor(() => expect(screen.getByRole("button", { name: "A task" })).toHaveFocus());
  });

  it("should close on Escape while the notes editor has focus", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    const editor = await screen.findByRole("textbox", { name: "Notes" });
    editor.focus();
    fireEvent.keyDown(editor, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

  it("should keep focus inside the dialog when the actions menu opened it", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    render(
      <WorkspaceContext.Provider value={replica}>
        <TaskRow entry={dayEntry(doc, task.id)} tags={[]} />
        <TaskDetail />
      </WorkspaceContext.Provider>,
    );

    const trigger = screen.getByRole("button", { name: "Actions for A task" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    fireEvent.click(await screen.findByText("Open details"));

    const dialog = await screen.findByRole("dialog", { name: "Task details" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Open details for A task" })).toHaveFocus();
  });

  it("should name its dialog, heading and close control the same way", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    const dialog = await screen.findByRole("dialog", { name: "Task details" });
    expect(within(dialog).getByRole("heading", { name: "Task details" })).toBeInTheDocument();

    const close = screen.getByRole("button", { name: "Close task details" });
    expect(close).toHaveAttribute("title", "Close task details");
    expect(close).toHaveAccessibleName("Close task details");
  });

  it("should keep every note toolbar name and title together", async () => {
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    open(task.id);
    renderDetail(replica);

    const toolbar = await screen.findByRole("toolbar", { name: "Note formatting" });
    for (const button of within(toolbar).getAllByRole("button")) {
      const label = button.getAttribute("aria-label");
      expect(label).not.toBeNull();
      expect(button).toHaveAttribute("title", label ?? "");
    }

    const paragraph = within(toolbar).getByRole("button", { name: "Text" });
    expect(paragraph).toHaveTextContent("Text");
    expect(paragraph).toHaveAttribute("title", "Text");
  });

  it("should move focus into the dialog in visual order and keep Tab inside it", async () => {
    const user = userEvent.setup();
    const { doc, replica } = makeDocument();
    const task = doc.createTask({ title: "A task", scheduledFor: "2026-11-20" });
    render(
      <WorkspaceContext.Provider value={replica}>
        <TaskRow entry={dayEntry(doc, task.id)} tags={[]} />
        <TaskDetail />
      </WorkspaceContext.Provider>,
    );

    const opener = screen.getByRole("button", { name: "Open details for A task" });
    opener.focus();
    await user.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Task details" });
    const close = screen.getByRole("button", { name: "Close task details" });

    expect(close).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Title")).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Bold" })).toHaveFocus();

    // Walk the whole dialog: the trap must never let focus reach the page behind it.
    for (let step = 0; step < 40; step += 1) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }

    await user.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("should return focus to the opener from the close control", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Close task details" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });
});
