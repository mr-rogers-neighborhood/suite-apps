import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileStoreError } from "./errors.js";
import { PackFileStore } from "./store.js";

let root: string;
let store: PackFileStore;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "suite-host-files-"));
  store = await PackFileStore.open(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

function errorCode(value: unknown): string | undefined {
  return value instanceof FileStoreError ? value.code : undefined;
}

describe("PackFileStore", () => {
  it("writes, reads, lists and removes a file", async () => {
    await store.write("notes/first.txt", bytes("hello"));
    expect(text(await store.read("notes/first.txt"))).toBe("hello");
    expect((await store.list("notes")).map((entry) => entry.name)).toEqual(["first.txt"]);
    expect((await store.stat("notes/first.txt"))?.size).toBe(5);

    await store.remove("notes/first.txt");
    expect(await store.stat("notes/first.txt")).toBeNull();
    await expect(store.read("notes/first.txt")).rejects.toSatisfy(
      (error) => errorCode(error) === "not-found",
    );
  });

  it("creates nested directories and renames a file", async () => {
    await store.mkdir("a/b");
    await store.write("a/b/one.txt", bytes("one"));
    await store.rename("a/b/one.txt", "a/b/two.txt");

    expect(await store.stat("a/b/one.txt")).toBeNull();
    expect(text(await store.read("a/b/two.txt"))).toBe("one");
  });

  it("refuses a path outside the root without leaking it", async () => {
    for (const attempt of ["../outside", "/etc/passwd", "a/../../b"]) {
      try {
        await store.write(attempt, bytes("no"));
        throw new Error("expected a refusal");
      } catch (error) {
        expect(errorCode(error)).toBe("invalid-path");
        expect(String(error)).not.toContain(root);
      }
    }
  });

  it("refuses a symlink and a symlinked parent", async () => {
    const outside = await mkdtemp(join(tmpdir(), "suite-host-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(join(outside, "secret.txt"), join(root, "link.txt"));
      await symlink(outside, join(root, "linked-dir"));

      await expect(store.read("link.txt")).rejects.toSatisfy(
        (error) => errorCode(error) === "symlink" || errorCode(error) === "outside-root",
      );
      await expect(store.write("link.txt", bytes("no"))).rejects.toSatisfy(
        (error) => errorCode(error) === "symlink" || errorCode(error) === "outside-root",
      );
      await expect(store.write("linked-dir/new.txt", bytes("no"))).rejects.toSatisfy(
        (error) => errorCode(error) === "symlink" || errorCode(error) === "outside-root",
      );
      expect((await store.list("")).some((entry) => entry.name === "link.txt")).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("writes atomically and detects a stale expected mtime", async () => {
    const first = await store.write("note.txt", bytes("one"));
    await expect(
      store.write("note.txt", bytes("stale"), { expectedMtimeMs: first.mtimeMs - 10_000 }),
    ).rejects.toSatisfy((error) => errorCode(error) === "conflict");

    const second = await store.write("note.txt", bytes("two"), {
      expectedMtimeMs: first.mtimeMs,
    });
    expect(text(await store.read("note.txt"))).toBe("two");
    expect(second.mtimeMs).toBeGreaterThanOrEqual(first.mtimeMs);
  });

  it("backups a file to a dated sibling", async () => {
    await store.write("note.txt", bytes("one"));
    const backup = await store.backup("note.txt");

    expect(backup.startsWith("note.txt.")).toBe(true);
    expect(backup.endsWith(".bak")).toBe(true);
    expect(text(await store.read(backup))).toBe("one");
    expect(await readFile(join(root, backup), "utf8")).toBe("one");
  });

  it("holds a lock until it is released", async () => {
    const lock = store.lock("note.txt");
    expect(() => store.lock("note.txt")).toThrow("file is locked");
    await lock.release();
    const again = store.lock("note.txt");
    await again.release();
  });

  it("enforces a per-file size ceiling", async () => {
    const small = await PackFileStore.open(root, { maxFileBytes: 4 });
    await expect(small.write("note.txt", bytes("12345"))).rejects.toSatisfy(
      (error) => errorCode(error) === "too-large",
    );
  });

  it("does not expose another store's files", async () => {
    const otherRoot = await mkdtemp(join(tmpdir(), "suite-host-other-"));
    try {
      const other = await PackFileStore.open(otherRoot);
      await store.write("private.txt", bytes("mine"));
      await expect(other.read("private.txt")).rejects.toSatisfy(
        (error) => errorCode(error) === "not-found",
      );
    } finally {
      await rm(otherRoot, { recursive: true, force: true });
    }
  });

  it("refuses to remove a non-empty directory unless recursive", async () => {
    await store.write("dir/one.txt", bytes("one"));
    await expect(store.remove("dir")).rejects.toSatisfy((error) => errorCode(error) === "io");
    await store.remove("dir", { recursive: true });
    expect(await store.stat("dir")).toBeNull();
  });
});
