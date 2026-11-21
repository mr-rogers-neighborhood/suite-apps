import type { Project, Task } from "@suite/planner-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  snapshot: { projects: [] as Project[], tasks: [] as Task[] },
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock("../store/snapshotStore", () => ({
  useWorkspaceSnapshot: () => mocks.snapshot,
  useReplica: () => ({
    document: {
      createProject: mocks.createProject,
      updateProject: mocks.updateProject,
    },
  }),
}));

const { ProjectsView } = await import("./ProjectsView");

function project(overrides: Partial<Project> & { id: string }): Project {
  return {
    name: overrides.id,
    color: null,
    archivedAt: null,
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

describe("ProjectsView", () => {
  beforeEach(() => {
    mocks.snapshot = { projects: [], tasks: [] };
    mocks.createProject.mockReset();
    mocks.updateProject.mockReset();
  });

  afterEach(cleanup);

  it("should show each project with its open task count", () => {
    mocks.snapshot = {
      projects: [project({ id: "project-1", name: "Alpha" })],
      tasks: [
        task({ id: "task-1", status: "planned", projectId: "project-1" }),
        task({ id: "task-2", status: "done", projectId: "project-1" }),
        task({ id: "task-3", status: "inbox", projectId: null }),
      ],
    };

    render(<ProjectsView />);

    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("1 open task")).toBeInTheDocument();
  });

  it("should name the action that creates the first project", () => {
    render(<ProjectsView />);

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByText("@project")).toBeInTheDocument();
  });

  it("should create a project from the form", () => {
    render(<ProjectsView />);

    fireEvent.change(screen.getByRole("textbox", { name: "New project name" }), {
      target: { value: "  Beta  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    expect(mocks.createProject).toHaveBeenCalledWith({ name: "Beta" });
  });

  it("should rename a project through the document", () => {
    mocks.snapshot.projects = [project({ id: "project-1", name: "Alpha" })];
    render(<ProjectsView />);

    fireEvent.click(screen.getByRole("button", { name: "Rename Alpha" }));
    const input = screen.getByRole("textbox", { name: "Project name" });
    fireEvent.change(input, { target: { value: "Beta" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.updateProject).toHaveBeenCalledWith("project-1", { name: "Beta" });
  });

  it("should archive and unarchive a project", () => {
    mocks.snapshot.projects = [project({ id: "project-1", name: "Alpha" })];
    render(<ProjectsView />);

    fireEvent.click(screen.getByRole("button", { name: "Archive Alpha" }));
    expect(mocks.updateProject).toHaveBeenCalledWith("project-1", {
      archivedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
    });

    cleanup();
    mocks.snapshot.projects = [
      project({ id: "project-2", name: "Old", archivedAt: "2026-11-19T09:00:00.000Z" }),
    ];
    render(<ProjectsView />);

    fireEvent.click(screen.getByRole("button", { name: "Unarchive Old", hidden: true }));
    expect(mocks.updateProject).toHaveBeenCalledWith("project-2", { archivedAt: null });
  });
});
