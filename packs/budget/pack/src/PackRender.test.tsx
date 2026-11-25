import { type BudgetBridge, BudgetDocument, decodeBudgetFile } from "@suite/budget-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./renderer/App";
import { memoryDocuments, memoryFiles } from "./test/fakeHost";

/**
 * Budget's pack renderer, mounted the way the host mounts it.
 *
 * The prelude installs `window.suiteBudget` from the container's `window.suite`;
 * this test supplies the same two host services the shell's preload exposes and
 * then renders Budget's own app. It proves the entry is not a blank frame, that
 * a budget opens through the launcher, that an edit is written at a durability
 * boundary, and that the export re-imports as a working budget. The Electron
 * window and the `suite-pack://` protocol are exercised by the host's own tests;
 * a window is not launched here.
 */
describe("Budget as a pack", () => {
  afterEach(() => {
    const global = globalThis as {
      __suiteBudgetPack?: { dispose(): void };
      suite?: unknown;
      suiteBudget?: unknown;
    };
    global.__suiteBudgetPack?.dispose();
    delete global.__suiteBudgetPack;
    delete global.suiteBudget;
    delete global.suite;
  });

  it("opens, edits, saves, exports and re-imports a budget", async () => {
    const documents = memoryDocuments();
    const files = memoryFiles();
    (globalThis as { suite?: unknown }).suite = {
      documents,
      files,
      info: async () => ({ platform: "linux" }),
    };
    await import("./prelude");

    render(<App />);
    expect(await screen.findByText("No budgets yet")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /new budget/i }));
    fireEvent.click(await screen.findByRole("button", { name: /create budget/i }));

    // The budget view replaced the launcher: the name is in the menu bar, the
    // plan is drawn, and no error modal was raised.
    await waitFor(() => expect(screen.getAllByText("My Budget").length).toBeGreaterThan(0));
    expect(screen.queryByText("Something went wrong")).toBeNull();
    expect(documents.files.size).toBe(1);

    const bridge = (globalThis as { suiteBudget?: BudgetBridge }).suiteBudget;
    if (bridge === undefined) throw new Error("the prelude did not install the bridge");

    // Edit: a real CRDT update from Budget's own document layer, committed the
    // way the renderer commits one, then written at the flush boundary.
    const open = await bridge.info();
    const source = BudgetDocument.fromSnapshot(await bridge.loadSnapshot());
    source.updateSettings({ currency: "EUR" });
    await bridge.commit(source.loro.export({ mode: "update" }));
    await (globalThis as { __suiteBudgetPack?: { flush(): Promise<void> } }).__suiteBudgetPack
      ?.flush();

    const saved = documents.files.get(open.id);
    expect(saved).toBeDefined();
    expect(BudgetDocument.fromSnapshot(saved as Uint8Array).getSettings().currency).toBe("EUR");

    // Export: the pack writes a real `.budget` file through the host picker.
    const exported = await bridge.exportBudget();
    expect(exported.canceled).toBe(false);
    const written = files.saved.at(-1)?.bytes;
    expect(written).toBeDefined();
    expect(decodeBudgetFile(new TextDecoder().decode(written)).isOk()).toBe(true);

    // Re-import: the exported bytes become a second document, carrying the edit.
    files.openQueue.push(written as Uint8Array);
    const imported = await bridge.importBudget();
    expect(imported.canceled).toBe(false);
    expect(imported.opened?.entry.name).toBe("My Budget");
    expect(imported.opened?.entry.id).not.toBe(open.id);
    expect(
      BudgetDocument.fromSnapshot(imported.opened?.snapshot as Uint8Array).getSettings().currency,
    ).toBe("EUR");
    expect(documents.files.size).toBe(2);

    await waitFor(() => expect(screen.queryByText("Something went wrong")).toBeNull());
  });
});
