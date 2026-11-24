import {
  decodeWorkspaceFile,
  type ExportResult,
  type ImportResult,
  todayKey,
  WorkspaceDocument,
} from "@suite/planner-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/src/App";
import { bootDocument } from "../../src/renderer/src/store/snapshotStore";
import { useUiStore } from "../../src/renderer/src/store/uiStore";
import { memoryDocuments, memoryFiles } from "./test/fakeHost";

/**
 * Planner's renderer, mounted the way the host mounts it.
 *
 * The prelude installs `window.suitePlanner` from the host's `window.suite`; this test supplies the
 * same services the shell's preload exposes and then boots and renders Planner's own app. It
 * proves the entry is not a blank frame, that a task and a day page cross the bridge, and that an
 * export re-imports with the same content. The Electron window and `suite-pack://` protocol are
 * exercised by the shell's own tests; a window is not launched here.
 */
describe("Planner as a pack", () => {
  beforeEach(() => {
    useUiStore.setState({
      view: "today",
      selectedDate: todayKey(),
      selectedTaskId: null,
      notice: null,
    });
  });

  afterEach(() => {
    cleanup();
    const global = globalThis as {
      __suitePlannerPack?: { dispose(): void };
      suite?: unknown;
      suitePlanner?: unknown;
    };
    global.__suitePlannerPack?.dispose();
    delete global.__suitePlannerPack;
    delete global.suitePlanner;
    delete global.suite;
  });

  it("boots from the host, writes a task and a page, and re-imports its own export", async () => {
    const documents = memoryDocuments();
    const files = memoryFiles();
    (globalThis as { suite?: unknown }).suite = {
      documents,
      files,
      info: async () => ({ platform: "linux" }),
    };
    await import("./prelude");

    const { replica, created } = await bootDocument();
    expect(created).toBe(true);
    render(<App replica={replica} created={created} />);

    fireEvent.click(await screen.findByRole("button", { name: /new planner/i }));

    const capture = await screen.findByLabelText("Capture a task");
    fireEvent.change(capture, { target: { value: "Write the pack" } });
    const form = capture.closest("form");
    if (form === null) throw new Error("the capture input is not in a form");
    fireEvent.submit(form);
    expect((await screen.findAllByText("Write the pack")).length).toBeGreaterThan(0);

    const intention = screen.getByLabelText(/Intention for/u);
    fireEvent.change(intention, { target: { value: "Ship the pack" } });
    fireEvent.blur(intention);

    const dev = (globalThis as { __suitePlannerPack?: { flush(): Promise<void> } })
      .__suitePlannerPack;
    if (dev === undefined) throw new Error("the prelude did not install the pack");
    await dev.flush();

    const stored = documents.files.get("planner");
    expect(stored).toBeDefined();
    const reopened = WorkspaceDocument.fromSnapshot(stored as Uint8Array);
    expect(reopened.listTasks().map((task) => task.title)).toContain("Write the pack");
    expect(reopened.getDay(todayKey())?.intention).toBe("Ship the pack");

    const bridge = (
      globalThis as {
        suitePlanner?: {
          exportWorkspace(): Promise<ExportResult>;
          importWorkspace(): Promise<ImportResult>;
        };
      }
    ).suitePlanner;
    if (bridge === undefined) throw new Error("the prelude did not install the bridge");

    const exported = await bridge.exportWorkspace();
    expect(exported.canceled).toBe(false);
    const written = files.saved.at(-1)?.bytes;
    expect(written).toBeDefined();
    expect(decodeWorkspaceFile(new TextDecoder().decode(written as Uint8Array)).isOk()).toBe(true);

    files.openQueue.push(written as Uint8Array);
    const imported = await bridge.importWorkspace();
    expect(imported.canceled).toBe(false);

    // The same document is on screen after the host hands the imported snapshot back.
    await waitFor(() => expect(screen.getAllByText("Write the pack").length).toBeGreaterThan(0));
    await waitFor(() =>
      expect(screen.getByLabelText(/Intention for/u)).toHaveValue("Ship the pack"),
    );
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});
