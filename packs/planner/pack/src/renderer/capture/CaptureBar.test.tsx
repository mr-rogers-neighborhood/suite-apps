import { WorkspaceDocument } from "@suite/planner-core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ commit: vi.fn(async () => undefined) }));

vi.mock("../platform/bridge", () => ({
  getBridge: () => ({ commit: bridge.commit }),
}));

const { DocumentReplica, WorkspaceContext } = await import("../store/snapshotStore");
const { useUiStore } = await import("../store/uiStore");
const { CaptureBar } = await import("./CaptureBar");

function makeReplica(): {
  doc: WorkspaceDocument;
  replica: InstanceType<typeof DocumentReplica>;
} {
  const doc = WorkspaceDocument.create();
  return { doc, replica: new DocumentReplica(doc) };
}

function renderBar(
  target: { kind: "day"; dateKey: string } | { kind: "inbox" },
  replica: InstanceType<typeof DocumentReplica>,
) {
  return render(
    <WorkspaceContext.Provider value={replica}>
      <CaptureBar target={target} />
    </WorkspaceContext.Provider>,
  );
}

describe("CaptureBar", () => {
  beforeEach(() => {
    bridge.commit.mockClear();
    useUiStore.setState({
      selectedDate: "2026-11-20",
      selectedTaskId: null,
      captureSignal: 0,
      notice: null,
    });
  });

  afterEach(cleanup);

  it("should capture one line into the chosen day with its project, tag, estimate and time", async () => {
    const { doc, replica } = makeReplica();
    renderBar({ kind: "day", dateKey: "2026-11-20" }, replica);

    const input = screen.getByRole("textbox", { name: "Capture a task" });
    await userEvent.type(input, "Draft the plan ~45m #Planner @deep-work !1 9:30{Enter}");

    const task = doc.listTasks()[0];
    const project = doc.listProjects()[0];
    const tag = doc.listTags()[0];

    expect(task).toMatchObject({
      title: "Draft the plan",
      scheduledFor: "2026-11-20",
      estimateMinutes: 45,
      priority: 1,
      status: "planned",
      dueAt: new Date("2026-11-20T09:30:00").toISOString(),
    });
    expect(project?.name).toBe("Planner");
    expect(tag?.name).toBe("deep-work");
    expect(task?.projectId).toBe(project?.id);
    expect(task?.tagIds).toEqual([tag?.id]);
    expect(input).toHaveValue("");
    expect(useUiStore.getState().notice).toBe("Captured · Draft the plan");
  });

  it("should leave a plain inbox capture unscheduled", async () => {
    const { doc, replica } = makeReplica();
    renderBar({ kind: "inbox" }, replica);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Capture a task" }),
      "Write the notes{Enter}",
    );

    expect(doc.listTasks()[0]).toMatchObject({
      title: "Write the notes",
      scheduledFor: null,
      status: "inbox",
      dueAt: null,
      projectId: null,
      tagIds: [],
    });
  });

  it("should reuse an existing project and tag by name instead of making duplicates", async () => {
    const { doc, replica } = makeReplica();
    const project = doc.createProject({ name: "planner" });
    const tag = doc.createTag({ name: "Deep-Work" });
    renderBar({ kind: "inbox" }, replica);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Capture a task" }),
      "Review the backlog #PLANNER @deep-work{Enter}",
    );

    const task = doc.listTasks()[0];
    expect(doc.listProjects()).toHaveLength(1);
    expect(doc.listTags()).toHaveLength(1);
    expect(task?.projectId).toBe(project.id);
    expect(task?.tagIds).toEqual([tag.id]);
  });

  it("should not create a task from blank input", async () => {
    const { doc, replica } = makeReplica();
    renderBar({ kind: "inbox" }, replica);

    await userEvent.type(screen.getByRole("textbox", { name: "Capture a task" }), "   {Enter}");

    expect(doc.listTasks()).toEqual([]);
    expect(useUiStore.getState().notice).toBeNull();
  });
});
