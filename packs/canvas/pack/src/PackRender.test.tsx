import "fake-indexeddb/auto";

import {
  buildWorkspaceFile,
  readWorkspaceFile,
  WorkspaceDocument,
  type WorkspaceFileManifest,
} from "@suite/graph";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { desktopBridge } from "../../../../legacy/canvas/src/host/bridge";
import { memoryDocuments, memoryFiles, textOf } from "./test/fakeHost";

/**
 * Canvas's renderer, mounted the way the pack host mounts it.
 *
 * The prelude installs `window.suiteDesktop` from the host's `window.suite`; this test supplies the
 * same services the shell's preload exposes and then boots and renders Canvas's own app over a host
 * document. It proves the entry is not a blank frame, that a board opens from the host envelope,
 * that an edit reaches the file at a boundary, and that an export re-imports with the same content
 * through the host's file picker. The Electron window and `suite-pack://` protocol are exercised by
 * the shell's own tests; a window is not launched here.
 */

const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";

// React Flow measures its container; jsdom has no layout engine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

function counts(workspace: WorkspaceDocument): WorkspaceFileManifest {
  return {
    boards: workspace.listBoards().length,
    cards: workspace.listCards().length,
    types: workspace.listTypes().length,
    tags: workspace.listTags().length,
  };
}

function cardTitle(workspace: WorkspaceDocument, index = 0): string {
  const card = workspace.listCards()[index];
  return card === undefined ? "" : workspace.cardTitle(card.id);
}

afterEach(() => {
  cleanup();
  const scope = globalThis as {
    __suiteCanvasPack?: { dispose(): void };
    suite?: unknown;
    suiteDesktop?: unknown;
  };
  scope.__suiteCanvasPack?.dispose();
  delete scope.__suiteCanvasPack;
  delete scope.suiteDesktop;
  delete scope.suite;
});

describe("Canvas as a pack", () => {
  it("opens a board, saves an edit, exports it and re-imports it", async () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard({ name: "Pack board" });
    const card = workspace.createCard({
      boardId: board.id,
      position: { x: 0, y: 0 },
      fromTemplate: false,
    });
    workspace.setTitleText(card.id, "Board from the pack");
    workspace.renameWorkspace("Pack workspace");

    const documents = memoryDocuments({
      [WORKSPACE_ID]: new TextEncoder().encode(
        JSON.stringify(
          buildWorkspaceFile({
            workspaceId: WORKSPACE_ID,
            snapshot: new Uint8Array(workspace.exportSnapshot()),
            manifest: counts(workspace),
          }),
        ),
      ),
    });
    const files = memoryFiles();
    Object.assign(globalThis, {
      suite: { documents, files, info: async () => ({ platform: "linux" }) },
    });

    await import("./prelude");

    const bridge = desktopBridge();
    if (bridge === null) throw new Error("the prelude installed no bridge");

    // The renderer reads its session once at import time, so this order is the boot order.
    const { configureDesktopSession } = await import("../../../../legacy/canvas/src/session/desktopDocument");
    await configureDesktopSession(bridge);

    const { default: App } = await import("../../../../legacy/canvas/src/App");
    render(<App />);

    // The board and its card came out of the host's document envelope.
    expect(await screen.findByText("Board from the pack")).toBeInTheDocument();

    const { useCanvasStore } = await import("../../../../legacy/canvas/src/store/useCanvasStore");
    act(() => {
      useCanvasStore.getState().workspace.setTitleText(card.id, "Edited in the pack");
    });
    await act(async () => {
      await useCanvasStore.getState().flush();
    });

    const savedBytes = documents.files.get(WORKSPACE_ID);
    if (savedBytes === undefined) throw new Error("the host document disappeared");
    expect(cardTitle(readWorkspaceFile(textOf(savedBytes)).workspace)).toBe("Edited in the pack");

    // Export through the Workspace menu, which now writes through the host's save picker.
    // The menu is lazy-loaded, so wait for it rather than assuming it shared the board's frame.
    fireEvent.click(await screen.findByTestId("workspace-menu"));
    fireEvent.click(await screen.findByTestId("workspace-export-backup"));
    await waitFor(() => expect(files.saved).toHaveLength(1));

    const exported = files.saved[0];
    if (exported === undefined) throw new Error("the export wrote no file");
    const exportedWorkspace = readWorkspaceFile(textOf(exported.bytes)).workspace;
    expect(exported.name).toMatch(/\.canvas$/u);
    expect(cardTitle(exportedWorkspace)).toBe("Edited in the pack");

    // Re-import the same bytes through the open picker. The pack copies the document into its
    // store under a fresh id and reloads; the reload is observed as the new current document.
    files.openQueue.push(new Uint8Array(exported.bytes));
    await act(async () => {
      await bridge.openFileDialog();
    });

    expect(documents.files.size).toBe(2);
    const importedId = [...documents.files.keys()].find((id) => id !== WORKSPACE_ID);
    if (importedId === undefined) throw new Error("the import created no document");
    const importedBytes = documents.files.get(importedId);
    if (importedBytes === undefined) throw new Error("the imported document disappeared");
    const imported = readWorkspaceFile(textOf(importedBytes));
    expect(imported.file.workspaceId).toBe(importedId);
    expect(imported.workspace.listBoards()).toHaveLength(1);
    expect(cardTitle(imported.workspace)).toBe("Edited in the pack");

    const dev = (globalThis as { __suiteCanvasPack?: { documentId(): string | null } })
      .__suiteCanvasPack;
    expect(dev?.documentId()).toBe(importedId);
  });
});
