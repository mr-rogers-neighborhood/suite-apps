import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { linkPacks } from "./pack-links.mjs";

const roots = [];

function workspace(apps = ["canvas"]) {
  const root = mkdtempSync(join(tmpdir(), "suite-pack-links-"));
  roots.push(root);
  for (const app of apps) {
    mkdirSync(join(root, "legacy", app, "node_modules"), { recursive: true });
    mkdirSync(join(root, "packs", app), { recursive: true });
  }
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("pack dependency links", () => {
  it("points each pack tree at its legacy shell's installed tree", () => {
    const root = workspace(["canvas", "help"]);
    const linked = linkPacks(root);

    assert.deepEqual(linked.sort(), ["packs/canvas/node_modules", "packs/help/node_modules"]);
    assert.equal(
      readlinkSync(join(root, "packs", "canvas", "node_modules")),
      join("..", "..", "legacy", "canvas", "node_modules"),
    );
  });

  it("replaces a stale link instead of nesting under it", () => {
    const root = workspace();
    symlinkSync(join(root, "missing"), join(root, "packs", "canvas", "node_modules"));

    linkPacks(root);

    assert.doesNotThrow(() => readlinkSync(join(root, "packs", "canvas", "node_modules")));
  });

  it("leaves a pack alone when its shell is not installed", () => {
    const root = mkdtempSync(join(tmpdir(), "suite-pack-links-"));
    roots.push(root);
    mkdirSync(join(root, "packs", "budget"), { recursive: true });
    writeFileSync(join(root, "packs", "budget", "keep"), "");

    assert.deepEqual(linkPacks(root), []);
  });
});
