/**
 * Affected selection: the map that lets a pull request skip a row must not be
 * able to skip the wrong one.
 *
 * The synthetic graph covers the rules; the last block reads this repository so
 * a new workspace package cannot join the gate and be invisible to CI.
 *
 * spec: C4.1 C4.2 C4.3
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeAffected,
  dependentClosure,
  expandPattern,
  isDocPath,
  isSpecPath,
  projectFor,
  readProjects,
  workspacePatterns,
} from "./affected.mjs";
import { PIPELINE } from "./lib/pipeline.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PROJECTS = [
  { name: "@suite/ui", dir: "packages/ui", dependencies: [] },
  { name: "@suite/contracts", dir: "packages/contracts", dependencies: [] },
  { name: "@suite/canvas", dir: "legacy/canvas", dependencies: ["@suite/ui", "@suite/contracts"] },
  { name: "@suite/desk", dir: "hosts/desk", dependencies: ["@suite/ui"] },
  { name: "@suite/budget", dir: "legacy/budget", dependencies: ["@suite/ui"] },
  { name: "@suite/budget-pack", dir: "legacy/budget/packages/pack", dependencies: [] },
];

const ROWS = [
  { repo: "desk", package: "@suite/desk" },
  { repo: "canvas", package: "@suite/canvas" },
  { repo: "budget", package: "@suite/budget" },
];

function affected(paths) {
  return computeAffected({ paths, projects: PROJECTS, rows: ROWS });
}

function repos(result) {
  return result.rows.map((row) => row.repo);
}

describe("affected selection", () => {
  it("selects the app that owns the file and nobody else", () => {
    const result = affected(["legacy/canvas/src/board.tsx"]);
    assert.deepEqual(repos(result), ["canvas"]);
    assert.equal(result.docsOnly, false);
    assert.equal(result.global, false);
    assert.equal(result.e2e, false);
  });

  it("walks a shared package to every consumer that depends on it", () => {
    const result = affected(["packages/ui/src/button.tsx"]);
    assert.deepEqual(repos(result), ["desk", "canvas", "budget"]);
    assert.equal(result.e2e, false, "no row carries an e2e suite");
  });

  it("includes a dependent reached through another dependent", () => {
    const closure = dependentClosure(PROJECTS, ["@suite/contracts"]);
    assert.ok(closure.has("@suite/canvas"));
    assert.ok(!closure.has("@suite/budget"), "Budget does not consume contracts in this graph");
  });

  it("sends a docs-only change to no app row", () => {
    const result = affected(["docs/reference/status.md", "hosts/desk/docs/reference/foo.md"]);
    assert.deepEqual(repos(result), []);
    assert.equal(result.docsOnly, true);
    assert.equal(result.spec, false);
    assert.equal(result.e2e, false);
  });

  it("treats the spec corpus as docs plus the spec check", () => {
    const result = affected(["docs/spec/manifest.schema.json", "docs/spec/superapp.md"]);
    assert.deepEqual(repos(result), []);
    assert.equal(result.docsOnly, true);
    assert.equal(result.spec, true);
  });

  it("runs everything for a path outside every project", () => {
    const result = affected([".github/workflows/ci.yml"]);
    assert.deepEqual(repos(result), ["desk", "canvas", "budget"]);
    assert.equal(result.global, true);
    assert.equal(result.docsOnly, false);
    assert.equal(
      result.e2e,
      false,
      "a workflow change selects all rows but is not itself an app change",
    );
  });

  it("flags a workflow change for the actionlint step", () => {
    assert.equal(affected([".github/workflows/ci.yml"]).workflows, true);
    assert.equal(affected(["hosts/desk/src/main.ts"]).workflows, false);
    assert.equal(affected(["docs/reference/status.md"]).workflows, false);
  });

  it("runs nothing for a private package with no workspace dependent", () => {
    const result = affected(["legacy/budget/packages/pack/src/bridge.ts"]);
    assert.deepEqual(repos(result), []);
    assert.equal(result.global, false);
  });

  it("uses the longest matching project directory", () => {
    assert.equal(projectFor("legacy/budget/packages/pack/src/a.ts", PROJECTS).name, "@suite/budget-pack");
    assert.equal(projectFor("legacy/budget/src/a.ts", PROJECTS).name, "@suite/budget");
  });

  it("maps pack source to the legacy shell that declares it", () => {
    const result = affected(["packs/budget/pack/src/bridge.ts"]);
    assert.deepEqual(repos(result), ["budget"]);
    assert.equal(result.global, false);
  });

  it("classifies paths", () => {
    assert.equal(isDocPath("docs/modules/canvas.mdx"), true);
    assert.equal(isDocPath("legacy/help/docs/index.md"), true);
    assert.equal(isDocPath("RELEASES.md"), true);
    assert.equal(isDocPath("legacy/help/src/index.ts"), false);
    assert.equal(isSpecPath("docs/spec/fixtures.json"), true);
    assert.equal(isSpecPath("scripts/spec.test.mjs"), true);
    assert.equal(isSpecPath("docs/reference/status.md"), false);
  });
});

describe("workspace reading", () => {
  it("reads the real workspace patterns", () => {
    const patterns = workspacePatterns(ROOT);
    assert.ok(patterns.includes("hosts/*"), "hosts/* is declared");
    assert.ok(patterns.includes("packs/*"), "packs/* is declared");
    assert.ok(patterns.includes("packages/*"), "packages/* is declared");
  });

  it("expands a pattern to project directories", () => {
    const dirs = expandPattern(ROOT, "hosts/*");
    assert.ok(dirs.includes("hosts/desk"));
    assert.ok(dirs.includes("hosts/go"));
  });

  it("keeps every gate row in the workspace graph", () => {
    const projects = readProjects(ROOT);
    const names = new Set(projects.map((project) => project.name));
    for (const row of PIPELINE) {
      assert.ok(names.has(row.package), `${row.package} is a workspace project`);
      assert.ok(
        existsSync(join(ROOT, row.dir, "package.json")),
        `${row.dir} exists`,
      );
      if (row.pack !== undefined) {
        assert.ok(names.has(row.pack), `${row.pack} is a workspace project`);
      }
    }
  });

  it("maps a real app file to its gate row", () => {
    const projects = readProjects(ROOT);
    const result = computeAffected({
      paths: ["hosts/desk/src/main.ts"],
      projects,
      rows: PIPELINE,
    });
    assert.deepEqual(
      result.rows.map((row) => row.repo),
      ["desk"],
    );
    assert.equal(result.e2e, false);
  });

  it("runs e2e only for a row that marks one", () => {
    const result = computeAffected({
      paths: ["hosts/desk/src/main.ts"],
      projects: PROJECTS,
      rows: [{ repo: "desk", package: "@suite/desk", e2e: true }],
    });
    assert.equal(result.e2e, true);
  });

  it("maps a real shared package to its consumers", () => {
    const projects = readProjects(ROOT);
    const result = computeAffected({
      paths: ["packages/desktop/src/index.ts"],
      projects,
      rows: PIPELINE,
    });
    const selected = new Set(result.rows.map((row) => row.repo));
    assert.ok(selected.size >= 2, "a shared Electron policy package reaches several apps");
    assert.equal(result.global, false);
    assert.deepEqual(
      result.proofRows.map((row) => row.repo),
      ["desk", "help", "canvas", "planner", "budget"],
    );
  });

  it("selects only the affected desktop app for proofRows", () => {
    const projects = readProjects(ROOT);
    const budgetOnly = computeAffected({
      paths: ["legacy/budget/src/main/index.ts"],
      projects,
      rows: PIPELINE,
    });
    assert.deepEqual(
      budgetOnly.proofRows.map((row) => row.repo),
      ["budget"],
    );

    const goOnly = computeAffected({
      paths: ["hosts/go/src/App.tsx"],
      projects,
      rows: PIPELINE,
    });
    assert.deepEqual(goOnly.proofRows, []);
  });
});
