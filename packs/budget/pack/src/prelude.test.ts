import type { BudgetBridge } from "@suite/budget-core";
import { afterEach, describe, expect, it } from "vitest";
import { memoryDocuments, memoryFiles } from "./test/fakeHost";

/**
 * The one side effect the pack adds: `window.suiteBudget` over `window.suite`.
 *
 * `bridge.test.ts` covers the library directly; this file proves the prelude
 * installs it from the container's global and that the renderer's own entry sees
 * the shape it declares.
 */
describe("the prelude", () => {
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

  it("installs window.suiteBudget over a fake window.suite", async () => {
    const documents = memoryDocuments();
    const files = memoryFiles();
    (globalThis as { suite?: unknown }).suite = {
      documents,
      files,
      info: async () => ({ platform: "linux" }),
    };

    await import("./prelude");

    const installed = (globalThis as { suiteBudget?: BudgetBridge }).suiteBudget;
    expect(installed).toBeDefined();
    if (installed === undefined) throw new Error("the prelude did not install the bridge");

    const opened = await installed.createBudget({
      name: "Prelude budget",
      currency: "USD",
      template: "blank",
    });
    expect((await installed.listBudgets()).map((entry) => entry.name)).toEqual(["Prelude budget"]);
    expect(await installed.platform()).toBe("linux");

    const exported = await installed.exportBudget();
    expect(exported.canceled).toBe(false);
    expect(files.saved).toHaveLength(1);

    const dev = (globalThis as { __suiteBudgetPack?: { documentId(): string | null } })
      .__suiteBudgetPack;
    expect(dev?.documentId()).toBe(opened.entry.id);
  });
});
