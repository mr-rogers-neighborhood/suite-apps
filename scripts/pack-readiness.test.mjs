import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  archivePathFor,
  entryProblems,
  formatMatrix,
  parseBuildOutput,
  READINESS_PACKS,
  summarizeContributions,
  summarizeManifest,
  summarizeTestReport,
} from "./pack-readiness.mjs";

const encoder = new TextEncoder();

function builtPage(extra = "") {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src 'self';"><script type="module" src="./assets/index-abc.js"></script>${extra}`;
}

describe("the pack readiness command", () => {
  it("reads the archive line a pack builder prints", () => {
    const text = [
      "✓ built in 413ms",
      "/repo/packs/budget/.dev/budget-0.4.2.suitepack  6 files  5013939 bytes  id=budget v0.4.2",
      "/repo/packs/budget/.dev/budget-0.4.2.suitepack.sha256  9477e84e8ee399ae3c1aa19888f65f242e80c2efa2ec4e345c91aaf273c16e93",
      "packs for: desktop, mobile",
    ].join("\n");
    assert.deepEqual(parseBuildOutput(text), {
      archivePath: "/repo/packs/budget/.dev/budget-0.4.2.suitepack",
      fileCount: 6,
      totalBytes: 5013939,
      id: "budget",
      version: "0.4.2",
      sha256: "9477e84e8ee399ae3c1aa19888f65f242e80c2efa2ec4e345c91aaf273c16e93",
    });
  });

  it("returns null when a build printed no archive", () => {
    assert.equal(parseBuildOutput("vite: done\n"), null);
  });

  it("names the archive from the app, its version and the repository root", () => {
    const budget = READINESS_PACKS.find((pack) => pack.app === "budget");
    assert.ok(budget);
    assert.equal(
      archivePathFor(budget, "1.2.3", "/repo"),
      "/repo/packs/budget/.dev/budget-1.2.3.suitepack",
    );
  });

  it("summarises capabilities, optional capabilities, contributions and documents", () => {
    const manifest = {
      id: "planner",
      name: "Suite Planner",
      version: "0.5.2",
      platforms: ["desktop", "mobile"],
      capabilities: ["documents", "files"],
      optionalCapabilities: ["commands"],
      contributions: {
        providers: [{ kind: "commands" }, { kind: "scopes" }],
        commands: [{ id: "planner.today" }],
      },
      documents: [{ id: "workspace", format: "suite.planner", version: 2, mode: "multi" }],
      files: [{ path: "index.html" }, { path: "assets/app.js" }],
    };
    assert.deepEqual(summarizeManifest(manifest), {
      id: "planner",
      name: "Suite Planner",
      version: "0.5.2",
      platforms: ["desktop", "mobile"],
      capabilities: ["documents", "files"],
      optionalCapabilities: ["commands"],
      contributions: "commands:1, providers:2",
      documents: [{ id: "workspace", format: "suite.planner", version: 2, mode: "multi" }],
      fileCount: 2,
    });
    assert.equal(summarizeContributions(undefined), "none");
    assert.equal(summarizeContributions({}), "none");
  });

  it("refuses an entry that would not launch as a pack", () => {
    const manifest = { entry: "index.html" };
    assert.deepEqual(entryProblems(manifest, new Map([["index.html", encoder.encode(builtPage())]])), []);

    const missing = entryProblems(manifest, new Map());
    assert.match(missing[0] ?? "", /not in the archive/u);

    assert.match(
      entryProblems(manifest, new Map([["index.html", encoder.encode("<p>plain page</p>")]]))[0] ?? "",
      /Content-Security-Policy/u,
    );
    assert.match(
      entryProblems(
        manifest,
        new Map([
          [
            "index.html",
            encoder.encode(
              '<meta http-equiv="Content-Security-Policy" content="default-src *"><script type="module" src="./app.js"></script>',
            ),
          ],
        ]),
      )[0] ?? "",
      /CSP/u,
    );
    assert.match(
      entryProblems(
        manifest,
        new Map([
          [
            "index.html",
            encoder.encode(
              '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\'"><p>empty</p>',
            ),
          ],
        ]),
      )[0] ?? "",
      /module script/u,
    );
  });

  it("checks the expected test files against a Vitest JSON report", () => {
    const report = {
      success: true,
      testResults: [
        {
          name: "/repo/packs/budget/pack/src/PackRender.test.tsx",
          status: "passed",
          assertionResults: [{ status: "passed" }, { status: "passed" }],
        },
        {
          name: "/repo/packs/budget/pack/src/renderer/app/Shell.test.tsx",
          status: "passed",
          assertionResults: [{ status: "passed" }],
        },
      ],
    };
    assert.deepEqual(
      summarizeTestReport(report, [
        "src/PackRender.test.tsx",
        "src/renderer/app/Shell.test.tsx",
      ]),
      { ok: true, files: 2, tests: 3, passed: 3, missing: [], failed: [] },
    );

    const missing = summarizeTestReport(report, ["src/Missing.test.tsx"]);
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.missing, ["src/Missing.test.tsx"]);

    const failed = summarizeTestReport(
      {
        success: false,
        testResults: [
          {
            name: "/repo/packs/budget/pack/src/PackRender.test.tsx",
            status: "failed",
            assertionResults: [{ status: "failed" }],
          },
        ],
      },
      ["src/PackRender.test.tsx"],
    );
    assert.equal(failed.ok, false);
    assert.deepEqual(failed.failed, ["src/PackRender.test.tsx"]);
  });

  it("prints one matrix row per pack with every proof column", () => {
    const rows = READINESS_PACKS.map((pack) => ({
      app: pack.app,
      version: "1.2.3",
      capabilities: ["documents"],
      optionalCapabilities: ["files"],
      contributions: "none",
      fileCount: 4,
      signature: true,
      shape: true,
      launch: true,
      install: true,
      primary: { ok: true, files: 1, tests: 2, passed: 2 },
      phone: {
        ok: pack.phone.length > 0,
        files: pack.phone.length,
        tests: pack.phone.length,
        passed: pack.phone.length,
      },
      phoneAbsent: pack.phone.length === 0 ? "absent (#387)" : "absent",
    }));
    const table = formatMatrix(rows);
    const lines = table.split("\n");
    assert.equal(lines.length, 6, "a header, a divider and four rows");
    assert.match(lines[0] ?? "", /Signature/u);
    assert.match(lines[0] ?? "", /Launch/u);
    assert.match(lines[0] ?? "", /Install\/remove/u);
    assert.match(lines[0] ?? "", /Phone smoke/u);
    assert.match(lines[2] ?? "", /^\| budget /u);
    assert.match(lines[3] ?? "", /^\| planner /u);
    assert.match(lines[4] ?? "", /^\| canvas /u);
    assert.match(lines[5] ?? "", /^\| help /u);
    assert.match(lines[4] ?? "", /absent \(#387\)/u);
  });
});
