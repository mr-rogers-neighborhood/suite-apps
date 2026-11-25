import { describe, expect, it } from "vitest";
import { FileStoreError, joinUnderRoot, LockTable, PACK_FILE_MAX_BYTES } from "./core.js";

/**
 * The pure half of the pack-file rules.
 *
 * Suite Go's WebView cannot import the Node-backed store, so it imports this
 * entry instead. These tests pin what both hosts must refuse, and prove the
 * entry has no Node dependency by using it without a filesystem.
 */
describe("pack file core", () => {
  it("joins a validated path under a host root", () => {
    expect(joinUnderRoot("pack-files/alpha", "notes/today.txt")).toBe(
      "pack-files/alpha/notes/today.txt",
    );
    expect(joinUnderRoot("pack-files/alpha/", "", true)).toBe("pack-files/alpha/");
  });

  it("refuses a climb before it joins anything", () => {
    expect(() => joinUnderRoot("pack-files/alpha", "../beta/secret")).toThrow(FileStoreError);
    expect(() => joinUnderRoot("pack-files/alpha", "/etc/passwd")).toThrow(FileStoreError);
  });

  it("keeps one writer per path", async () => {
    const table = new LockTable();
    const lock = table.acquire("notes.txt", "alpha");

    expect(table.isLocked("notes.txt")).toBe(true);
    expect(() => table.acquire("notes.txt", "alpha")).toThrow(FileStoreError);

    await lock.release();
    expect(table.isLocked("notes.txt")).toBe(false);
  });

  it("releases every lock one owner holds", () => {
    const table = new LockTable();
    table.acquire("a.txt", "alpha");
    table.acquire("b.txt", "alpha");
    table.acquire("c.txt", "beta");

    table.releaseAll("alpha");

    expect(table.isLocked("a.txt")).toBe(false);
    expect(table.isLocked("c.txt")).toBe(true);
  });

  it("publishes the one byte cap a host must share", () => {
    expect(PACK_FILE_MAX_BYTES).toBe(256 * 1024 * 1024);
  });
});
