import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PIPELINE } from "./lib/pipeline.mjs";
import {
  evaluateProofOutcome,
  formatProofMarkdown,
  parsePlaywrightReport,
  selectProofApps,
} from "./proof-of-changes.mjs";

describe("desktop proof runner", () => {
  it("selects all five desktop apps by default and excludes sync and go", () => {
    const selected = selectProofApps({ rows: PIPELINE });
    assert.deepEqual(
      selected.map((row) => row.repo),
      ["shell", "help", "canvas", "planner", "budget"],
    );
  });

  it("rejects non-desktop apps when passed to --only", () => {
    assert.throws(() => selectProofApps({ only: "go", rows: PIPELINE }), /unknown desktop app/);
    assert.throws(() => selectProofApps({ only: "sync", rows: PIPELINE }), /unknown desktop app/);
  });

  it("extracts scenario steps from a Playwright JSON report", () => {
    const scenarios = parsePlaywrightReport({
      suites: [
        {
          suites: [
            {
              specs: [
                {
                  title: "assigns a category @proof",
                  ok: true,
                  tests: [
                    {
                      results: [
                        {
                          status: "passed",
                          duration: 1420,
                          steps: [
                            { title: "Open document", duration: 820 },
                            { title: "Assign $100", duration: 400 },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    assert.equal(scenarios.length, 1);
    assert.equal(scenarios[0].status, "passed");
    assert.deepEqual(
      scenarios[0].steps.map((step) => step.title),
      ["Open document", "Assign $100"],
    );
  });

  it("formats a markdown Proof of Changes block with step evidence and artifact links", () => {
    const markdown = formatProofMarkdown({
      commit: "abc1234",
      displayMode: "headless (ozone)",
      results: [
        {
          repo: "budget",
          package: "@suite/budget",
          ok: true,
          durationMs: 1850,
          detail: "passed",
          scenarios: [
            {
              title: "creates a budget document @proof",
              status: "passed",
              durationMs: 1400,
              steps: [
                { title: "Create and open a .budget document", durationMs: 900, error: null },
                { title: "Assign $100 to Rent / Mortgage", durationMs: 300, error: null },
              ],
              error: null,
            },
          ],
          screenshots: [
            { name: "01-budget-open.png", relPath: "budget/01-budget-open.png" },
            { name: "02-category-assigned.png", relPath: "budget/02-category-assigned.png" },
          ],
          trace: { name: "trace.zip", relPath: "budget/trace.zip" },
        },
      ],
    });

    assert.match(markdown, /^## Proof of Changes/u);
    assert.match(markdown, /`abc1234`.*`headless \(ozone\)`.*1\/1 passed/u);
    assert.match(markdown, /Create and open a \.budget document \(ok, 0\.9s\)/u);
    assert.match(markdown, /\[02-category-assigned\.png\]\(budget\/02-category-assigned\.png\)/u);
    assert.match(markdown, /\[trace\.zip\]\(budget\/trace\.zip\)/u);
  });

  it("fails when screenshot artifacts are missing or empty", () => {
    const missing = evaluateProofOutcome({
      exitStatus: 0,
      scenarios: [{ status: "passed" }],
      screenshots: [],
      emptyScreenshots: [],
    });
    assert.equal(missing.ok, false);
    assert.match(missing.detail, /no screenshot artifacts/);

    const empty = evaluateProofOutcome({
      exitStatus: 0,
      scenarios: [{ status: "passed" }],
      screenshots: [{ name: "01-open.png", relPath: "shell/01-open.png" }],
      emptyScreenshots: ["02-focus.png"],
    });
    assert.equal(empty.ok, false);
    assert.match(empty.detail, /empty screenshot artifact/);

    const valid = evaluateProofOutcome({
      exitStatus: 0,
      scenarios: [{ status: "passed" }],
      screenshots: [{ name: "01-open.png", relPath: "shell/01-open.png" }],
      emptyScreenshots: [],
    });
    assert.equal(valid.ok, true);
  });
});
