import { type BudgetBridge, decodeBudgetFile } from "@suite/budget-core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../../../legacy/budget/src/renderer/src/App";
import { memoryDocuments, memoryFiles } from "./test/fakeHost";

/**
 * The pack's renderer, mounted the way the host mounts it.
 *
 * The prelude installs `window.suiteBudget` from the container's `window.suite`;
 * this test supplies the same two host services the shell's preload exposes and
 * then renders Budget's own app. It proves the entry is not a blank frame and
 * that the library, a document, and an export/import pair cross the pack bridge.
 * The Electron window and the `suite-pack://` protocol are exercised by the
 * shell's own tests; a window is not launched here.
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

  it("renders the launcher, opens a budget, and re-imports its own export", async () => {
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

    const exported = await bridge.exportBudget();
    expect(exported.canceled).toBe(false);
    const written = files.saved.at(-1)?.bytes;
    expect(written).toBeDefined();
    expect(decodeBudgetFile(new TextDecoder().decode(written)).isOk()).toBe(true);

    files.openQueue.push(written as Uint8Array);
    const imported = await bridge.importBudget();
    expect(imported.canceled).toBe(false);
    expect(imported.opened?.entry.name).toBe("My Budget");
    // Import adds a second copy rather than replacing the open budget.
    expect(documents.files.size).toBe(2);

    await waitFor(() => expect(screen.queryByText("Something went wrong")).toBeNull());
  });
});
