import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPS,
  AGGREGATE_TABLE_HEADER,
  REMOTE_URL,
  aggregateDate,
  aggregateReleaseBody,
  aggregateTag,
  appReleaseBody,
  changelogDate,
  changelogDateProblem,
  installCell,
  installCommand,
  isDate,
  parseArgs,
  planTag,
  releaseAction,
  releasesPage,
  remoteLookupProblem,
  tagFor,
} from "./release-status.mjs";

const start = APPS.find((app) => app.id === "start");
const sync = APPS.find((app) => app.id === "sync");

/** Three apps in the shape collect() builds, enough for a table. */
const entries = [
  {
    app: start,
    version: "0.5.1",
    date: "2026-11-21",
    tag: "start-v0.5.1",
    section: "### Changed\n\n- **Something.** It changed.",
  },
  {
    app: APPS.find((app) => app.id === "canvas"),
    version: "0.1.11",
    date: "2026-11-20",
    tag: "canvas-v0.1.11",
    section: "### Fixed\n\n- **A package.** It packaged.",
  },
  { app: sync, version: "0.11.3", date: "2026-11-20", tag: "sync-v0.11.3", section: "### Added" },
];

describe("tags and dates", () => {
  it("names an app tag from its prefix and version", () => {
    assert.equal(tagFor(start, "0.5.1"), "start-v0.5.1");
    assert.equal(tagFor(sync, "0.11.3"), "sync-v0.11.3");
  });

  it("writes the aggregate tag with dots", () => {
    assert.equal(aggregateTag("2026-11-21"), "suite-2026.11.21");
  });

  it("reads the date beside a version heading", () => {
    const changelog = "# Changelog\n\n## [0.5.1] - 2026-11-21\n\nNotes.\n";
    assert.equal(changelogDate(changelog, "0.5.1"), "2026-11-21");
    assert.equal(changelogDate(changelog, "0.5.0"), null);
  });

  it("does not borrow another section's date", () => {
    const changelog = "## [0.5.1]\n\nUndated.\n\n## [0.5.0] - 2026-11-20\n\nNotes.\n";
    assert.equal(changelogDate(changelog, "0.5.1"), null);
  });

  it("accepts only a real calendar date", () => {
    assert.equal(isDate("2026-11-21"), true);
    assert.equal(isDate("2026-02-31"), false);
    assert.equal(isDate("2026-13-01"), false);
    assert.equal(isDate("21.11.2026"), false);
  });

  it("refuses an invalid changelog date before it becomes a tag", () => {
    const good = "## [0.5.1] - 2026-11-21\n\nNotes.\n";
    const bad = "## [0.5.1] - 2026-02-31\n\nNotes.\n";
    assert.equal(changelogDateProblem(good, "0.5.1"), null);
    const problem = changelogDateProblem(bad, "0.5.1");
    assert.match(problem, /2026-02-31/u);
    assert.match(problem, /not a real calendar date/u);
  });

  it("dates the aggregate by the newest app, not the wall clock", () => {
    assert.equal(aggregateDate(entries), "2026-11-21");
    assert.equal(aggregateDate(entries, "2026-11-19"), "2026-11-19");
    assert.throws(() => aggregateDate(entries, "soon"), /YYYY-MM-DD/u);
    assert.throws(() => aggregateDate(entries, "2026-02-31"), /real YYYY-MM-DD/u);
  });

  it("falls back to today when no section carries a date", () => {
    const undated = entries.map((entry) => ({ ...entry, date: null }));
    assert.match(aggregateDate(undated), /^\d{4}-\d{2}-\d{2}$/u);
  });
});

describe("tag choice", () => {
  const base = {
    tag: "start-v0.5.1",
    version: "0.5.1",
    changelog: "apps/start/CHANGELOG.md",
  };

  it("backfills a missing tag at the commit that added the section", () => {
    const plan = planTag({
      ...base,
      localCommit: null,
      remoteCommit: null,
      changelogCommit: "0fb48469e5de7f812a6322092396d69f669712d3",
    });
    assert.deepEqual(plan, {
      tag: "start-v0.5.1",
      commit: "0fb48469e5de7f812a6322092396d69f669712d3",
      createLocal: true,
      problem: null,
    });
  });

  it("never moves a tag that exists on origin", () => {
    const plan = planTag({
      ...base,
      localCommit: null,
      remoteCommit: "636c060f4e427d99ae9f45871995254f79fec0f8",
      changelogCommit: "0fb48469e5de7f812a6322092396d69f669712d3",
    });
    assert.equal(plan.commit, "636c060f4e427d99ae9f45871995254f79fec0f8");
    assert.equal(plan.createLocal, true);
    assert.equal(plan.problem, null);
  });

  it("uses a tag that already exists locally", () => {
    const plan = planTag({
      ...base,
      localCommit: "1234567890abcdef1234567890abcdef12345678",
      remoteCommit: null,
      changelogCommit: "0fb48469e5de7f812a6322092396d69f669712d3",
    });
    assert.equal(plan.commit, "1234567890abcdef1234567890abcdef12345678");
    assert.equal(plan.createLocal, false);
  });

  it("refuses a tag that differs between the two", () => {
    const plan = planTag({
      ...base,
      localCommit: "1234567890abcdef1234567890abcdef12345678",
      remoteCommit: "87654321fedcba0987654321fedcba0987654321",
      changelogCommit: null,
    });
    assert.equal(plan.commit, null);
    assert.match(plan.problem, /refusing to move/u);
  });

  it("refuses rather than tagging HEAD when the commit is missing", () => {
    const plan = planTag({
      ...base,
      localCommit: null,
      remoteCommit: null,
      changelogCommit: null,
    });
    assert.equal(plan.commit, null);
    assert.match(plan.problem, /Tagging HEAD/u);
    assert.match(plan.problem, /apps\/start\/CHANGELOG\.md/u);
  });

  it("refuses to decide a tag when the origin lookup failed", () => {
    const problem = remoteLookupProblem("start-v0.5.1");
    assert.match(problem, /git ls-remote/u);
    assert.match(problem, /start-v0\.5\.1/u);
    assert.match(problem, /Refusing/u);
  });
});

describe("release actions", () => {
  it("creates a desktop app release that is missing", () => {
    assert.deepEqual(
      releaseAction({ app: start, tag: "start-v0.5.1", exists: false }),
      { action: "create", problem: null },
    );
  });

  it("edits a release that already exists, so its assets stay", () => {
    assert.deepEqual(
      releaseAction({ app: sync, tag: "sync-v0.11.3", exists: true }),
      { action: "edit", problem: null },
    );
  });

  it("refuses to create an assetless relay release", () => {
    const action = releaseAction({ app: sync, tag: "sync-v0.11.4", exists: false });
    assert.equal(action.action, null);
    assert.match(action.problem, /no GitHub release exists/u);
    assert.match(action.problem, /release\.mjs sync --publish/u);
  });
});

describe("release bodies", () => {
  it("puts the changelog section first and names the signed remote", () => {
    const body = appReleaseBody(start, entries[0].section);
    assert.match(body, /^\s*### Changed/u);
    assert.match(body, /flatpak install --user suite run\.suite\.start/u);
    assert.match(body, new RegExp(`${REMOTE_URL.replaceAll(".", "\\.")}/suite\\.flatpakrepo`, "u"));
    assert.match(body, /carries no app binaries/u);
  });

  it("does not restate the version in a per-app body", () => {
    const body = appReleaseBody(start, entries[0].section);
    assert.doesNotMatch(body, /0\.5\.1/u);
  });

  it("has no Flatpak command for the relay", () => {
    const body = appReleaseBody(sync, entries[2].section);
    assert.equal(installCommand(sync), null);
    assert.doesNotMatch(body, /flatpak install/u);
    assert.match(body, /server tarball/u);
    assert.match(body, /SHA256SUMS/u);
  });

  it("builds one aggregate row per app with version, date, link and install", () => {
    const body = aggregateReleaseBody(entries, { date: "2026-11-21" });
    assert.match(body, /Latest/u);
    for (const entry of entries) {
      assert.match(body, new RegExp(entry.tag, "u"));
      assert.match(body, new RegExp(`\\| \\[${entry.app.name}\\]`, "u"));
      assert.match(body, new RegExp(`\\| ${entry.version.replaceAll(".", "\\.")} \\|`, "u"));
    }
    assert.match(body, /releases\/tag\/start-v0\.5\.1/u);
    assert.match(body, /flatpak install --user suite run\.suite\.start/u);
    assert.match(body, /relay tarball/u);
  });

  it("renders the relay's install cell without inventing a Flatpak", () => {
    assert.match(installCell(sync), /relay tarball/u);
    assert.match(installCell(start), /flatpak install/u);
  });

  it("marks links pending before publication", () => {
    const page = releasesPage(entries, { date: "2026-11-21", tag: "suite-2026.11.21" });
    assert.match(page, /not published yet/u);
    assert.match(page, /`start-v0\.5\.1` \(pending\)/u);
    assert.match(page, /`sync-v0\.11\.3` \(pending\)/u);
    assert.doesNotMatch(page, /releases\/tag\/start-v0\.5\.1/u);
    assert.doesNotMatch(page, /releases\/tag\/suite-2026\.11\.21/u);
  });

  it("writes RELEASES.md as the mirror of the Latest release once published", () => {
    const published = entries.map((entry) => ({ ...entry, published: true }));
    const page = releasesPage(published, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      aggregatePublished: true,
    });
    assert.match(page, /^# Suite releases/u);
    assert.match(page, /Generated by `scripts\/release-status\.mjs`/u);
    assert.match(page, /signed Flatpak remote is the update path/u);
    assert.match(page, /releases\/tag\/suite-2026\.11\.21/u);
    assert.match(page, /releases\/tag\/start-v0\.5\.1/u);
    assert.doesNotMatch(page, /\(pending\)/u);
    for (const header of AGGREGATE_TABLE_HEADER) assert.ok(page.includes(header));
    assert.match(page, /GitHub Packages is not used for the Flatpaks/u);
  });
});

describe("arguments", () => {
  it("defaults to a dry run that writes nothing", () => {
    const options = parseArgs([]);
    assert.equal(options.publish, false);
    assert.equal(options.write, false);
    assert.equal(options.date, null);
  });

  it("reads publish, write and date", () => {
    const options = parseArgs(["--publish", "--date", "2026-11-21"]);
    assert.equal(options.publish, true);
    assert.equal(options.date, "2026-11-21");
    assert.equal(parseArgs(["--write"]).write, true);
    assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  });

  it("refuses any two modes together", () => {
    assert.throws(
      () => parseArgs(["--publish", "--write"]),
      /--publish and --write pick different modes/u,
    );
    assert.throws(
      () => parseArgs(["--publish", "--dry-run"]),
      /--publish and --dry-run pick different modes/u,
    );
    assert.throws(
      () => parseArgs(["--write", "--dry-run"]),
      /--write and --dry-run pick different modes/u,
    );
  });

  it("refuses an unknown option", () => {
    assert.throws(() => parseArgs(["--latest"]), /unknown option/u);
  });
});
