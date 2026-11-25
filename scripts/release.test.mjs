import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changelogProblem,
  changelogSection,
  dirtyTreeProblem,
  gateProblems,
  versionFromPackage,
} from "./release.mjs";

describe("version names", () => {
  it("reads the release version from package.json", () => {
    assert.equal(versionFromPackage('{"name":"@suite/sync-server","version":"0.11.3"}'), "0.11.3");
  });

  it("is null rather than guessing", () => {
    assert.equal(versionFromPackage('{"name":"@suite/sync-server"}'), null);
    assert.equal(versionFromPackage("not json"), null);
  });
});

describe("changelog", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "Nothing yet.",
    "",
    "## [0.11.3] - 2026-11-08",
    "",
    "The release we mean.",
    "",
    "## [0.11.2] - 2026-11-07",
    "",
    "Older.",
    "",
  ].join("\n");

  it("finds the section for the version being released", () => {
    assert.equal(changelogSection(changelog, "0.11.3"), "The release we mean.");
    assert.equal(changelogProblem(changelog, "0.11.3"), null);
  });

  it("refuses a version with no matching heading", () => {
    const problem = changelogProblem(changelog, "0.11.4");
    assert.match(problem, /0\.11\.4/u);
    assert.match(problem, /changelog/u);
  });

  it("does not accept Unreleased as the version", () => {
    assert.match(changelogProblem(changelog, "Unreleased"), /Unreleased/u);
  });
});

describe("release refusals", () => {
  it("refuses a dirty tree and names what is changed", () => {
    assert.equal(dirtyTreeProblem(""), null);
    const problem = dirtyTreeProblem(" M scripts/release.mjs\n?? scripts/release.test.mjs\n");
    assert.match(problem, /uncommitted/u);
    assert.match(problem, /scripts\/release\.mjs/u);
  });

  it("refuses a tree with no gate proof", () => {
    const problems = gateProblems(null, "abcdef1234567890");
    assert.equal(problems.length, 1);
    assert.match(problems[0], /gate-status/u);
  });

  it("refuses a gate that failed, ran on the working tree, or proved another commit", () => {
    const head = "abcdef1234567890";
    assert.match(gateProblems({ ok: false, fresh: true, commit: head }, head).join(), /did not pass/u);
    assert.match(
      gateProblems({ ok: true, fresh: false, commit: head }, head).join(),
      /working tree/u,
    );
    assert.match(
      gateProblems({ ok: true, fresh: true, commit: "1234567" }, head).join(),
      /proved 1234567/u,
    );
  });

  it("refuses a status left by a partial --only run", () => {
    const head = "abcdef1234567890";
    const problems = gateProblems(
      { ok: true, fresh: true, commit: "abcdef1", only: "canvas" },
      head,
    );
    assert.match(problems.join(), /--only canvas/u);

    assert.deepEqual(
      gateProblems({ ok: true, fresh: true, commit: "abcdef1", only: null }, head),
      [],
    );
  });

  it("refuses a status left by a trunk prelude run", () => {
    const head = "abcdef1234567890";
    const problems = gateProblems(
      { ok: true, fresh: true, commit: "abcdef1", only: null, prelude: true },
      head,
    );
    assert.match(problems.join(), /prelude/u);
    assert.equal(problems.length, 1);
  });

  it("accepts a fresh, passing gate that names HEAD", () => {
    assert.deepEqual(
      gateProblems({ ok: true, fresh: true, commit: "abcdef1" }, "abcdef1234567890"),
      [],
    );
  });

  it("refuses a descendant as well as another commit", () => {
    const problems = gateProblems({ ok: true, fresh: true, commit: "abcdef1" }, "1234567890abcdef");
    assert.match(problems.join(), /proved abcdef1/u);
  });
});
