import { WorkspaceDocument } from "@suite/planner-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlannerPack, type PlannerPack } from "./bridge";
import {
  type MemoryDocuments,
  memoryDocuments,
  memoryFiles,
  memoryRecents,
} from "./test/fakeHost";
import { memoryScopedFiles } from "./sync/testFiles";

const now = new Date("2026-11-24T09:00:00.000Z");

function setup(host: Parameters<typeof createPlannerPack>[0]["host"]): {
  pack: PlannerPack;
  documents: MemoryDocuments;
} {
  const documents = (host.documents ?? memoryDocuments()) as MemoryDocuments;
  const pack = createPlannerPack({ host: { ...host, documents, files: host.files ?? memoryFiles() }, now: () => now });
  return { pack, documents };
}

let active: PlannerPack | null = null;

afterEach(async () => {
  await active?.dispose();
  active = null;
});

describe("the pack's sync surface", () => {
  it("reports a missing relay capability without touching the document", async () => {
    const scoped = memoryScopedFiles();
    const { pack, documents } = setup({ files: scoped.service });
    active = pack;
    await pack.bridge.loadSnapshot();
    const saves = documents.saves.length;

    expect((await pack.bridge.syncStatus?.())?.status).toEqual({ state: "off" });
    const refused = await pack.bridge.syncEnable?.("ws://127.0.0.1:8787/sync");

    expect(refused?.status.state).toBe("refused");
    expect(documents.saves.length).toBe(saves);
  });

  it("pushes the current sync info to a listener", async () => {
    const scoped = memoryScopedFiles();
    const { pack } = setup({ files: scoped.service });
    active = pack;
    await pack.bridge.loadSnapshot();

    const listener = vi.fn();
    const off = pack.bridge.onSyncChanged?.(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(listener.mock.calls[0]?.[0]).toMatchObject({ status: { state: "off" } });
    off?.();
  });

  it("lists only this pack's recent documents and opens one by host id", async () => {
    const first = WorkspaceDocument.create({ now });
    first.createTask({ title: "First planner" }, now);
    const second = WorkspaceDocument.create({ now });
    second.createTask({ title: "Second planner" }, now);
    const documents = memoryDocuments({ first: first.snapshot(), second: second.snapshot() });
    const recents = memoryRecents([
      { packId: "planner", documentId: "second", name: "second", openedAt: 3 },
      { packId: "canvas", documentId: null, name: null, openedAt: 2 },
      { packId: "planner", documentId: "first", name: "first", openedAt: 1 },
    ]);
    const { pack } = setup({ documents, recents, packId: "planner" });
    active = pack;

    await pack.bridge.loadSnapshot();
    const rows = await pack.bridge.recentDocuments?.();
    expect(rows?.map((row) => row.documentId)).toEqual(["second"]);

    const replaced = vi.fn();
    pack.bridge.onWorkspaceReplaced(replaced);
    expect(await pack.bridge.openRecentDocument?.("second")).toBe(true);
    expect(pack.documentId()).toBe("second");
    expect(replaced).toHaveBeenCalledOnce();
    // The opened document is the one the host recorded, not a second copy.
    expect(WorkspaceDocument.fromSnapshot(replaced.mock.calls[0]?.[0]).listTasks()[0]?.title).toBe(
      "Second planner",
    );
  });

  it("shows no recents when the host has no list", async () => {
    const { pack } = setup({});
    active = pack;
    await pack.bridge.loadSnapshot();
    expect(await pack.bridge.recentDocuments?.()).toEqual([]);
  });
});
