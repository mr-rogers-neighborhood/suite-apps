import { access, copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MainDocumentStore, type StoredDocument } from "./store.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A document whose bytes and snapshot are both its one string value. */
class FixtureDocument implements StoredDocument<string> {
  #value: string;

  constructor(value = "one") {
    this.#value = value;
  }

  get value(): string {
    return this.#value;
  }

  set value(next: string) {
    this.#value = next;
  }

  snapshot(): Uint8Array {
    return encoder.encode(this.#value);
  }

  applyUpdate(update: Uint8Array): void {
    this.#value = decoder.decode(update);
  }

  getSnapshot(): string {
    return this.#value;
  }
}

const cleanups: string[] = [];
let directory = "";

async function fixture() {
  directory = await mkdtemp(join(tmpdir(), "suite-document-runtime-"));
  cleanups.push(directory);
  return {
    doc: new FixtureDocument(),
    path: join(directory, "fixture.document"),
    tempPath: join(directory, "fixture.document.tmp"),
    backupPath: join(directory, "fixture.backup.document"),
  };
}

beforeEach(async () => {
  directory = "";
});

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("MainDocumentStore", () => {
  it("should write through a temp file and rename it into place", async () => {
    const { doc, path, tempPath } = await fixture();
    const store = new MainDocumentStore({
      doc,
      path,
      tempPath,
      serialize: (current) => current.getSnapshot(),
    });

    await store.flush();

    expect(await readFile(path, "utf8")).toBe("one");
    await expect(access(tempPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("should keep the previous file in the backup before the rename", async () => {
    const { doc, path, backupPath } = await fixture();
    const store = new MainDocumentStore({
      doc,
      path,
      serialize: (current) => current.getSnapshot(),
      backup: async (current) => {
        try {
          await copyFile(current, backupPath);
        } catch {
          // First save: there is no previous file to keep.
        }
      },
    });

    await store.flush();
    await expect(access(backupPath)).rejects.toMatchObject({ code: "ENOENT" });

    doc.value = "two";
    await store.flush();

    expect(await readFile(backupPath, "utf8")).toBe("one");
    expect(await readFile(path, "utf8")).toBe("two");
  });

  it("should copy before the temp write when the app asks for that order", async () => {
    const { doc, path, tempPath } = await fixture();
    let tempExisted = false;
    const store = new MainDocumentStore({
      doc,
      path,
      tempPath,
      serialize: (current) => current.getSnapshot(),
      backupOrder: "before-temp",
      backup: async () => {
        tempExisted = await access(tempPath).then(
          () => true,
          () => false,
        );
      },
    });

    await store.flush();

    expect(tempExisted).toBe(false);
    expect(await readFile(path, "utf8")).toBe("one");
  });

  it("should debounce a burst of edits into one save", async () => {
    vi.useFakeTimers();
    const { doc, path } = await fixture();
    const serialize = vi.fn((current: FixtureDocument) => current.getSnapshot());
    const store = new MainDocumentStore({ doc, path, serialize });

    store.scheduleSave();
    await vi.advanceTimersByTimeAsync(200);
    store.scheduleSave();
    await vi.advanceTimersByTimeAsync(399);

    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });

    await vi.advanceTimersByTimeAsync(1);
    await store.flush();

    expect(serialize).toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe("one");
  });

  it("should flush a pending save immediately and keep the chain alive after a failure", async () => {
    const { doc, path } = await fixture();
    let failing = true;
    const store = new MainDocumentStore({
      doc,
      path,
      serialize: (current) => {
        if (failing) throw new Error("disk full");
        return current.getSnapshot();
      },
      logWriteError: () => {},
    });

    store.scheduleSave();
    await store.flush();

    expect(store.lastError).toBe("disk full");
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });

    failing = false;
    doc.value = "recovered";
    await store.flush();

    expect(store.lastError).toBeNull();
    expect(await readFile(path, "utf8")).toBe("recovered");
  });

  it("should apply a committed update and export the same serialized bytes", async () => {
    const { doc, path } = await fixture();
    const target = join(directory, "export.document");
    const store = new MainDocumentStore({
      doc,
      path,
      serialize: (current) => current.getSnapshot(),
    });

    store.commit(encoder.encode("two"));
    await store.flush();
    await store.exportTo(target);

    expect(store.getSnapshot()).toBe("two");
    expect(Buffer.from(store.snapshot())).toEqual(Buffer.from("two"));
    expect(await readFile(target, "utf8")).toBe("two");
    expect(await readFile(path, "utf8")).toBe("two");
  });

  it("should write the same fixture bytes before and after a second save", async () => {
    const { doc, path } = await fixture();
    const fixtureBytes = '{\n  "format": "suite.document-runtime.fixture",\n  "value": "one"\n}\n';
    const store = new MainDocumentStore({ doc, path, serialize: () => fixtureBytes });

    await store.flush();
    const first = await readFile(path, "utf8");

    await store.flush();
    const second = await readFile(path, "utf8");

    expect(first).toBe(fixtureBytes);
    expect(second).toBe(first);
  });
});
