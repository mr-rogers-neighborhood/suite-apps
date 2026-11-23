import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPS,
  AGGREGATE_TABLE_HEADER,
  aggregateDate,
  aggregateReleaseBody,
  aggregateSection,
  aggregateTag,
  appReleaseBody,
  changelogDate,
  changelogDateProblem,
  channelLabel,
  currentAggregateTag,
  draftAction,
  draftReleaseArgs,
  entriesForSection,
  flatpakrepoUrl,
  goApkName,
  goApkUrl,
  installCell,
  installCommand,
  isDate,
  isLegacyFrozen,
  maturityLabel,
  parseArgs,
  planTag,
  publishAction,
  publishReleaseArgs,
  releaseLabels,
  releasesPage,
  remoteLookupProblem,
  tagFor,
  tagPlanDisposition,
  writesReleasesPage,
} from "./release-status.mjs";

const start = APPS.find((app) => app.id === "start");
const go = APPS.find((app) => app.id === "go");
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

/** The mobile entry, added only where a test needs the second table. */
const goEntry = {
  app: go,
  version: "0.1.0",
  date: "2026-11-18",
  tag: "go-v0.1.0",
  section: "### Added\n\n- **The first version.** It exists.",
};

describe("tags and dates", () => {
  it("names an app tag from its prefix and version", () => {
    assert.equal(tagFor(start, "0.5.1"), "start-v0.5.1");
    assert.equal(tagFor(go, "0.1.0"), "go-v0.1.0");
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

describe("the draft phase", () => {
  const tag = "suite-2026.11.21";

  it("creates a missing release as a draft", () => {
    assert.deepEqual(draftAction({ exists: false, isDraft: false, tag }), {
      action: "create",
      problem: null,
    });
    const args = draftReleaseArgs({
      tag,
      title: "Suite Shell + Suite Go — 2026-11-21",
      notesPath: ".dev/releases/suite-2026.11.21.md",
      action: "create",
      target: "0fb48469e5de7f812a6322092396d69f669712d3",
    });
    assert.deepEqual(args.slice(0, 3), ["release", "create", tag]);
    assert.ok(args.includes("--draft"));
    assert.ok(!args.includes("--latest"), "a draft is not Latest before publication");
  });

  it("is idempotent: a rerun edits the same draft instead of creating another", () => {
    assert.deepEqual(draftAction({ exists: true, isDraft: true, tag }), {
      action: "edit",
      problem: null,
    });
    const args = draftReleaseArgs({
      tag,
      title: "Suite Shell + Suite Go — 2026-11-21",
      notesPath: ".dev/releases/suite-2026.11.21.md",
      action: "edit",
      target: "0fb48469e5de7f812a6322092396d69f669712d3",
    });
    assert.deepEqual(args.slice(0, 3), ["release", "edit", tag]);
    assert.ok(!args.includes("--draft"));
    assert.ok(!args.includes("--draft=false"), "editing a draft must not publish it");
    assert.ok(!args.includes("--target"));
  });

  it("leaves an already published release alone on a rerun", () => {
    const phase = draftAction({ exists: true, isDraft: false, tag });
    assert.equal(phase.action, "skip");
    assert.match(phase.problem, /suite-2026\.11\.21 is already published/u);
    assert.match(phase.problem, /immutable/u);
    assert.match(phase.problem, /refuses to edit/u);
    assert.match(phase.problem, /leaves it unchanged/u);
  });
});

describe("the publish phase", () => {
  const tag = "suite-2026.11.21";

  it("flips a draft with gh release edit --draft=false", () => {
    assert.deepEqual(publishAction({ exists: true, isDraft: true, tag }), {
      action: "publish",
      problem: null,
    });
    const aggregate = publishReleaseArgs({
      tag,
      notesPath: ".dev/releases/suite-2026.11.21.md",
      latest: true,
    });
    assert.deepEqual(aggregate.slice(0, 3), ["release", "edit", tag]);
    assert.ok(aggregate.includes("--draft=false"));
    assert.ok(aggregate.includes("--latest"));

    const perApp = publishReleaseArgs({
      tag: "start-v0.5.1",
      notesPath: ".dev/releases/start-v0.5.1.md",
      latest: false,
    });
    assert.ok(perApp.includes("--draft=false"));
    assert.ok(perApp.includes("--latest=false"));
  });

  it("refuses to edit an already-published release, and does not republish it", () => {
    const phase = publishAction({ exists: true, isDraft: false, tag });
    assert.equal(phase.action, "skip");
    assert.notEqual(phase.action, "publish");
    assert.match(phase.problem, /already published/u);
    assert.match(phase.problem, /immutable/u);
    assert.match(phase.problem, /refuses to edit/u);
  });

  it("refuses a missing release and names the draft step", () => {
    const phase = publishAction({ exists: false, isDraft: false, tag });
    assert.equal(phase.action, "refuse");
    assert.match(phase.problem, /has no draft release/u);
    assert.match(phase.problem, /--draft/u);
  });

  it("does not fail a release over an app that is already out", () => {
    // A normal release bumps one app; every other app's current version is
    // already published and must be skipped, not turned into a fatal refusal.
    const published = publishAction({ exists: true, isDraft: false, tag: "start-v0.5.0" });
    assert.equal(published.action, "skip");
    const draft = publishAction({ exists: true, isDraft: true, tag: "shell-v0.2.1" });
    assert.equal(draft.action, "publish");
  });
});

describe("RELEASES.md writers", () => {
  it("is written only by --write and --publish", () => {
    assert.equal(writesReleasesPage("write"), true);
    assert.equal(writesReleasesPage("publish"), true);
    assert.equal(writesReleasesPage("draft"), false);
    assert.equal(writesReleasesPage("dry-run"), false);
  });
});

describe("tag plans by mode", () => {
  const problem =
    "no start-v0.5.1 exists and no commit adds '## [0.5.1]' to apps/start/CHANGELOG.md.";

  it("marks the row pending for --write instead of refusing", () => {
    assert.deepEqual(tagPlanDisposition(problem, "write"), { problem: null, pending: true });
  });

  it("still refuses a tag-plan problem for --draft, --publish and the dry run", () => {
    assert.deepEqual(tagPlanDisposition(problem, "draft"), { problem, pending: false });
    assert.deepEqual(tagPlanDisposition(problem, "publish"), { problem, pending: false });
    assert.deepEqual(tagPlanDisposition(problem, "dry-run"), { problem, pending: false });
  });

  it("keeps a resolved plan unpending in every mode", () => {
    for (const mode of ["write", "draft", "publish", "dry-run"]) {
      assert.deepEqual(tagPlanDisposition(null, mode), { problem: null, pending: false });
    }
  });

  it("writes a pending row for --write even when the release exists", () => {
    const pending = entries.map((entry) => ({
      ...entry,
      published: true,
      pending: entry.app.id === "sync",
    }));
    const page = releasesPage(pending, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      aggregatePublished: true,
    });
    assert.match(page, /`sync-v0\.11\.3` \(pending\)/u);
    assert.doesNotMatch(page, /releases\/tag\/sync-v0\.11\.3/u);
    assert.match(page, /releases\/tag\/start-v0\.5\.1/u);
  });
});

describe("channels and maturity", () => {
  it("labels the superapp rows with their channel and maturity", () => {
    const shell = APPS.find((app) => app.id === "shell");
    const goApp = APPS.find((app) => app.id === "go");
    assert.equal(channelLabel(shell), "stable");
    assert.equal(maturityLabel(shell), "alpha");
    assert.equal(channelLabel(goApp), "stable");
    assert.equal(maturityLabel(goApp), "pre-alpha");
    assert.deepEqual(releaseLabels(shell), [
      "- **Channel:** stable",
      "- **Maturity:** alpha",
    ]);
  });

  it("freezes the legacy apps and names no channel for the hub or relay", () => {
    for (const id of ["canvas", "planner", "budget", "help"]) {
      const app = APPS.find((row) => row.id === id);
      assert.equal(isLegacyFrozen(app), true);
      assert.equal(channelLabel(app), "frozen");
    }
    for (const id of ["start", "sync"]) {
      const app = APPS.find((row) => row.id === id);
      assert.equal(isLegacyFrozen(app), false);
      assert.equal(channelLabel(app), "—");
      assert.equal(maturityLabel(app), "—");
    }
  });

  it("shows channel, maturity and frozen in the generated table and notes", () => {
    const shell = APPS.find((app) => app.id === "shell");
    const goApp = APPS.find((app) => app.id === "go");
    const withSuperapps = [
      {
        app: shell,
        version: "0.2.0",
        date: "2026-11-22",
        tag: "shell-v0.2.0",
        section: "### Added\n\n- **The host.** It exists.",
      },
      ...entries,
      {
        app: goApp,
        version: "0.1.0",
        date: "2026-11-18",
        tag: "go-v0.1.0",
        section: "### Added\n\n- **The first version.** It exists.",
      },
    ];
    const body = aggregateReleaseBody(withSuperapps, { date: "2026-11-22" });
    assert.match(body, /desktop superapp; \*\*Suite Go\*\* is the mobile superapp/u);
    assert.match(body, /\*\*Channel:\*\* stable/u);
    assert.match(body, /\*\*Maturity:\*\* alpha/u);
    assert.match(body, /\| \[Suite Canvas\]\([^)]*\) \| frozen \| alpha \|/u);

    const frozen = appReleaseBody(
      APPS.find((app) => app.id === "canvas"),
      "### Fixed\n\n- **A package.** It packaged.",
    );
    assert.match(frozen, /\*\*Channel:\*\* frozen/u);
    assert.match(frozen, /frozen until it becomes a pack/u);
  });

  it("renders the new columns in RELEASES.md", () => {
    const published = entries.map((entry) => ({ ...entry, published: true }));
    const page = releasesPage(published, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      aggregatePublished: true,
    });
    assert.match(page, /## Channels and maturity/u);
    assert.match(page, /\| App \| Channel \| Maturity \| Version \| Released \| Release \| Install \|/u);
    assert.match(page, /a `stable`-channel\s+build can still be `alpha`/u);
  });
});

describe("release bodies", () => {
  it("points at the rolling release, then the changelog section and the signed remote", () => {
    const body = appReleaseBody(start, entries[0].section);
    assert.match(body, /^Current versions and the install table are on/u);
    assert.match(body, /releases\/latest/u);
    assert.match(body, /### Changed/u);
    assert.match(body, /flatpak install --user suite run\.suite\.start/u);
    assert.match(body, new RegExp(flatpakrepoUrl().replaceAll(".", "\\."), "u"));
    assert.match(body, /carries no app binaries/u);
  });

  it("does not restate the version in a per-app body", () => {
    const body = appReleaseBody(start, entries[0].section);
    assert.doesNotMatch(body, /0\.5\.1/u);
  });

  it("gives the relay the same Flatpak install block as every desktop app", () => {
    const body = appReleaseBody(sync, entries[2].section);
    assert.equal(installCommand(sync), "flatpak install --user suite run.suite.sync");
    assert.match(body, /flatpak install --user suite run\.suite\.sync/u);
    assert.doesNotMatch(body, /server tarball|SHA256SUMS/u);
  });

  it("states whether the Go APK is attached in the per-app body", () => {
    const live = appReleaseBody(go, goEntry.section, {
      tag: "suite-2026.11.21",
      apkLive: true,
    });
    assert.match(live, /is attached to \[the rolling Suite release\]/u);
    assert.match(live, /releases\/tag\/suite-2026\.11\.21/u);
    assert.doesNotMatch(live, /Mobile table says whether/u);

    const pending = appReleaseBody(go, goEntry.section, { tag: "suite-2026.11.21" });
    assert.match(pending, /Mobile table says whether this build is attached yet/u);
    assert.doesNotMatch(pending, /is attached to/u);
    assert.match(pending, /releases\/tag\/suite-2026\.11\.21/u);

    const unknown = appReleaseBody(go, goEntry.section);
    assert.match(unknown, /releases\/latest/u);
    assert.match(unknown, /Mobile table says whether/u);
  });

  it("builds one aggregate row per app with version, date, link and install", () => {
    const body = aggregateReleaseBody(entries, { date: "2026-11-21" });
    assert.match(body, /Suite Shell/u);
    assert.match(body, /Suite Go/u);
    for (const entry of entries) {
      assert.match(body, new RegExp(entry.tag, "u"));
      assert.match(body, new RegExp(`\\| \\[${entry.app.name}\\]`, "u"));
      assert.match(body, new RegExp(`\\| ${entry.version.replaceAll(".", "\\.")} \\|`, "u"));
    }
    assert.match(body, /releases\/tag\/start-v0\.5\.1/u);
    assert.match(body, /flatpak install --user suite run\.suite\.start/u);
    assert.match(body, /flatpak install --user suite run\.suite\.sync/u);
  });

  it("renders the relay as the Flatpak it now is", () => {
    assert.equal(installCell(sync), "`flatpak install --user suite run.suite.sync`");
    assert.equal(installCell(start), "`flatpak install --user suite run.suite.start`");
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

describe("sections and the Suite Go APK", () => {
  it("keeps the desktop rows in reading order and Go alone on mobile", () => {
    assert.deepEqual(
      APPS.filter((app) => app.section === "desktop").map((app) => app.id),
      ["shell", "start", "canvas", "planner", "budget", "sync", "help"],
    );
    assert.equal(APPS[0].id, "shell");
    assert.deepEqual(
      APPS.filter((app) => app.section === "mobile").map((app) => app.id),
      ["go"],
    );
    assert.equal(go.packageJson, "apps/go/package.json");
    assert.equal(go.changelog, "apps/go/CHANGELOG.md");
    assert.equal(go.tagPrefix, "go-v");
    assert.equal(go.kind, "apk");
  });

  it("carries the host as Suite Shell, first in the desktop table", () => {
    const shell = APPS.find((app) => app.id === "shell");
    assert.equal(shell.name, "Suite Shell");
    assert.equal(shell.packageJson, "apps/shell/package.json");
    assert.equal(shell.changelog, "apps/shell/CHANGELOG.md");
    assert.equal(shell.tagPrefix, "shell-v");
    assert.equal(shell.kind, "flatpak");
    assert.equal(shell.section, "desktop");
    assert.equal(shell.flatpakId, "run.suite.shell");
    assert.equal(installCommand(shell), "flatpak install --user suite run.suite.shell");

    const shellEntry = {
      app: shell,
      version: "0.1.0",
      date: "2026-11-22",
      tag: "shell-v0.1.0",
      section: "### Added\n\n- **The host.** It exists.",
    };
    const desktop = aggregateSection("Desktop", [shellEntry, ...entries], {
      tag: "suite-2026.11.22",
    });
    const rows = desktop.filter((line) => line.startsWith("| ["));
    assert.match(rows[0], /\| \[Suite Shell\]/u);
    assert.match(rows[0], /run\.suite\.shell/u);
  });

  it("renders a section as a title and its own rows", () => {
    const section = aggregateSection("Mobile", [goEntry], { tag: "suite-2026.11.21" });
    assert.equal(section[0], "## Mobile");
    assert.equal(section[1], "");
    assert.deepEqual(section.slice(2, 4), AGGREGATE_TABLE_HEADER);
    assert.equal(section.length, 2 + AGGREGATE_TABLE_HEADER.length + 1);
    assert.match(section.at(-1), /\| \[Suite Go\]/u);
  });

  it("renders each section only for the rows it is given", () => {
    const desktopOnly = aggregateSection("Desktop", entries, { tag: "suite-2026.11.21" });
    assert.deepEqual(
      desktopOnly.filter((line) => line.startsWith("## ")),
      ["## Desktop"],
    );
    const withGo = aggregateSection("Mobile", [goEntry], { tag: "suite-2026.11.21" });
    assert.deepEqual(
      withGo.filter((line) => line.startsWith("## ")),
      ["## Mobile"],
    );
    assert.match(withGo.at(-1), /\| \[Suite Go\]/u);
  });

  it("links the APK only when the release actually carries it", () => {
    const live = installCell(go, {
      version: "0.1.0",
      tag: "suite-2026.11.21",
      apkLive: true,
    });
    assert.equal(live, `[suite-go-0.1.0.apk](${goApkUrl("suite-2026.11.21", "0.1.0")})`);
    assert.match(live, /releases\/download\/suite-2026\.11\.21\/suite-go-0\.1\.0\.apk/u);
    assert.equal(goApkName("0.1.0"), "suite-go-0.1.0.apk");

    const missing = installCell(go, { version: "0.1.0", tag: "suite-2026.11.21" });
    assert.match(missing, /suite-go-0\.1\.0\.apk/u);
    assert.match(missing, /not uploaded yet/u);
    assert.doesNotMatch(missing, /releases\/download/u);

    const draft = installCell(go, {
      version: "0.1.0",
      tag: "suite-2026.11.21",
      draft: true,
    });
    assert.match(draft, /attached to this draft before publication/u);
    assert.doesNotMatch(draft, /releases\/download/u);
  });

  it("promises no APK link in a draft body, and says it is attached before publication", () => {
    const withGo = [...entries, goEntry];
    const draft = aggregateReleaseBody(withGo, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      draft: true,
    });
    assert.match(draft, /uploaded to this draft/u);
    assert.match(draft, /once `--publish` flips the draft/u);
    assert.doesNotMatch(draft, /releases\/download/u);
    assert.doesNotMatch(draft, /carries its release-signed APK/u);
    assert.doesNotMatch(draft, /not attached to this release/u);

    const goDraft = appReleaseBody(go, goEntry.section, {
      tag: "suite-2026.11.21",
      draft: true,
    });
    assert.match(goDraft, /while that release is a draft/u);
    assert.doesNotMatch(goDraft, /Mobile table says whether/u);
  });

  it("puts the store instruction above the tables and Update below them", () => {
    const body = aggregateReleaseBody(entries, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
    });
    const remote = body.indexOf("flatpak remote-add");
    const also = body.indexOf("## Also on the remote");
    const update = body.indexOf("## Update");
    assert.ok(remote >= 0 && also > remote);
    assert.ok(update > also);

    const page = releasesPage(entries, { date: "2026-11-21", tag: "suite-2026.11.21" });
    const pageDesktop = page.indexOf("## Desktop");
    assert.ok(page.indexOf("flatpak remote-add") < pageDesktop);
    assert.ok(page.indexOf("## Update") > pageDesktop);
  });

  it("says in the aggregate body whether the APK link is live", () => {
    const withGo = [...entries, goEntry];
    const live = aggregateReleaseBody(withGo, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      apkLive: true,
    });
    assert.match(live, /carries its release-signed APK/u);
    assert.doesNotMatch(live, /debug-signed/u);
    assert.match(live, /releases\/download\/suite-2026\.11\.21\/suite-go-0\.1\.0\.apk/u);
    assert.match(live, /## Suite Go \(mobile\)/u);

    const missing = aggregateReleaseBody(withGo, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
    });
    assert.match(missing, /not attached to this release/u);
    assert.match(missing, /before publishing/u);
    assert.match(missing, /assets are locked/u);
  });

  it("names the aggregate tag from the newest changelog date", () => {
    const files = {
      "apps/start/package.json": '{"version":"0.5.1"}',
      "apps/start/CHANGELOG.md": "## [0.5.1] - 2026-11-21\n",
      "apps/go/package.json": '{"version":"0.1.0"}',
      "apps/go/CHANGELOG.md": "## [0.1.0] - 2026-11-18\n",
    };
    assert.equal(
      currentAggregateTag({ load: (path) => files[path] ?? "" }),
      "suite-2026.11.21",
    );
  });
});

describe("arguments", () => {
  it("defaults to a dry run that writes nothing", () => {
    const options = parseArgs([]);
    assert.equal(options.publish, false);
    assert.equal(options.draft, false);
    assert.equal(options.write, false);
    assert.equal(options.date, null);
  });

  it("reads draft, publish, write and date", () => {
    const options = parseArgs(["--publish", "--date", "2026-11-21"]);
    assert.equal(options.publish, true);
    assert.equal(options.date, "2026-11-21");
    assert.equal(parseArgs(["--draft"]).draft, true);
    assert.equal(parseArgs(["--write"]).write, true);
    assert.equal(parseArgs(["--dry-run"]).dryRun, true);
  });

  it("refuses any two modes together", () => {
    assert.throws(
      () => parseArgs(["--draft", "--publish"]),
      /--draft and --publish pick different modes/u,
    );
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

describe("channel-aware notes", () => {
  it("names the preview APK on the rolling release", () => {
    assert.equal(goApkName("0.1.0", "preview"), "suite-go-preview-0.1.0.apk");
    assert.match(goApkUrl("suite-2026.11.21", "0.1.0", "preview"), /suite-go-preview-0\.1\.0\.apk$/u);
    assert.equal(goApkName("0.1.0"), "suite-go-0.1.0.apk");
  });

  it("says which channel the rolling release was last published from", () => {
    const body = aggregateReleaseBody([...entries, goEntry], {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      apkLive: true,
      channel: "preview",
    });
    assert.match(body, /published on the \*\*preview\*\* channel/u);
    assert.match(body, /suite-go-preview-0\.1\.0\.apk/u);
  });
});
