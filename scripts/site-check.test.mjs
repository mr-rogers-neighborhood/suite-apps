import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ROOT } from "./release-status.mjs";
import { readSitePages, siteProblems } from "./site-check.mjs";

/**
 * The current release list. Tests pass it directly, so no assertion reaches the
 * network or `gh`; the only live read is the CLI's own `existingReleases()` call.
 */
const releases = [
  { tagName: "suite-2026.11.25", isDraft: false, isLatest: true },
  { tagName: "suite-preview-2026.11.25", isDraft: false },
  { tagName: "suite-nightly-2026.11.25", isDraft: false },
  { tagName: "suite-slop-2026.11.25-b1dfc56", isDraft: false },
];

const newest = {
  stable: "suite-2026.11.25",
  preview: "suite-preview-2026.11.25",
  nightly: "suite-nightly-2026.11.25",
  slop: "suite-slop-2026.11.25-b1dfc56",
};

/** The source surfaces, without a `site/dist` build, so the test is deterministic. */
function sourcePages() {
  return {
    readme: readFileSync(join(ROOT, "README.md"), "utf8"),
    landing: readFileSync(join(ROOT, "site/src/index.html"), "utf8"),
    docsIndex: readFileSync(join(ROOT, "docs/README.md"), "utf8"),
  };
}

describe("site release links", () => {
  it("accepts the current README, landing page and docs index", () => {
    assert.deepEqual(siteProblems({ releases, pages: sourcePages() }), []);
  });

  it("fails a stale concrete tag with the channel and the expected page", () => {
    const pages = sourcePages();
    pages.landing +=
      '\n<a href="https://github.com/mrrnbhd/suite-apps/releases/tag/suite-preview-2026.11.20">old preview</a>\n';
    const problems = siteProblems({ releases, pages });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /preview/u);
    assert.match(problems[0], /suite-preview-2026\.11\.20/u);
    assert.match(problems[0], new RegExp(`expected ${newest.preview}`, "u"));
  });

  it("accepts the newest concrete tag when a page links it directly", () => {
    const pages = sourcePages();
    pages.landing +=
      '\n<a href="https://github.com/mrrnbhd/suite-apps/releases/tag/suite-preview-2026.11.25">new preview</a>\n';
    assert.deepEqual(siteProblems({ releases, pages }), []);
  });

  it("fails a channel with no published page", () => {
    const problems = siteProblems({
      releases: releases.filter((row) => !row.tagName.startsWith("suite-nightly-")),
      pages: sourcePages(),
    });
    assert.ok(problems.some((problem) => /^nightly: /u.test(problem)), problems.join("\n"));
    assert.ok(problems.some((problem) => /no published page/u.test(problem)), problems.join("\n"));
  });

  it("fails a README that drops a channel row", () => {
    const pages = sourcePages();
    pages.readme = pages.readme.replace(/^\| `nightly` \|.*$/mu, "");
    const problems = siteProblems({ releases, pages });
    assert.ok(
      problems.some((problem) => /README\.md: no nightly row/u.test(problem)),
      problems.join("\n"),
    );
  });

  it("fails a docs index with no release-list link", () => {
    const pages = sourcePages();
    pages.docsIndex = pages.docsIndex.replace(
      "| The newest release pages | [GitHub Releases](https://github.com/mrrnbhd/suite-apps/releases/latest) |\n",
      "",
    );
    const problems = siteProblems({ releases, pages });
    assert.ok(
      problems.some((problem) => /docs\/README\.md: no link to the release list/u.test(problem)),
      problems.join("\n"),
    );
  });

  it("reads a built site without requiring it", () => {
    const pages = readSitePages();
    assert.equal(typeof pages.readme, "string");
    assert.equal(typeof pages.landing, "string");
    assert.equal(typeof pages.docsIndex, "string");
    assert.ok(pages.builtLanding === undefined || typeof pages.builtLanding === "string");
    assert.ok(pages.builtDocsIndex === undefined || typeof pages.builtDocsIndex === "string");
  });
});
