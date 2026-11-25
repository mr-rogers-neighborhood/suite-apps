/**
 * Slop host scoping: the decision that lets a docs or scripts push skip the
 * host builds must not skip one that changed.
 *
 * The synthetic graph covers the rules; the last block reads this repository so
 * the two hosts are the pipeline's rows, not names this file remembers.
 *
 * spec: C4.1 C4.2
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readProjects } from "./affected.mjs";
import { PIPELINE } from "./lib/pipeline.mjs";
import { classifySlopPath, computeSlopTargets, slopTargets } from "./slop-targets.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PROJECTS = [
  { name: "@suite/theme", dir: "packages/theme", dependencies: [] },
  { name: "@suite/ui", dir: "packages/ui", dependencies: ["@suite/theme"] },
  { name: "@suite/contracts", dir: "packages/contracts", dependencies: [] },
  { name: "@suite/pack", dir: "packages/pack", dependencies: ["@suite/contracts"] },
  { name: "@suite/desk", dir: "hosts/desk", dependencies: ["@suite/ui", "@suite/pack"] },
  { name: "@suite/go-app", dir: "hosts/go", dependencies: ["@suite/ui"] },
  { name: "@suite/canvas", dir: "legacy/canvas", dependencies: ["@suite/ui"] },
];

const TARGETS = [
  { key: "desk", package: "@suite/desk" },
  { key: "go", package: "@suite/go-app" },
];

function selected(paths) {
  return computeSlopTargets({ paths, projects: PROJECTS, targets: TARGETS });
}

describe("slop host scoping", () => {
  it("builds only Desk for a Desk source change", () => {
    assert.deepEqual(selected(["hosts/desk/src/main.ts"]), {
      desk: true,
      go: false,
      shared: false,
      sharedPaths: [],
      changed: 1,
      any: true,
    });
  });

  it("builds only Go for a Go source change", () => {
    const result = selected(["hosts/go/src/App.tsx"]);
    assert.equal(result.desk, false);
    assert.equal(result.go, true);
    assert.equal(result.any, true);
  });

  it("builds both when a shared package reaches both hosts", () => {
    const result = selected(["packages/ui/src/button.tsx"]);
    assert.equal(result.desk, true);
    assert.equal(result.go, true);
    assert.equal(result.shared, false, "reached through the dependency graph, not a fallback");
  });

  it("builds both for a dependency reached indirectly", () => {
    const result = selected(["packages/theme/src/tokens.ts"]);
    assert.equal(result.desk, true);
    assert.equal(result.go, true);
  });

  it("builds only the host that depends on the package", () => {
    const result = selected(["packages/contracts/src/index.ts"]);
    assert.equal(result.desk, true, "Desk reaches contracts through @suite/pack");
    assert.equal(result.go, false, "Go does not depend on contracts in this graph");
  });

  it("publishes nothing for docs and workflow files", () => {
    const result = selected(["docs/reference/status.md", ".github/workflows/slop.yml"]);
    assert.equal(result.any, false);
    assert.equal(result.desk, false);
    assert.equal(result.go, false);
    assert.equal(result.shared, false);
  });

  it("builds both for packaging scripts and root workspace files", () => {
    for (const path of ["scripts/android-release.mjs", "pnpm-lock.yaml", "packaging/desk.yml"]) {
      const result = selected([path]);
      assert.equal(result.shared, true, `${path} is a shared input`);
      assert.equal(result.desk, true);
      assert.equal(result.go, true);
    }
  });

  it("builds both for a path outside every project", () => {
    const result = selected(["Makefile"]);
    assert.equal(result.shared, true);
    assert.deepEqual(result.sharedPaths, ["Makefile"]);
    assert.equal(result.any, true);
  });

  it("publishes nothing for an app neither host depends on", () => {
    const result = selected(["legacy/canvas/src/board.tsx"]);
    assert.equal(result.any, false);
  });

  it("classifies a path as ignore, shared or owning project", () => {
    assert.equal(classifySlopPath("README.md", PROJECTS).kind, "ignore");
    assert.equal(classifySlopPath(".gitignore", PROJECTS).kind, "ignore");
    assert.equal(classifySlopPath("scripts/flatpak.mjs", PROJECTS).kind, "shared");
    assert.equal(classifySlopPath("hosts/desk/src/a.ts", PROJECTS).kind, "project");
  });

  it("names the host rows from the pipeline", () => {
    assert.deepEqual(slopTargets(PIPELINE), TARGETS);
  });
});

describe("slop targets in this repository", () => {
  it("finds both hosts in the workspace graph", () => {
    const projects = readProjects(ROOT);
    const names = new Set(projects.map((project) => project.name));
    for (const target of slopTargets(PIPELINE)) {
      assert.ok(names.has(target.package), `${target.package} is a workspace project`);
    }
  });

  it("declares the two host display names the workflow uses", () => {
    const workflow = readFileSync(join(ROOT, ".github/workflows/slop.yml"), "utf8");
    for (const target of slopTargets(PIPELINE)) {
      assert.ok(
        workflow.includes(`needs.targets.outputs.${target.key}`),
        `slop.yml conditions on ${target.key}`,
      );
    }
  });

  it("scopes a real Desk change to Desk only", () => {
    const result = computeSlopTargets({
      paths: ["hosts/desk/src/packs.ts"],
      projects: readProjects(ROOT),
      targets: slopTargets(PIPELINE),
    });
    assert.equal(result.desk, true);
    assert.equal(result.go, false);
  });

  it("scopes a real shared package change to both hosts", () => {
    const result = computeSlopTargets({
      paths: ["packages/pack/src/catalogue.ts"],
      projects: readProjects(ROOT),
      targets: slopTargets(PIPELINE),
    });
    assert.equal(result.desk, true);
    assert.equal(result.go, true);
  });
});
