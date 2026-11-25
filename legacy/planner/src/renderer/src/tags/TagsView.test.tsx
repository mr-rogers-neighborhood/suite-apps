import type { Tag, Task } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: { tags: [] as Tag[], tasks: [] as Task[] },
  createTag: vi.fn(),
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => mocks.snapshot,
  useReplica: () => ({ document: { createTag: mocks.createTag } }),
}));

const { TagsView } = await import("./TagsView");

function tag(overrides: Partial<Tag> & { id: string }): Tag {
  return {
    name: overrides.id,
    color: null,
    createdAt: "2026-11-20T09:00:00.000Z",
    ...overrides,
  };
}

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
    createdAt: "2026-11-20T09:00:00.000Z",
    updatedAt: "2026-11-20T09:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("TagsView", () => {
  beforeEach(() => {
    mocks.snapshot = { tags: [], tasks: [] };
    mocks.createTag.mockReset();
  });

  afterEach(cleanup);

  it("should show a tag's tasks and count", () => {
    mocks.snapshot = {
      tags: [tag({ id: "tag-1", name: "deep" })],
      tasks: [
        task({ id: "task-1", title: "Write the draft", status: "planned", tagIds: ["tag-1"] }),
        task({ id: "task-2", title: "Finished work", status: "done", tagIds: ["tag-1"] }),
      ],
    };

    render(<TagsView />);

    expect(screen.getByRole("heading", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByText("#deep")).toBeInTheDocument();
    expect(screen.getByText("2 tasks")).toBeInTheDocument();
    expect(screen.getByText("Write the draft")).toBeInTheDocument();
    expect(screen.getByText("Finished work")).toHaveClass("line-through");
  });

  it("should treat a tag with no tasks as empty rather than an error", () => {
    mocks.snapshot.tags = [tag({ id: "tag-1", name: "someday" })];

    render(<TagsView />);

    expect(screen.getByText("#someday")).toBeInTheDocument();
    expect(screen.getByText(/No tasks carry this tag yet\./u)).toBeInTheDocument();
  });

  it("should name the action that creates the first tag", () => {
    render(<TagsView />);

    expect(screen.getByText("No tags yet")).toBeInTheDocument();
    expect(screen.getByText("@tag")).toBeInTheDocument();
  });

  it("should create a tag from the form", () => {
    render(<TagsView />);

    fireEvent.change(screen.getByRole("textbox", { name: "New tag name" }), {
      target: { value: "  errand  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add tag" }));

    expect(mocks.createTag).toHaveBeenCalledWith({ name: "errand" });
  });
});
