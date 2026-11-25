import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LINT_FINDINGS,
  LINT_MISCONFIGURED,
  LINT_NOTHING_INSPECTED,
  checkedFileCount,
  ignoredEveryGivenPath,
  lintOutcome,
} from "./lib/lintGuard.mjs";

/**
 * Biome's own closing summary is the only evidence that separates "this code
 * has a finding" from "this run never reached the code" (issue #425). These
 * tests pin the reading of that line, not biome's behaviour.
 */
describe("biome run summary", () => {
  it("reads the file count from the closing summary", () => {
    assert.equal(checkedFileCount("Checked 1110 files in 1506ms. No fixes applied.\n"), 1110);
    assert.equal(checkedFileCount("Checked 1 file in 2ms.\n"), 1);
  });

  it("sums every chunk's summary", () => {
    const output = "Checked 200 files in 10ms.\nChecked 37 files in 4ms.\n";
    assert.equal(checkedFileCount(output), 237);
  });

  it("returns null when biome printed no summary at all", () => {
    assert.equal(checkedFileCount("configuration ━━━\n  × Biome exited because the configuration"), null);
    assert.equal(checkedFileCount(""), null);
  });

  it("recognises the note biome prints when every given path was ignored", () => {
    const ignored = [
      "i These paths were provided but ignored:",
      "",
      "- .dev/tmpcheck",
    ].join("\n");
    assert.equal(ignoredEveryGivenPath(ignored), true);
    assert.equal(ignoredEveryGivenPath("Checked 0 files in 2ms."), false);
  });
});

describe("lint outcome", () => {
  it("passes only when biome passed and inspected files", () => {
    assert.equal(lintOutcome({ status: 0, output: "Checked 42 files in 3ms. No fixes applied." }), 0);
  });

  it("reports findings as findings", () => {
    const output = "Checked 42 files in 3ms.\nFound 2 errors.";
    assert.equal(lintOutcome({ status: 1, output }), LINT_FINDINGS);
  });

  it("reports a check that inspected nothing as such, not as a finding", () => {
    // A clean exit over zero files is the same problem as a red one: nothing
    // was checked, so neither status is a result about the code.
    assert.equal(
      lintOutcome({ status: 0, output: "Checked 0 files in 2ms." }),
      LINT_NOTHING_INSPECTED,
    );
    assert.equal(
      lintOutcome({ status: 1, output: "Checked 0 files in 2ms." }),
      LINT_NOTHING_INSPECTED,
    );
  });

  it("reports ignored paths as nothing inspected, whatever the exit status", () => {
    const output = "These paths were provided but ignored:\n\n- .dev/tmpcheck\n";
    assert.equal(lintOutcome({ status: 1, output }), LINT_NOTHING_INSPECTED);
    assert.equal(lintOutcome({ status: 0, output }), LINT_NOTHING_INSPECTED);
  });

  it("separates a run that could not start from a finding", () => {
    assert.equal(lintOutcome({ status: null, output: "" }), LINT_MISCONFIGURED);
  });
});
