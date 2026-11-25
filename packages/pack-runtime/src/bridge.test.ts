import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmitter,
  createPackBridge,
  dateStamp,
  hostPlatform,
  PackFilePickerError,
  pickFolder,
  safeFileName,
  withPickedFile,
  withSaveFile,
  writeTextToHandle,
} from "./bridge.js";
import { memoryFiles, textOf } from "./testing/fakeHost.js";

interface FakeTarget {
  visibilityState?: string;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  fire(type: string): void;
  readonly listenerCount: number;
}

function fakeTarget(visibilityState = "visible"): FakeTarget {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    fire(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    get listenerCount() {
      let count = 0;
      for (const set of listeners.values()) count += set.size;
      return count;
    },
  };
}

const scope = globalThis as { document?: unknown; window?: unknown };

function installPage(visibilityState: string): { page: FakeTarget; view: FakeTarget } {
  const page = fakeTarget(visibilityState);
  const view = fakeTarget();
  scope.document = page;
  scope.window = view;
  return { page, view };
}

function bridge<Document>(
  overrides: Partial<Parameters<typeof createPackBridge<Document>>[0]> = {},
) {
  return createPackBridge<Document>({
    app: "Suite Test",
    noun: "document",
    host: {},
    boundaries: false,
    write: async () => undefined,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete scope.document;
  delete scope.window;
});

describe("the shared pack bridge", () => {
  it("keeps the newest notices and labels the console with the app", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const runtime = bridge();

    for (let index = 0; index < 25; index += 1) runtime.notice(`notice ${index}`);

    expect(runtime.notices()).toHaveLength(20);
    expect(runtime.notices()[0]).toBe("notice 5");
    expect(runtime.notices().at(-1)).toBe("notice 24");
    expect(warn).toHaveBeenCalledWith("Suite Test pack: notice 0");
  });

  it("names the missing documents service with the app and object", () => {
    const runtime = bridge();

    expect(() => runtime.documents()).toThrow(
      "This host does not provide the documents service, so Suite Test cannot open a document.",
    );
    expect(runtime.files()).toBeNull();
  });

  it("coalesces debounced edits into one write", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const runtime = bridge<string>({
      debounceMs: 250,
      write: async (document) => {
        written.push(document);
      },
    });
    runtime.setCurrent("one");

    runtime.markDirty();
    runtime.markDirty();
    await vi.advanceTimersByTimeAsync(249);
    expect(written).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(written).toEqual(["one"]);
  });

  it("serializes two boundaries instead of writing out of order", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let mostActive = 0;
    const runtime = bridge<string>({
      write: async () => {
        active += 1;
        mostActive = Math.max(mostActive, active);
        await gate;
        active -= 1;
      },
    });
    runtime.setCurrent("one");
    runtime.markDirty();

    const first = runtime.flush();
    const second = runtime.flush();
    await Promise.resolve();
    release();
    await Promise.all([first, second]);

    expect(mostActive).toBe(1);
  });

  it("retries a failed write at the next boundary and clears the failure", async () => {
    let failures = 1;
    const runtime = bridge<string>({
      write: async () => {
        if (failures > 0) {
          failures -= 1;
          throw new Error("disk is full");
        }
      },
    });
    runtime.setCurrent("one");
    runtime.markDirty();

    await expect(runtime.flush()).rejects.toThrow("disk is full");
    expect(runtime.failure()).toContain("disk is full");

    await runtime.flush();
    expect(runtime.failure()).toBeNull();
  });

  it("can keep a failed write as a value for a renderer that reports it", async () => {
    let writes = 0;
    const runtime = bridge<string>({
      captureFailure: true,
      retryOnFailure: false,
      write: async () => {
        writes += 1;
        throw new Error("disk is full");
      },
    });
    runtime.setCurrent("one");
    runtime.markDirty();

    await expect(runtime.flush()).resolves.toBeUndefined();
    expect(runtime.failure()).toContain("disk is full");

    await runtime.flush();
    expect(writes).toBe(1);
  });

  it("flushes at pagehide and at a hidden visibility change", async () => {
    const { page, view } = installPage("hidden");
    const written: string[] = [];
    const runtime = bridge<string>({
      boundaries: true,
      pageBoundaries: true,
      write: async (document) => {
        written.push(document);
      },
    });
    runtime.setCurrent("one");

    runtime.markDirty();
    page.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written).toEqual(["one"]);

    runtime.markDirty();
    view.fire("pagehide");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(written).toEqual(["one", "one"]);

    runtime.dispose();
    expect(page.listenerCount).toBe(0);
    expect(view.listenerCount).toBe(0);
  });

  it("ignores a visibility change that is not hidden", async () => {
    const { page } = installPage("visible");
    const written: string[] = [];
    const runtime = bridge<string>({
      boundaries: true,
      pageBoundaries: true,
      write: async (document) => {
        written.push(document);
      },
    });
    runtime.setCurrent("one");
    runtime.markDirty();

    page.fire("visibilitychange");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(written).toEqual([]);
    runtime.dispose();
  });

  it("flushes through the host lifecycle and removes its listeners on dispose", async () => {
    const written: string[] = [];
    const listeners = new Set<() => void | Promise<void>>();
    const runtime = bridge<string>({
      boundaries: true,
      host: {
        lifecycle: {
          onFlush(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          onSuspend(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
      write: async (document) => {
        written.push(document);
      },
    });
    runtime.setCurrent("one");
    runtime.markDirty();

    for (const listener of listeners) await listener();
    expect(written).toEqual(["one"]);

    runtime.dispose();
    expect(listeners.size).toBe(0);
  });

  it("clears a scheduled write when disposed", async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const runtime = bridge<string>({
      debounceMs: 250,
      write: async (document) => {
        written.push(document);
      },
    });
    runtime.setCurrent("one");
    runtime.markDirty();
    runtime.dispose();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(written).toEqual([]);
  });

  it("does not write when there is nothing new", async () => {
    let writes = 0;
    const runtime = bridge<string>({
      write: async () => {
        writes += 1;
      },
    });
    runtime.setCurrent("one");

    await runtime.flush();
    expect(writes).toBe(0);
  });

  it("reports that no document is open", async () => {
    const runtime = bridge<string>();
    runtime.markDirty();

    await expect(runtime.flush()).rejects.toThrow("No document is open.");
  });
});

describe("the shared file helpers", () => {
  it("reads through a picked handle and closes it", async () => {
    const files = memoryFiles();
    files.openQueue.push(new TextEncoder().encode("hi"));
    const seen: number[] = [];

    const result = await withPickedFile(
      files,
      [{ name: "Suite Test", extensions: ["test"] }],
      "This host has no file picker, so a document could not be imported.",
      () => undefined,
      async (handle) => {
        seen.push(handle.info.size);
        return new TextDecoder().decode(await handle.read());
      },
    );

    expect(result).toBe("hi");
    expect(seen).toEqual([2]);
    expect(
      await withPickedFile(
        files,
        [],
        "missing",
        () => undefined,
        async () => undefined,
      ),
    ).toBeNull();
  });

  it("closes the handle when the reader throws", async () => {
    const files = memoryFiles();
    files.openQueue.push(new Uint8Array([1]));
    const fail = vi.fn();

    await expect(
      withPickedFile(files, [], "missing", fail, async () => {
        throw new Error("bad bytes");
      }),
    ).rejects.toThrow("bad bytes");
    expect(fail).not.toHaveBeenCalled();
  });

  it("turns an absent or failing picker into a shared sentence", async () => {
    await expect(
      withPickedFile(
        null,
        [],
        "This host has no file picker, so a document could not be imported.",
        () => undefined,
        async () => undefined,
      ),
    ).rejects.toBeInstanceOf(PackFilePickerError);

    const files = memoryFiles();
    files.failOpen = new Error("no portal");
    await expect(
      withPickedFile(
        files,
        [],
        "missing",
        () => undefined,
        async () => undefined,
      ),
    ).rejects.toThrow("The file picker could not open: no portal");
  });

  it("writes text through the save picker and closes the file", async () => {
    const files = memoryFiles();
    const path = await withSaveFile(
      files,
      "document.txt",
      "This host has no file picker, so the document could not be exported.",
      () => undefined,
      async (handle) => {
        await writeTextToHandle(handle, "hello", "The document could not be written");
        return handle.info.name;
      },
    );

    expect(path).toBe("document.txt");
    expect(files.saved).toHaveLength(1);
    expect(files.saved[0]?.closed).toBe(true);
    expect(textOf(files.saved[0]?.bytes ?? new Uint8Array())).toBe("hello");
  });

  it("reports a cancelled save as null and a failed write with the app's sentence", async () => {
    const files = memoryFiles();
    files.cancelSave = true;
    expect(
      await withSaveFile(
        files,
        "document.txt",
        "missing",
        () => undefined,
        async () => "written",
      ),
    ).toBeNull();

    const failing = memoryFiles();
    failing.failWrite = new Error("disk is full");
    await expect(
      withSaveFile(
        failing,
        "document.txt",
        "missing",
        () => undefined,
        async (handle) => {
          await writeTextToHandle(handle, "hello", "The document could not be written");
          return handle.info.name;
        },
      ),
    ).rejects.toThrow("The document could not be written: disk is full");
  });

  it("copies a folder through the host's own picker", async () => {
    const files = memoryFiles();
    files.folder = { path: "imports/test", entries: [] };

    await expect(pickFolder(files, "missing")).resolves.toEqual(files.folder);
    expect(files.folderCalls).toEqual([undefined]);
    await expect(pickFolder(null, "This host cannot import a folder.")).rejects.toThrow(
      "This host cannot import a folder.",
    );
  });
});

describe("the shared labels", () => {
  it("builds a safe file name and a date stamp", () => {
    expect(safeFileName("My Board!", "workspace.canvas")).toBe("My-Board");
    expect(safeFileName("", "workspace.canvas")).toBe("workspace.canvas");
    expect(safeFileName("v1.2", "budget", { dots: false })).toBe("v1-2");
    expect(dateStamp(new Date("2026-11-25T12:00:00.000Z"))).toBe("2026-11-25");
  });

  it("reads the host platform or falls back", async () => {
    const fail = vi.fn();
    await expect(hostPlatform(async () => ({ platform: "linux" }), "unknown", fail)).resolves.toBe(
      "linux",
    );
    await expect(hostPlatform(async () => ({}), "unknown", fail)).resolves.toBe("unknown");
    await expect(
      hostPlatform(
        async () => {
          throw new Error("no info");
        },
        "suite-desk",
        fail,
      ),
    ).resolves.toBe("suite-desk");
    expect(fail).toHaveBeenCalledWith("could not read the host's platform", expect.any(Error));
  });

  it("delivers to every listener and isolates one that throws", () => {
    const fail = vi.fn();
    const emitter = createEmitter<number>();
    const seen: number[] = [];
    emitter.add((value) => seen.push(value));
    emitter.add(() => {
      throw new Error("listener failed");
    });

    emitter.emit(7, fail, "a listener failed");

    expect(seen).toEqual([7]);
    expect(fail).toHaveBeenCalledWith("a listener failed", expect.any(Error));
  });
});
