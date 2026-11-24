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
  { name: "@suite/canvas", dir: "apps/canvas", dependencies: ["@suite/ui", "@suite/contracts"] },
  { name: "@suite/shell", dir: "apps/shell", dependencies: ["@suite/ui"] },
  { name: "@suite/budget", dir: "apps/budget", dependencies: ["@suite/ui"] },
  { name: "@suite/budget-pack", dir: "apps/budget/packages/pack", dependencies: [] },
];

const ROWS = [
  { repo: "shell", package: "@suite/shell" },
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
    const result = affected(["apps/canvas/src/board.tsx"]);
    assert.deepEqual(repos(result), ["canvas"]);
    assert.equal(result.docsOnly, false);
    assert.equal(result.global, false);
    assert.equal(result.e2e, false);
  });

  it("walks a shared package to every consumer that depends on it", () => {
    const result = affected(["packages/ui/src/button.tsx"]);
    assert.deepEqual(repos(result), ["shell", "canvas", "budget"]);
    assert.equal(result.e2e, false, "no row carries an e2e suite");
  });

  it("includes a dependent reached through another dependent", () => {
    const closure = dependentClosure(PROJECTS, ["@suite/contracts"]);
    assert.ok(closure.has("@suite/canvas"));
    assert.ok(!closure.has("@suite/budget"), "Budget does not consume contracts in this graph");
  });

  it("sends a docs-only change to no app row", () => {
    const result = affected(["docs/reference/status.md", "apps/shell/docs/reference/foo.md"]);
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
    assert.deepEqual(repos(result), ["shell", "canvas", "budget"]);
    assert.equal(result.global, true);
    assert.equal(result.docsOnly, false);
    assert.equal(
      result.e2e,
      false,
      "a workflow change selects all rows but is not itself an app change",
    );
  });

  it("runs nothing for a private package with no workspace dependent", () => {
    const result = affected(["apps/budget/packages/pack/src/bridge.ts"]);
    assert.deepEqual(repos(result), []);
    assert.equal(result.global, false);
  });

  it("uses the longest matching project directory", () => {
    assert.equal(projectFor("apps/budget/packages/pack/src/a.ts", PROJECTS).name, "@suite/budget-pack");
    assert.equal(projectFor("apps/budget/src/a.ts", PROJECTS).name, "@suite/budget");
  });

  it("classifies paths", () => {
    assert.equal(isDocPath("docs/modules/canvas.mdx"), true);
    assert.equal(isDocPath("apps/help/docs/index.md"), true);
    assert.equal(isDocPath("RELEASES.md"), true);
    assert.equal(isDocPath("apps/help/src/index.ts"), false);
    assert.equal(isSpecPath("docs/spec/fixtures.json"), true);
    assert.equal(isSpecPath("scripts/spec.test.mjs"), true);
    assert.equal(isSpecPath("docs/reference/status.md"), false);
  });
});

describe("workspace reading", () => {
  it("reads the real workspace patterns", () => {
    const patterns = workspacePatterns(ROOT);
    assert.ok(patterns.includes("apps/*"), "apps/* is declared");
    assert.ok(patterns.includes("packages/*"), "packages/* is declared");
  });

  it("expands a pattern to project directories", () => {
    const dirs = expandPattern(ROOT, "apps/*");
    assert.ok(dirs.includes("apps/shell"));
    assert.ok(dirs.includes("apps/canvas"));
  });

  it("keeps every gate row in the workspace graph", () => {
    const projects = readProjects(ROOT);
    const names = new Set(projects.map((project) => project.name));
    for (const row of PIPELINE) {
      assert.ok(names.has(row.package), `${row.package} is a workspace project`);
      assert.ok(
        existsSync(join(ROOT, "apps", row.repo, "package.json")),
        `apps/${row.repo} exists`,
      );
    }
  });

  it("maps a real app file to its gate row", () => {
    const projects = readProjects(ROOT);
    const result = computeAffected({
      paths: ["apps/shell/src/main.ts"],
      projects,
      rows: PIPELINE,
    });
    assert.deepEqual(
      result.rows.map((row) => row.repo),
      ["shell"],
    );
    assert.equal(result.e2e, false);
  });

  it("runs e2e only for a row that marks one", () => {
    const result = computeAffected({
      paths: ["apps/shell/src/main.ts"],
      projects: PROJECTS,
      rows: [{ repo: "shell", package: "@suite/shell", e2e: true }],
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
  });
});
