import type { DayTask, Task } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  uncompleteTask: vi.fn(),
  uncompleteOccurrence: vi.fn(),
  scheduleTask: vi.fn(),
  deleteTask: vi.fn(),
}));

vi.mock("../store/snapshotStore", () => ({
  useReplica: () => ({
    document: {
      updateTask: mocks.updateTask,
      completeTask: mocks.completeTask,
      uncompleteTask: mocks.uncompleteTask,
      uncompleteOccurrence: mocks.uncompleteOccurrence,
      scheduleTask: mocks.scheduleTask,
      deleteTask: mocks.deleteTask,
    },
  }),
}));

const { TaskRow } = await import("./TaskRow");
const { useUiStore } = await import("../store/uiStore");

function entry(overrides: Partial<Task> = {}): DayTask {
  const task: Task = {
    id: "task-1",
    title: "A task",
    projectId: null,
    tagIds: [],
    status: "planned",
    scheduledFor: "2026-11-20",
    estimateMinutes: null,
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
    notes: "",
    ...overrides,
  } as Task;

  return { task, occurrence: "2026-11-20", done: false, recurring: false };
}

function openMenu(title = "A task"): void {
  fireEvent.pointerDown(screen.getByRole("button", { name: `Actions for ${title}` }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

describe("TaskRow title editing", () => {
  beforeEach(() => {
    mocks.updateTask.mockReset();
  });

  afterEach(cleanup);

  it("should rename the task in a labelled field", () => {
    render(<TaskRow entry={entry()} tags={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "A task" }));
    const field = screen.getByRole("textbox", { name: "Edit title for A task" });
    fireEvent.change(field, { target: { value: "Renamed task" } });
    fireEvent.blur(field);

    expect(mocks.updateTask).toHaveBeenCalledWith("task-1", { title: "Renamed task" });
  });
});

describe("TaskRow labels and actions", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    useUiStore.setState({ selectedTaskId: null });
  });

  afterEach(cleanup);

  it("should name the checkbox for the action it performs in each state", () => {
    const { rerender } = render(<TaskRow entry={entry()} tags={[]} />);

    const open = screen.getByRole("checkbox", { name: "Complete A task" });
    fireEvent.click(open);
    expect(mocks.completeTask).toHaveBeenCalledWith("task-1", null);

    mocks.completeTask.mockClear();
    rerender(<TaskRow entry={{ ...entry(), done: true }} tags={[]} />);

    const done = screen.getByRole("checkbox", { name: "Mark A task not done" });
    expect(screen.queryByRole("checkbox", { name: "Complete A task" })).toBeNull();
    fireEvent.click(done);
    expect(mocks.uncompleteTask).toHaveBeenCalledWith("task-1");
    expect(mocks.completeTask).not.toHaveBeenCalled();
  });

  it("should uncomplete the occurrence a repeating row shows", () => {
    render(
      <TaskRow
        entry={{
          ...entry({
            scheduledFor: "2026-11-20",
            recurrence: { frequency: "daily", interval: 1, weekdays: [], until: null },
          }),
          recurring: true,
          done: true,
        }}
        tags={[]}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Mark A task not done" }));

    expect(mocks.uncompleteOccurrence).toHaveBeenCalledWith("task-1", "2026-11-20");
    expect(mocks.uncompleteTask).not.toHaveBeenCalled();
  });

  it("should open the details from a control named and titled for that action", () => {
    render(<TaskRow entry={entry()} tags={[]} />);

    const opener = screen.getByRole("button", { name: "Open details for A task" });
    expect(opener).toHaveAttribute("title", "Open details for A task");

    fireEvent.click(opener);

    expect(useUiStore.getState().selectedTaskId).toBe("task-1");
    expect(opener).toHaveFocus();
  });

  it("should do what each row menu item says", async () => {
    render(<TaskRow entry={entry()} tags={[]} />);
    openMenu();

    fireEvent.click(await screen.findByText("Open details"));
    await waitFor(() => expect(useUiStore.getState().selectedTaskId).toBe("task-1"));

    openMenu();
    fireEvent.click(await screen.findByText("Move to inbox"));
    expect(mocks.scheduleTask).toHaveBeenCalledWith("task-1", null);

    openMenu();
    fireEvent.click(await screen.findByText("Delete task"));
    expect(mocks.deleteTask).toHaveBeenCalledWith("task-1");
  });
});

describe("TaskRow reminders", () => {
  beforeEach(() => {
    mocks.updateTask.mockReset();
  });

  afterEach(cleanup);

  it("should set a reminder from the row's menu", async () => {
    render(<TaskRow entry={entry()} tags={[]} />);
    openMenu();

    fireEvent.pointerMove(await screen.findByText("Remind me"));
    fireEvent.click(screen.getByText("Remind me"));
    fireEvent.click(await screen.findByText("In 1 hour"));

    expect(mocks.updateTask).toHaveBeenCalledWith("task-1", {
      remindAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    });
  });

  it("should offer to clear a reminder that is set", async () => {
    render(
      <TaskRow
        entry={entry({ remindAt: new Date(Date.now() + 60 * 60_000).toISOString() })}
        tags={[]}
      />,
    );
    openMenu();

    fireEvent.pointerMove(await screen.findByText("Remind me"));
    fireEvent.click(screen.getByText("Remind me"));
    fireEvent.click(await screen.findByText("Clear reminder"));

    expect(mocks.updateTask).toHaveBeenCalledWith("task-1", { remindAt: null });
  });

  it("should show the reminder's time in the row", () => {
    const at = new Date(Date.now() + 2 * 60 * 60_000);
    render(<TaskRow entry={entry({ remindAt: at.toISOString() })} tags={[]} />);

    expect(screen.getByTitle(/^Reminder at /u)).toHaveTextContent(/\d{1,2}:\d{2}/u);
  });
});
