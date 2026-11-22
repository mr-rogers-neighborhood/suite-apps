import { describe, expect, it } from "vitest";
import { FileStoreError } from "./errors.js";
import { isInside, isSafeRelativePath, resolveInside } from "./path.js";

describe("pack file paths", () => {
  it("accepts relative paths and the root where allowed", () => {
    expect(isSafeRelativePath("note.txt")).toBe(true);
    expect(isSafeRelativePath("boards/today.canvas")).toBe(true);
    expect(isSafeRelativePath("")).toBe(false);
    expect(isSafeRelativePath("", true)).toBe(true);
  });

  it("refuses absolute, climbing, backslash and control paths", () => {
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("../outside")).toBe(false);
    expect(isSafeRelativePath("a/../../b")).toBe(false);
    expect(isSafeRelativePath("a\\b")).toBe(false);
    expect(isSafeRelativePath("a\u0000b")).toBe(false);
  });

  it("resolves inside the root and refuses a climb", () => {
    expect(resolveInside("/pack", "a/b.txt")).toBe("/pack/a/b.txt");
    expect(resolveInside("/pack", "")).toBe("/pack");
    expect(() => resolveInside("/pack", "../outside")).toThrow(FileStoreError);
  });

  it("checks the root boundary on a separator", () => {
    expect(isInside("/pack/a", "/pack")).toBe(true);
    expect(isInside("/pack", "/pack")).toBe(true);
    expect(isInside("/pack-two/a", "/pack")).toBe(false);
  });
});
