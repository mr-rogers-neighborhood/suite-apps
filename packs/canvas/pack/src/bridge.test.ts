import {
  buildWorkspaceFile,
  readWorkspaceFile,
  WorkspaceDocument,
  type WorkspaceFileManifest,
} from "@suite/graph";
import { describe, expect, it } from "vitest";
import type { BridgeCreateRequest, BridgeSaveRequest } from "../../../../legacy/canvas/src/host/bridge";
import { createCanvasPack } from "./bridge";
import { memoryDocuments, memoryFiles, memoryRecents, textOf } from "./test/fakeHost";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function counts(workspace: WorkspaceDocument): WorkspaceFileManifest {
  return {
    boards: workspace.listBoards().length,
    cards: workspace.listCards().length,
    types: workspace.listTypes().length,
    tags: workspace.listTags().length,
  };
}

function sample(title = "Board from the pack"): {
  workspace: WorkspaceDocument;
  boardId: string;
  cardId: string;
  seed: BridgeCreateRequest;
} {
  const workspace = new WorkspaceDocument();
  const board = workspace.createBoard({ name: "Home" });
  const card = workspace.createCard({
    boardId: board.id,
    position: { x: 0, y: 0 },
    fromTemplate: false,
  });
  workspace.setTitleText(card.id, title);
  workspace.renameWorkspace("Pack workspace");
  return {
    workspace,
    boardId: board.id,
    cardId: card.id,
    seed: {
      workspaceId: WORKSPACE_ID,
      title: "Pack workspace",
      snapshot: new Uint8Array(workspace.exportSnapshot()),
      manifest: counts(workspace),
    },
  };
}

function envelopeOf(workspace: WorkspaceDocument, workspaceId = WORKSPACE_ID): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(
      buildWorkspaceFile({
        workspaceId,
        snapshot: new Uint8Array(workspace.exportSnapshot()),
        manifest: counts(workspace),
      }),
    ),
  );
}

function titleOf(bytes: Uint8Array): string {
  const parsed = readWorkspaceFile(textOf(bytes));
  const card = parsed.workspace.listCards()[0];
  return card === undefined ? "" : parsed.workspace.cardTitle(card.id);
}

describe("Canvas's pack bridge", () => {
  it("creates a canvas in the host document store and reads it back", async () => {
    const documents = memoryDocuments();
    const reloads: number[] = [];
    const pack = createCanvasPack({
      host: { documents, files: memoryFiles(), info: async () => ({ platform: "linux" }) },
      boundaries: false,
      reload: () => reloads.push(1),
    });
    const { seed } = sample();

    await expect(pack.bridge.createDocument(seed)).resolves.toEqual({ ok: true });
    expect(reloads).toHaveLength(1);
    expect(pack.documentId()).toBe(WORKSPACE_ID);
    expect(documents.files.has(WORKSPACE_ID)).toBe(true);

    const opened = await pack.bridge.loadDocument();
    expect(opened?.info.workspaceId).toBe(WORKSPACE_ID);
    // The path is a display value with the document id's value, never a filesystem path.
    expect(opened?.info.path).toBe(WORKSPACE_ID);
    expect(opened?.snapshot).toBeInstanceOf(Uint8Array);
    expect(titleOf(documents.files.get(WORKSPACE_ID) ?? new Uint8Array())).toBe(
      "Board from the pack",
    );
  });

  it("resumes the newest host document when nothing is remembered", async () => {
    const { workspace } = sample("Newest board");
    const documents = memoryDocuments({
      "doc-newer": envelopeOf(workspace, "doc-newer"),
    });
    const pack = createCanvasPack({ host: { documents }, boundaries: false });

    const opened = await pack.bridge.loadDocument();
    expect(opened?.info.workspaceId).toBe("doc-newer");
    expect(pack.documentId()).toBe("doc-newer");
  });

  it("coalesces a save until the boundary, then writes the whole envelope", async () => {
    const documents = memoryDocuments();
    const pack = createCanvasPack({
      host: { documents },
      boundaries: false,
      reload: () => undefined,
    });
    const { seed, workspace, cardId } = sample();
    await pack.bridge.createDocument(seed);
    const before = documents.saves.length;

    const edited = new WorkspaceDocument();
    edited.doc.import(workspace.exportSnapshot());
    edited.setTitleText(cardId, "Edited in the pack");
    const request: BridgeSaveRequest = {
      workspaceId: WORKSPACE_ID,
      title: "Pack workspace",
      snapshot: new Uint8Array(edited.exportSnapshot()),
      manifest: counts(edited),
    };
    await pack.bridge.saveDocument(request);

    // The write is at a durability boundary, not per edit.
    expect(documents.saves.length).toBe(before);
    expect(await pack.bridge.flushDocument()).toEqual({ ok: true });
    expect(documents.saves.length).toBeGreaterThan(before);
    expect(titleOf(documents.files.get(WORKSPACE_ID) ?? new Uint8Array())).toBe(
      "Edited in the pack",
    );
  });

  it("keeps the images a document-only save omits", async () => {
    const documents = memoryDocuments();
    const pack = createCanvasPack({
      host: { documents },
      boundaries: false,
      reload: () => undefined,
    });
    const { seed, workspace } = sample();
    const withImage: BridgeCreateRequest = {
      ...seed,
      attachments: [
        {
          id: "image-1",
          mime: "image/png",
          name: "diagram.png",
          width: 4,
          height: 3,
          bytes: new Uint8Array([1, 2, 3, 4]),
        },
      ],
    };
    await pack.bridge.createDocument(withImage);
    await pack.bridge.saveDocument({
      workspaceId: WORKSPACE_ID,
      snapshot: new Uint8Array(workspace.exportSnapshot()),
      manifest: counts(workspace),
    });
    await pack.bridge.flushDocument();

    const parsed = readWorkspaceFile(textOf(documents.files.get(WORKSPACE_ID) ?? new Uint8Array()));
    expect(parsed.file.attachments["image-1"]?.mime).toBe("image/png");
    expect(parsed.attachments[0]?.bytes).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("exports through the host save picker and re-imports through the open picker", async () => {
    const documents = memoryDocuments();
    const files = memoryFiles();
    const restored: Array<{ id: string; bytes: Uint8Array; mime: string }> = [];
    const reloads: number[] = [];
    const pack = createCanvasPack({
      host: { documents, files },
      boundaries: false,
      reload: () => reloads.push(1),
      storeAttachment: async (id, bytes, mime) => {
        restored.push({ id, bytes, mime });
      },
    });
    const { seed } = sample("Round-trip board");
    const withImage: BridgeCreateRequest = {
      ...seed,
      attachments: [
        {
          id: "image-1",
          mime: "image/png",
          name: "diagram.png",
          width: 4,
          height: 3,
          bytes: new Uint8Array([9, 8, 7]),
        },
      ],
    };
    await pack.bridge.createDocument(withImage);

    const saveTextFile = pack.bridge.saveTextFile;
    if (saveTextFile === undefined) throw new Error("the pack did not publish saveTextFile");
    const exported = await saveTextFile.call(pack.bridge, "round-trip.canvas", '{"hello":1}');
    expect(exported).toEqual({ saved: true, name: "round-trip.canvas" });
    expect(files.saved).toHaveLength(1);
    expect(textOf(files.saved[0]?.bytes ?? new Uint8Array())).toBe('{"hello":1}');
    expect(files.saved[0]?.closed).toBe(true);

    // Export the real envelope, then feed it back through the open picker.
    const envelopeText = textOf(documents.files.get(WORKSPACE_ID) ?? new Uint8Array());
    files.openQueue.push(envelopeText === "" ? null : new TextEncoder().encode(envelopeText));
    await pack.bridge.openFileDialog();

    expect(reloads).toHaveLength(2);
    expect(documents.files.size).toBe(2);
    const importedId = [...documents.files.keys()].find((id) => id !== WORKSPACE_ID);
    if (importedId === undefined) throw new Error("the import created no document");
    const imported = readWorkspaceFile(textOf(documents.files.get(importedId) ?? new Uint8Array()));
    expect(imported.file.workspaceId).toBe(importedId);
    expect(imported.workspace.listBoards()).toHaveLength(1);
    const importedCard = imported.workspace.listCards()[0];
    expect(importedCard === undefined ? "" : imported.workspace.cardTitle(importedCard.id)).toBe(
      "Round-trip board",
    );
    expect(imported.attachments).toHaveLength(1);
    expect(restored).toEqual([
      { id: "image-1", bytes: new Uint8Array([9, 8, 7]), mime: "image/png" },
    ]);
  });

  it("reports a cancelled export as a value, not a failure", async () => {
    const documents = memoryDocuments();
    const files = memoryFiles();
    files.cancelSave = true;
    const pack = createCanvasPack({ host: { documents, files }, boundaries: false });
    const saveTextFile = pack.bridge.saveTextFile;
    if (saveTextFile === undefined) throw new Error("the pack did not publish saveTextFile");

    await expect(saveTextFile.call(pack.bridge, "x.canvas", "{}")).resolves.toEqual({
      saved: false,
    });
  });

  it("lists the host's recents for its own documents and forgets a row without the canvas", async () => {
    const { workspace } = sample("A remembered board");
    const documents = memoryDocuments({
      "doc-a": envelopeOf(workspace, "doc-a"),
    });
    const recents = memoryRecents([
      { packId: "canvas", documentId: "doc-a", name: "doc-a", openedAt: 2_000 },
      // Another pack's row: no document id, so this pack cannot open it.
      { packId: "planner", documentId: null, name: null, openedAt: 1_500 },
    ]);
    const pack = createCanvasPack({ host: { documents, recents }, boundaries: false });

    // Adopting the canvas is what remembers its display name; the recent row still carries only id.
    await pack.bridge.loadDocument();
    const files = await pack.bridge.recentFiles();
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("doc-a");
    expect(files[0]?.name).toBe("Pack workspace");
    expect(files[0]?.folder).toBe("Suite Canvas");

    await pack.bridge.forgetRecent("doc-a");
    expect(recents.forgotten).toEqual(["doc-a"]);
    expect(documents.files.has("doc-a")).toBe(true);
  });

  it("notices a denied recent list instead of listing another pack's documents", async () => {
    const recents = memoryRecents();
    recents.deny = "Recent documents are off; this app may not read the host's recent list.";
    const pack = createCanvasPack({
      host: { documents: memoryDocuments(), recents },
      boundaries: false,
    });

    await expect(pack.bridge.recentFiles()).resolves.toEqual([]);
    expect(pack.notices().at(-1)).toContain("Recent files are unavailable");
  });

  it("reveals the open canvas through the host and never sees a path", async () => {
    const { workspace } = sample("A revealed board");
    const documents = memoryDocuments({ "doc-a": envelopeOf(workspace, "doc-a") });
    const pack = createCanvasPack({ host: { documents }, boundaries: false });
    await pack.bridge.loadDocument();

    await expect(pack.reveal()).resolves.toBe(true);
    expect(documents.revealed).toEqual(["doc-a"]);
    expect(pack.notices().join(" ")).not.toContain("/");
  });

  it("imports a folder through the host's own copy", async () => {
    const files = memoryFiles();
    files.folder = {
      path: "imports/vault",
      entries: [
        {
          path: "imports/vault/Home.md",
          name: "Home.md",
          kind: "file",
          size: 3,
          mtimeMs: 1_000,
        },
      ],
    };
    const pack = createCanvasPack({
      host: { documents: memoryDocuments(), files },
      boundaries: false,
    });

    await expect(pack.importFolder()).resolves.toEqual(files.folder);
    expect(files.folderCalls).toEqual([undefined]);
  });

  it("reads a change the host noticed while closed and pushes one while open", async () => {
    const { workspace } = sample("A watched board");
    const documents = memoryDocuments({ "doc-a": envelopeOf(workspace, "doc-a") });
    documents.pending.push("doc-a");
    const pack = createCanvasPack({ host: { documents }, boundaries: true });

    await pack.bridge.loadDocument();
    expect(pack.libraryChanges()).toEqual(["doc-a"]);
    expect(pack.notices().at(-1)).toContain("changed on disk while Canvas was closed");

    documents.emitChange(["doc-a"]);
    expect(pack.libraryChanges()).toEqual(["doc-a"]);
    expect(pack.notices().at(-1)).toContain("changed on disk. Reopen");

    pack.dispose();
  });

  it("falls back to the store when a host has no recents service", async () => {
    const { workspace } = sample("A legacy board");
    const documents = memoryDocuments({ "doc-a": envelopeOf(workspace, "doc-a") });
    const pack = createCanvasPack({ host: { documents }, boundaries: false });

    const files = await pack.bridge.recentFiles();
    expect(files[0]?.name).toBe("Pack workspace");

    await pack.bridge.forgetRecent("doc-a");
    expect(documents.files.has("doc-a")).toBe(true);
    expect(pack.notices().at(-1)).toContain("no recent-file list");
  });
});
