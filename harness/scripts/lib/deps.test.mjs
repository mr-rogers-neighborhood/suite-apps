import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { packageManifestPaths, readDependencySpecs, versionDrift } from "./deps.mjs";

let root = null;

function workspace(tree) {
  root = mkdtempSync(join(tmpdir(), "suite-deps-"));
  for (const [path, manifest] of Object.entries(tree)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, JSON.stringify(manifest));
  }
  return root;
}

afterEach(() => {
  if (root !== null) rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("versionDrift", () => {
  it("is agreement when every repository asks for the same range", () => {
    expect(versionDrift([{ spec: "^1.17.1" }, { spec: "^1.17.1" }]).ok).toBe(true);
  });

  it("is drift when one repository is behind, which is the failure that matters", () => {
    const drift = versionDrift([{ spec: "^1.17.1" }, { spec: "^1.16.4" }]);
    expect(drift.ok).toBe(false);
    expect(drift.specs).toEqual(["^1.16.4", "^1.17.1"]);
  });

  it("is not a failure when nobody asks for the dependency", () => {
    expect(versionDrift([]).ok).toBe(true);
  });
});

describe("readDependencySpecs", () => {
  it("finds a dependency in a nested workspace package", () => {
    const dir = workspace({
      "package.json": { dependencies: { "loro-crdt": "^1.17.1" } },
      "apps/go/package.json": { dependencies: { "loro-crdt": "^1.16.4" } },
      "packages/core/package.json": { devDependencies: { "loro-crdt": "^1.17.1" } },
    });

    const specs = readDependencySpecs(dir, "loro-crdt");
    expect(specs.map((spec) => spec.spec).sort()).toEqual(["^1.16.4", "^1.17.1", "^1.17.1"]);
    expect(versionDrift(specs).ok).toBe(false);
  });

  it("ignores build output and installed packages", () => {
    const dir = workspace({
      "package.json": { dependencies: { "loro-crdt": "^1.17.1" } },
      "node_modules/some-pkg/package.json": { dependencies: { "loro-crdt": "^1.9.0" } },
      "reports/ci/workspace/package.json": { dependencies: { "loro-crdt": "^1.16.4" } },
      "dist/package.json": { dependencies: { "loro-crdt": "^1.0.0" } },
    });

    expect(readDependencySpecs(dir, "loro-crdt").map((spec) => spec.spec)).toEqual(["^1.17.1"]);
  });

  it("does not descend past the requested depth", () => {
    const dir = workspace({
      "package.json": {},
      "a/b/c/d/package.json": { dependencies: { "loro-crdt": "^1.16.4" } },
    });

    expect(readDependencySpecs(dir, "loro-crdt", 2)).toEqual([]);
    expect(readDependencySpecs(dir, "loro-crdt", 5)).toHaveLength(1);
  });

  it("survives a manifest that is not JSON", () => {
    const dir = workspace({ "package.json": { dependencies: { "loro-crdt": "^1.17.1" } } });
    mkdirSync(join(dir, "apps", "broken"), { recursive: true });
    writeFileSync(join(dir, "apps", "broken", "package.json"), "{ not json");
    expect(readDependencySpecs(dir, "loro-crdt").map((spec) => spec.spec)).toEqual(["^1.17.1"]);
  });

  it("lists manifests without depending on directory order", () => {
    const dir = workspace({
      "package.json": {},
      "apps/a/package.json": {},
      "apps/b/package.json": {},
    });
    const paths = packageManifestPaths(dir);
    expect(paths).toHaveLength(3);
    expect([...paths].sort()).toEqual(paths);
  });
});
