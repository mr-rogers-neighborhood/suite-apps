import type { ProjectedReminder, ProjectionDocument } from "@suite/pack-runtime";
import {
  decodeWorkspaceFile,
  encodeWorkspaceFile,
  SCHEMA_VERSION,
  todayKey,
  WorkspaceDocument,
} from "@suite/planner-core";
import { afterEach, describe, expect, it } from "vitest";
import { createPlannerPack, type PlannerPack, type PlannerPackHost } from "./bridge";
import {
  type MemoryDocuments,
  type MemoryFiles,
  memoryDocuments,
  memoryFiles,
  textOf,
} from "./test/fakeHost";

const now = new Date("2026-11-24T09:00:00.000Z");

function setup(host: Partial<PlannerPackHost> = {}): {
  pack: PlannerPack;
  documents: MemoryDocuments;
  files: MemoryFiles;
} {
  const documents = memoryDocuments();
  const files = memoryFiles();
  const pack = createPlannerPack({
    host: {
      documents,
      files,
      info: async () => ({ platform: "linux" }),
      ...host,
    },
    now: () => now,
  });
  return { pack, documents, files };
}

let active: PlannerPack | null = null;

afterEach(() => {
  active?.dispose();
  active = null;
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("the pack's Planner bridge", () => {
  it("answers null on a first run and creates one empty host record", async () => {
    const { pack, documents } = setup();
    active = pack;

    expect(await pack.bridge.loadSnapshot()).toBeNull();
    expect(await pack.bridge.wasCreated?.()).toBe(true);
    expect(documents.files.size).toBe(1);
    expect([...documents.files.values()][0]?.byteLength).toBe(0);
    expect(pack.documentId()).toBe("planner");
  });

  it("keeps a task and a day page, and reopens them on a second launch", async () => {
    const { pack, documents } = setup();
    active = pack;
    await pack.bridge.loadSnapshot();

    const doc = WorkspaceDocument.create({ now });
    const task = doc.createTask({ title: "Write the pack", estimateMinutes: 45 }, now);
    doc.updateDay(todayKey(), { intention: "Ship the pack" });
    doc.setNote(task.id, "The pack page: host envelope, task, day and export.");
    await pack.bridge.adopt?.(doc.snapshot());
    await pack.flush();
    // The launcher question is about how the session began, not whether it has saved since.
    expect(await pack.bridge.wasCreated?.()).toBe(true);

    const stored = documents.files.get("planner");
    expect(stored?.byteLength).toBeGreaterThan(0);
    const reopened = WorkspaceDocument.fromSnapshot(stored as Uint8Array);
    expect(reopened.getTask(task.id)?.title).toBe("Write the pack");
    expect(reopened.getTask(task.id)?.estimateMinutes).toBe(45);
    expect(reopened.getDay(todayKey())?.intention).toBe("Ship the pack");
    expect(reopened.getNote(task.id)).toContain("host envelope");
    expect(reopened.getSnapshot().meta.schemaVersion).toBe(SCHEMA_VERSION);

    // A second pack over the same host bytes takes the document instead of inventing one.
    const second = createPlannerPack({
      host: { documents, files: memoryFiles() },
      now: () => now,
    });
    const bytes = await second.bridge.loadSnapshot();
    expect(bytes).not.toBeNull();
    expect(WorkspaceDocument.fromSnapshot(bytes as Uint8Array).getTask(task.id)?.title).toBe(
      "Write the pack",
    );
    second.dispose();
  });

  it("writes on the boundary, not on every update", async () => {
    const { pack, documents } = setup();
    active = pack;
    await pack.bridge.loadSnapshot();
    const app = WorkspaceDocument.create({ now });
    await pack.bridge.adopt?.(app.snapshot());
    const afterAdopt = documents.saves.length;

    const updates: Uint8Array[] = [];
    app.observe((update) => updates.push(update));
    app.createTask({ title: "One" }, now);
    app.createTask({ title: "Two" }, now);
    expect(updates.length).toBeGreaterThan(0);

    for (const update of updates) await pack.bridge.commit(update);
    expect(documents.saves.length).toBe(afterAdopt);

    await pack.flush();
    expect(documents.saves.length).toBe(afterAdopt + 1);
  });

  it("refuses a document it cannot read instead of replacing it", async () => {
    const documents = memoryDocuments({
      planner: new TextEncoder().encode(JSON.stringify({ format: "other.app" })),
    });
    const { pack } = setup({ documents });
    active = pack;

    await expect(pack.bridge.loadSnapshot()).rejects.toThrow();
    // The user's bytes are still the only record; no fresh empty document was created.
    expect(documents.files.size).toBe(1);
    expect([...documents.files.values()][0]?.byteLength).toBeGreaterThan(0);
  });

  it("exports its own file and imports it back with the same task and page", async () => {
    const { pack, files } = setup();
    active = pack;
    await pack.bridge.loadSnapshot();

    const doc = WorkspaceDocument.create({ now });
    const task = doc.createTask({ title: "Write the pack" }, now);
    doc.updateDay(todayKey(), { intention: "Ship the pack" });
    doc.setNote(task.id, "A page that must survive the file.");
    await pack.bridge.adopt?.(doc.snapshot());
    await pack.flush();

    const exported = await pack.bridge.exportWorkspace();
    expect(exported.canceled).toBe(false);
    expect(exported.path).toMatch(/\.planner$/u);
    const written = files.saved.at(-1)?.bytes;
    expect(written).toBeDefined();
    const decoded = decodeWorkspaceFile(textOf(written as Uint8Array));
    expect(decoded.isOk()).toBe(true);

    files.openQueue.push(written as Uint8Array);
    const imported = await pack.bridge.importWorkspace();
    expect(imported.canceled).toBe(false);

    const snapshot = await pack.bridge.loadSnapshot();
    const after = WorkspaceDocument.fromSnapshot(snapshot as Uint8Array);
    expect(after.listTasks().map((task) => task.title)).toEqual(["Write the pack"]);
    expect(after.getDay(todayKey())?.intention).toBe("Ship the pack");
    expect(after.getNote(task.id)).toBe("A page that must survive the file.");
  });

  it("replaces the workspace on import rather than merging two plans", async () => {
    const { pack, documents, files } = setup();
    active = pack;
    await pack.bridge.loadSnapshot();

    const original = WorkspaceDocument.create({ now });
    original.createTask({ title: "Original task" }, now);
    await pack.bridge.adopt?.(original.snapshot());
    await pack.flush();

    const imported = WorkspaceDocument.create({ now });
    imported.createTask({ title: "Imported task" }, now);
    files.openQueue.push(new TextEncoder().encode(encodeWorkspaceFile(imported, now)));
    expect((await pack.bridge.importWorkspace()).canceled).toBe(false);

    const stored = documents.files.get("planner");
    const after = WorkspaceDocument.fromSnapshot(stored as Uint8Array);
    expect(after.listTasks().map((task) => task.title)).toEqual(["Imported task"]);
  });

  it("says a host without a picker cannot export or import", async () => {
    const documents = memoryDocuments();
    const { pack } = setup({ documents, files: undefined });
    active = pack;
    await pack.bridge.loadSnapshot();

    await expect(pack.bridge.exportWorkspace()).rejects.toThrow(/no file picker/u);
    await expect(pack.bridge.importWorkspace()).rejects.toThrow(/no file picker/u);
  });

  it("reports the host platform", async () => {
    const { pack } = setup();
    active = pack;

    expect(await pack.bridge.platform()).toBe("linux");
  });

  it("binds the declared reminder projection to the host's scoped handle", async () => {
    const registered: {
      handler: ((document: ProjectionDocument) => Promise<readonly ProjectedReminder[]>) | null;
    } = { handler: null };
    const documents = memoryDocuments();
    const pack = createPlannerPack({
      host: {
        documents,
        files: memoryFiles(),
        packId: "planner",
        projections: {
          register: (entry, next) => {
            expect(entry).toBe("reminders");
            registered.handler = next;
            return () => undefined;
          },
        },
      },
      now: () => now,
    });
    active = pack;

    const doc = WorkspaceDocument.create({ now });
    const task = doc.createTask(
      { title: "Draft the plan", remindAt: "2026-11-24T10:00:00.000Z" },
      now,
    );
    if (registered.handler === null) throw new Error("the projection was not registered");
    const rows = await registered.handler({
      id: "planner",
      version: 2,
      read: async () => doc.snapshot(),
    });

    expect(rows).toEqual([
      {
        id: task.id,
        title: "Draft the plan",
        body: "",
        at: Date.parse("2026-11-24T10:00:00.000Z"),
        deepLink: `suite://planner/task/${task.id}`,
      },
    ]);
  });
});
