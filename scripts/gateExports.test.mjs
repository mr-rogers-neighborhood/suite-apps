import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { KEEP_EXPORTS, pruneGateExports } from "./lib/gateExports.mjs";
import { discoverScriptTests } from "./lib/gateTests.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

function scratch() {
  return mkdtempSync(join(tmpdir(), "gate-exports-"));
}

/** An export directory with a fixed mtime, so "newest" is not the filesystem's clock. */
function exportAt(gateDir, name, at) {
  const path = join(gateDir, name);
  mkdirSync(path);
  utimesSync(path, at, at);
  return path;
}

describe("gate export retention", () => {
  it("keeps the newest N exports and removes the rest", () => {
    const gateDir = scratch();
    try {
      const oldest = exportAt(gateDir, "aaaaaaa", new Date("2026-01-01T00:00:00Z"));
      const older = exportAt(gateDir, "bbbbbbb", new Date("2026-01-02T00:00:00Z"));
      const recent = exportAt(gateDir, "ccccccc", new Date("2026-01-03T00:00:00Z"));
      const newest = exportAt(gateDir, "ddddddd", new Date("2026-01-04T00:00:00Z"));

      const removed = pruneGateExports(gateDir, newest);

      assert.equal(KEEP_EXPORTS, 2);
      assert.deepEqual(removed, [older, oldest]);
      assert.equal(existsSync(oldest), false);
      assert.equal(existsSync(older), false);
      assert.equal(existsSync(recent), true);
      assert.equal(existsSync(newest), true);
    } finally {
      rmSync(gateDir, { recursive: true, force: true });
    }
  });

  it("never removes the export in use, even when it is not among the newest", () => {
    const gateDir = scratch();
    try {
      const inUse = exportAt(gateDir, "aaaaaaa", new Date("2026-01-01T00:00:00Z"));
      const older = exportAt(gateDir, "bbbbbbb", new Date("2026-01-02T00:00:00Z"));
      const recent = exportAt(gateDir, "ccccccc", new Date("2026-01-03T00:00:00Z"));
      const newest = exportAt(gateDir, "ddddddd", new Date("2026-01-04T00:00:00Z"));

      const removed = pruneGateExports(gateDir, inUse);

      assert.deepEqual(removed, [older]);
      assert.equal(existsSync(inUse), true);
      assert.equal(existsSync(older), false);
      assert.equal(existsSync(recent), true);
      assert.equal(existsSync(newest), true);
    } finally {
      rmSync(gateDir, { recursive: true, force: true });
    }
  });

  it("leaves unknown entries and tarballs alone", () => {
    const gateDir = scratch();
    try {
      exportAt(gateDir, "aaaaaaa", new Date("2026-01-01T00:00:00Z"));
      exportAt(gateDir, "bbbbbbb", new Date("2026-01-02T00:00:00Z"));
      const newest = exportAt(gateDir, "ccccccc", new Date("2026-01-03T00:00:00Z"));

      const notes = join(gateDir, "notes");
      mkdirSync(notes);
      const tarball = join(gateDir, "ddddddd.tar");
      writeFileSync(tarball, "not an export");
      const looseFile = join(gateDir, "eeeeeee");
      writeFileSync(looseFile, "a sha-shaped file, not an export directory");

      pruneGateExports(gateDir, newest);

      assert.equal(existsSync(notes), true);
      assert.equal(existsSync(tarball), true);
      assert.equal(existsSync(looseFile), true);
    } finally {
      rmSync(gateDir, { recursive: true, force: true });
    }
  });

  it("tolerates a missing gate directory", () => {
    const parent = scratch();
    try {
      const gateDir = join(parent, "does-not-exist");
      assert.deepEqual(pruneGateExports(gateDir, join(gateDir, "aaaaaaa")), []);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe("gate test discovery", () => {
  it("runs exactly the scripts/*.test.mjs files in the gated tree", () => {
    const listing = readdirSync(join(ROOT, "scripts"), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
      .map((entry) => `scripts/${entry.name}`)
      .sort();

    assert.deepEqual(discoverScriptTests(ROOT), listing);
    assert.deepEqual(discoverScriptTests(ROOT), [...discoverScriptTests(ROOT)].sort());
    assert.ok(listing.length > 0, "the gate discovers at least one script test");
  });
});
