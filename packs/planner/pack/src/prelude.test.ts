import type { PlannerBridge } from "@suite/planner-core";
import { afterEach, describe, expect, it } from "vitest";
import { memoryDocuments, memoryFiles } from "./test/fakeHost";

/**
 * The one side effect the pack adds: `window.suitePlanner` over `window.suite`.
 *
 * `bridge.test.ts` covers the adapter directly; this file proves the prelude installs it from the
 * host's global and that the renderer's own entry sees the shape it declares.
 */
describe("the prelude", () => {
  afterEach(() => {
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

  it("installs window.suitePlanner over a fake window.suite", async () => {
    const documents = memoryDocuments();
    const files = memoryFiles();
    (globalThis as { suite?: unknown }).suite = {
      documents,
      files,
      info: async () => ({ platform: "linux" }),
    };

    await import("./prelude");

    const installed = (globalThis as { suitePlanner?: PlannerBridge }).suitePlanner;
    expect(installed).toBeDefined();
    if (installed === undefined) throw new Error("the prelude did not install the bridge");

    expect(await installed.loadSnapshot()).toBeNull();
    expect(await installed.wasCreated?.()).toBe(true);
    expect((await installed.info()).path).toBe("Planner.planner");
    expect(await installed.platform()).toBe("linux");

    const exported = await installed.exportWorkspace();
    expect(exported.canceled).toBe(false);
    expect(files.saved).toHaveLength(1);

    const dev = (globalThis as { __suitePlannerPack?: { documentId(): string | null } })
      .__suitePlannerPack;
    expect(dev?.documentId()).toBe("planner");
  });
});
