import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkPackShape } from "./pack-shape.mjs";

const SCHEMA = join(dirname(dirname(fileURLToPath(import.meta.url))), "docs", "spec", "manifest.schema.json");
const roots = [];

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** A minimal workspace: one app that declares a pack and one that does not. */
function workspace({ pack = true, manifest = {}, packageJson = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "suite-pack-shape-"));
  roots.push(root);

  write(
    join(root, "apps", "budget", "package.json"),
    json({ name: "@suite/budget", version: "0.4.1", ...(pack ? { suite: { pack: true } } : {}), ...packageJson }),
  );
  const packDir = join(root, "apps", "budget", "pack");
  write(
    join(packDir, "manifest.json"),
    json({
      id: "budget",
      name: "Suite Budget",
      version: "0.4.1",
      entry: "index.html",
      contractVersion: 1,
      capabilities: ["documents", "files"],
      ...manifest,
    }),
  );
  write(join(packDir, "README.md"), "# Pack\n");
  write(join(packDir, "vite.config.ts"), "export default {};\n");
  write(join(packDir, "src", "prelude.ts"), "export {};\n");
  write(join(packDir, "src", "prelude.test.ts"), "// test\n");
  return { root, packDir };
}

function check(root) {
  return checkPackShape({ root, schemaPath: SCHEMA });
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("the pack shape check", () => {
  it("accepts the required minimum and permits extra files", () => {
    const { root, packDir } = workspace();
    write(join(packDir, "src", "bridge.ts"), "export {};\n");
    write(join(packDir, "vitest.config.mts"), "export default {};\n");

    const result = check(root);
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.deepEqual(result.packs, [{ app: "budget", dir: join("apps", "budget", "pack") }]);
  });

  it("refuses a missing required file or directory", () => {
    const { root } = workspace();
    rmSync(join(root, "apps", "budget", "pack", "README.md"));
    rmSync(join(root, "apps", "budget", "pack", "src"), { recursive: true, force: true });

    const result = check(root);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.endsWith("README.md: missing required pack file")));
    assert.ok(result.problems.some((problem) => problem.endsWith("/src: missing required pack directory")));
  });

  it("refuses a manifest version that is not the app version", () => {
    const { root } = workspace({ manifest: { version: "0.1.0" } });

    const result = check(root);
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((problem) =>
        problem.includes('version "0.1.0" does not match the app version "0.4.1"'),
      ),
    );
  });

  it("refuses a hand-written file list or signature in the source manifest", () => {
    const { root } = workspace({
      manifest: {
        files: [{ path: "index.html", sha256: "a".repeat(64), bytes: 1 }],
        signature: "not-the-build's",
      },
    });

    const result = check(root);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes("manifest.json: files is generated")));
    assert.ok(
      result.problems.some((problem) => problem.includes("manifest.json: signature is generated")),
    );
  });

  it("refuses a generated directory in the pack source", () => {
    for (const generated of ["dist", "node_modules", ".vite"]) {
      const { root, packDir } = workspace();
      mkdirSync(join(packDir, generated), { recursive: true });

      const result = check(root);
      assert.equal(result.ok, false, generated);
      assert.ok(
        result.problems.some((problem) => problem.includes(`${generated}: generated directory`)),
        generated,
      );
    }
  });

  it("refuses a pack without a test", () => {
    const { root, packDir } = workspace();
    rmSync(join(packDir, "src", "prelude.test.ts"));

    const result = check(root);
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((problem) => problem.includes(": no pack test;")));
  });

  it("refuses a field the schema does not declare, and names it", () => {
    const { root } = workspace({ manifest: { aspirational: true } });

    const result = check(root);
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((problem) =>
        problem.includes("manifest.json.aspirational: manifest.schema.json declares no such field"),
      ),
    );
  });

  it("refuses a capability the schema does not define", () => {
    const { root } = workspace({ manifest: { capabilities: ["documents", "telepathy"] } });

    const result = check(root);
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some((problem) =>
        problem.includes('manifest.json.capabilities[1]: "telepathy" is not a value'),
      ),
    );
  });

  it("refuses a platform whose host does not serve the pack's capabilities", () => {
    const { root } = workspace({
      manifest: { platforms: ["desktop", "mobile"], capabilities: ["documents", "relay"] },
    });

    const result = check(root);
    assert.equal(result.ok, false);
    assert.ok(
      result.problems.some(
        (problem) =>
          problem.includes('platforms "mobile" cannot run') && problem.includes("needs `relay`"),
      ),
      result.problems.join("\n"),
    );
  });

  it("accepts a kind this tree has no host for, and a desktop pack that fits", () => {
    const { root } = workspace({
      manifest: { platforms: ["desktop", "tv"], capabilities: ["documents", "files"] },
    });

    const result = check(root);
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
  });

  it("reports an undeclared legacy pack instead of enforcing it", () => {
    const { root } = workspace({ pack: false });

    const result = check(root);
    assert.equal(result.ok, true);
    assert.deepEqual(result.packs, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].app, "budget");
    assert.match(result.skipped[0].reason, /not declared packable/u);
  });
});
