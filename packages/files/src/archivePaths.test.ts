import { describe, expect, it } from "vitest";
import { archivePathProblem, isSafeArchivePath } from "./archivePaths.js";

describe("archivePathProblem", () => {
  it.each([
    "manifest.json",
    "legacy/canvas/workspace.canvas",
    "legacy/budget/household.budget",
    "README.txt",
    "a-1/b_2/c.3",
  ])("accepts %s", (entry) => {
    expect(archivePathProblem(entry)).toBeNull();
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["/etc/passwd", "absolute"],
    ["C:/Windows/system32", "drive-letter"],
    ["c:relative", "drive-letter"],
    ["apps\\canvas\\x", "backslash"],
    ["../secret", "traversal"],
    ["documents/../../secret", "traversal"],
    ["documents/./x", "traversal"],
    ["documents//x", "traversal"],
    ["documents/%2e%2e/secret", "traversal"],
    ["documents/%2E%2E/secret", "traversal"],
    ["documents/a%2Fb", "traversal"],
    ["documents/a%00b", "control-character"],
    ["documents/a\u0007b", "control-character"],
    ["documents/trailing.", "trailing-dot-or-space"],
    ["documents/trailing ", "trailing-dot-or-space"],
    ["documents/CON", "reserved-name"],
    ["documents/con.txt", "reserved-name"],
    ["documents/LPT1/data.bin", "reserved-name"],
    ["documents/%zz", "malformed-escape"],
  ])("refuses %s as %s", (entry, reason) => {
    expect(archivePathProblem(entry)).toBe(reason);
  });

  it("refuses a path longer than a kilobyte", () => {
    expect(archivePathProblem(`a/${"b".repeat(1100)}`)).toBe("too-long");
  });

  it("accepts a name that merely contains a reserved word", () => {
    expect(archivePathProblem("documents/console.txt")).toBeNull();
    expect(archivePathProblem("documents/com10.txt")).toBeNull();
  });
});

describe("isSafeArchivePath", () => {
  it("is the predicate form", () => {
    expect(isSafeArchivePath("legacy/canvas/workspace.canvas")).toBe(true);
    expect(isSafeArchivePath("../workspace.canvas")).toBe(false);
  });
});
