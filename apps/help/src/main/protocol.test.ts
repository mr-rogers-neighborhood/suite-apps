import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assetFileFor } from "./protocol";

const ROOT = "/app/out/renderer";
const files = new Set([
  join(ROOT, "index.html"),
  join(ROOT, "assets/index-abc.js"),
  join(ROOT, "data/tree.json"),
  join(ROOT, "handbook/index.html"),
]);
const exists = (path: string) => files.has(path);

describe("assetFileFor", () => {
  it("serves an existing file at the origin", () => {
    expect(assetFileFor("suite-help://app/assets/index-abc.js", ROOT, exists)).toBe(
      join(ROOT, "assets/index-abc.js"),
    );
    expect(assetFileFor("suite-help://app/data/tree.json?v=1", ROOT, exists)).toBe(
      join(ROOT, "data/tree.json"),
    );
  });

  it("falls back to index.html for an extensionless SPA route", () => {
    expect(assetFileFor("suite-help://app/handbook/reference/commands", ROOT, exists)).toBe(
      join(ROOT, "index.html"),
    );
    expect(assetFileFor("suite-help://app/", ROOT, exists)).toBe(join(ROOT, "index.html"));
  });

  it("keeps a missing asset a 404 rather than answering with HTML", () => {
    expect(assetFileFor("suite-help://app/assets/gone.js", ROOT, exists)).toBeNull();
  });

  it("refuses another host, a traversal and an unreadable escape", () => {
    expect(assetFileFor("suite-help://other/index.html", ROOT, exists)).toBeNull();
    expect(assetFileFor("suite-help://app/../secret", ROOT, exists)).toBeNull();
    expect(assetFileFor("suite-help://app/handbook/%2F..%2Fsecret", ROOT, exists)).toBeNull();
  });
});
