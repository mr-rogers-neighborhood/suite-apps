import { afterEach, describe, expect, it } from "vitest";
import { bridgeMissing, desktopBridge, REQUIRED_BRIDGE_METHODS } from "../../../../legacy/canvas/src/host/bridge";
import { memoryDocuments, memoryFiles } from "./test/fakeHost";

/**
 * The entry that makes Canvas's renderer a pack.
 *
 * The app boots from `window.suiteDesktop`; this asserts the prelude installs the shape it already
 * knows, with no sync methods, so the pack cannot quietly keep a transport the host does not serve.
 */
describe("Canvas's pack prelude", () => {
  afterEach(() => {
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

  it("installs the desktop bridge the renderer already boots from", async () => {
    const documents = memoryDocuments();
    const files = memoryFiles();
    Object.assign(globalThis, {
      suite: { documents, files, info: async () => ({ platform: "linux" }) },
    });

    await import("./prelude");

    const bridge = desktopBridge();
    expect(bridge).not.toBeNull();
    if (bridge === null) throw new Error("the prelude installed no bridge");
    expect(bridge.host).toBe("desktop");
    expect(bridgeMissing(bridge)).toEqual([]);

    for (const method of REQUIRED_BRIDGE_METHODS) {
      expect(typeof bridge[method]).toBe("function");
    }
    // A host with no relay service gets no pack-side transport.
    expect((bridge as { onSyncIncoming?: unknown }).onSyncIncoming).toBeUndefined();
    expect(typeof bridge.saveTextFile).toBe("function");

    const dev = (globalThis as { __suiteCanvasPack?: { documentId(): string | null } })
      .__suiteCanvasPack;
    if (dev === undefined) throw new Error("the prelude installed no dev handle");
    expect(dev.documentId()).toBeNull();
  });
});
