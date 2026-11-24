import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  APPS,
  AGGREGATE_TABLE_HEADER,
  MANIFEST_FILE,
  aggregateDate,
  aggregateReleaseBody,
  aggregateReleaseCommands,
  aggregateSection,
  aggregateTag,
  alreadyPublishedMessage,
  changelogDate,
  changelogDateProblem,
  channelLabel,
  collectReleases,
  currentAggregateTag,
  draftAction,
  draftRefusalMessage,
  draftReleaseArgs,
  flatpakrepoUrl,
  goApkName,
  goApkUrl,
  INDEX_RELEASE_FILE,
  installCell,
  installCommand,
  isDate,
  isLegacyFrozen,
  maturityLabel,
  parseArgs,
  planTag,
  preReleaseLinks,
  pruneCandidates,
  publishAction,
  publishedCheck,
  publishReleaseArgs,
  readIndexRelease,
  readManifest,
  releaseAssetUrl,
  releaseDates,
  releaseFor,
  releaseLabels,
  releasePhase,
  releasesPage,
  remoteLookupProblem,
  superappEntries,
  workflowInputDate,
  writesReleasesPage,
} from "./release-status.mjs";

const shell = APPS.find((app) => app.id === "shell");
const go = APPS.find((app) => app.id === "go");

const shellEntry = {
  app: shell,
  version: "0.2.0",
  date: "2026-11-22",
  section: "### Added\n\n- **The host.** It exists.",
};

/** The mobile superapp entry. */
const goEntry = {
  app: go,
  version: "0.1.0",
  date: "2026-11-18",
  section: "### Added\n\n- **The first version.** It exists.",
};

/** Every app in the shape collectReleases() builds; only shell and go render. */
const entries = [
  shellEntry,
  {
    app: APPS.find((app) => app.id === "canvas"),
    version: "0.1.11",
    date: "2026-11-20",
    section: "### Fixed\n\n- **A package.** It packaged.",
  },
  goEntry,
];

describe("tags and dates", () => {
  it("retires per-app tags: no app carries a tag prefix", () => {
    for (const app of APPS) assert.equal(app.tagPrefix, undefined);
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
    assert.equal(aggregateDate(entries), "2026-11-22");
    assert.equal(aggregateDate(entries, "2026-11-19"), "2026-11-19");
    assert.throws(() => aggregateDate(entries, "soon"), /YYYY-MM-DD/u);
    assert.throws(() => aggregateDate(entries, "2026-02-31"), /real YYYY-MM-DD/u);
  });

  it("falls back to today when no section carries a date", () => {
    const undated = entries.map((entry) => ({ ...entry, date: null }));
    assert.match(aggregateDate(undated), /^\d{4}-\d{2}-\d{2}$/u);
  });
});

describe("publication dates", () => {
  const onNov23 = new Date("2026-11-23T12:00:00Z");
  const onDec01 = new Date("2026-12-01T00:30:00Z");

  /** A tree whose newest changelog date is 2026-11-22 for every app. */
  function treeFiles() {
    const files = {};
    for (const app of APPS) {
      files[app.packageJson] = JSON.stringify({ version: "1.0.0" });
      files[app.changelog] = "## [1.0.0] - 2026-11-22\n\n### Added\n\n- **It exists.**\n";
    }
    return files;
  }

  it("plans a nightly tag for the publication day and names both days in the body", () => {
    const { snapshotDate, tagDate } = releaseDates(entries, {
      channel: "nightly",
      now: onNov23,
    });
    assert.equal(snapshotDate, "2026-11-22");
    assert.equal(tagDate, "2026-11-23");
    assert.equal(aggregateTag(tagDate, "nightly"), "suite-nightly-2026.11.23");

    const body = aggregateReleaseBody(entries, {
      date: snapshotDate,
      tagDate,
      tag: aggregateTag(tagDate, "nightly"),
      channel: "nightly",
    });
    assert.match(
      body,
      /This is the 2026-11-22 snapshot, published on the \*\*nightly\*\* channel on 2026-11-23/u,
    );
  });

  it("names the snapshot and the tag day separately, and stable keeps one date", () => {
    const nightly = aggregateReleaseBody(entries, {
      date: "2026-11-22",
      tagDate: "2026-11-24",
      tag: "suite-nightly-2026.11.24",
      channel: "nightly",
    });
    assert.ok(
      nightly.includes(
        "This is the 2026-11-22 snapshot, published on the **nightly** channel on 2026-11-24.",
      ),
    );
    assert.doesNotMatch(nightly, /This is the 2026-11-22 build/u);

    const stable = aggregateReleaseBody(entries, {
      date: "2026-11-22",
      tagDate: "2026-11-22",
      tag: "suite-2026.11.22",
    });
    assert.match(stable, /This is the 2026-11-22 build\./u);
    assert.doesNotMatch(stable, /snapshot|published on/u);
    assert.equal(
      stable.match(/2026-\d{2}-\d{2}/gu)?.length ?? 0,
      1,
      "stable's tag is the snapshot, so the body names one date",
    );
  });

  it("gives a preview a new tag every day even when no app version changed", () => {
    const first = releaseDates(entries, { channel: "preview", now: onNov23 });
    const second = releaseDates(entries, { channel: "preview", now: onDec01 });
    assert.equal(first.tagDate, "2026-11-23");
    assert.equal(second.tagDate, "2026-12-01");
    assert.equal(aggregateTag(first.tagDate, "preview"), "suite-preview-2026.11.23");
    assert.equal(second.snapshotDate, "2026-11-22", "the snapshot does not move with the clock");
  });

  it("keeps the changelog date as stable's tag", () => {
    const { snapshotDate, tagDate } = releaseDates(entries, { channel: "stable", now: onDec01 });
    assert.equal(snapshotDate, "2026-11-22");
    assert.equal(tagDate, "2026-11-22");
    assert.equal(aggregateTag(tagDate), "suite-2026.11.22");
  });

  it("--date moves the tag, and on stable the snapshot too", () => {
    const nightly = releaseDates(entries, {
      channel: "nightly",
      date: "2026-11-24",
      now: onNov23,
    });
    assert.equal(nightly.tagDate, "2026-11-24");
    assert.equal(nightly.snapshotDate, "2026-11-22");
    assert.equal(aggregateTag(nightly.tagDate, "nightly"), "suite-nightly-2026.11.24");

    const stable = releaseDates(entries, { channel: "stable", date: "2026-11-24" });
    assert.equal(stable.tagDate, "2026-11-24");
    assert.equal(stable.snapshotDate, "2026-11-24");

    assert.throws(
      () => releaseDates(entries, { channel: "nightly", date: "2026-02-31" }),
      /real YYYY-MM-DD/u,
    );
  });

  it("the aggregate tag helper agrees with the draft plan", () => {
    const files = treeFiles();
    const load = (path) => files[path] ?? "";
    const collected = collectReleases({ load });
    assert.deepEqual(collected.problems, []);
    assert.equal(collected.entries.length, APPS.length);

    const expected = {
      stable: "suite-2026.11.22",
      nightly: "suite-nightly-2026.11.23",
      preview: "suite-preview-2026.11.23",
    };
    for (const [channel, tag] of Object.entries(expected)) {
      const { tagDate } = releaseDates(collected.entries, { channel, now: onNov23 });
      assert.equal(aggregateTag(tagDate, channel), tag, channel);
      assert.equal(currentAggregateTag({ load, channel, now: onNov23, env: {} }), tag, channel);
    }
  });
});

describe("the rolling tag plan", () => {
  const base = {
    tag: "suite-2026.11.21",
    version: "suite-2026.11.21",
    changelog: "HEAD",
  };

  it("creates a missing rolling tag at HEAD", () => {
    const plan = planTag({
      ...base,
      localCommit: null,
      remoteCommit: null,
      changelogCommit: "0fb48469e5de7f812a6322092396d69f669712d3",
    });
    assert.deepEqual(plan, {
      tag: "suite-2026.11.21",
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
    assert.match(plan.problem, /HEAD/u);
  });

  it("refuses to decide a tag when the origin lookup failed", () => {
    const problem = remoteLookupProblem("suite-2026.11.21");
    assert.match(problem, /git ls-remote/u);
    assert.match(problem, /suite-2026\.11\.21/u);
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

  it("refuses a draft over an already published release and names --date", () => {
    const phase = draftAction({ exists: true, isDraft: false, tag });
    assert.equal(phase.action, "refuse");
    assert.match(phase.problem, /suite-2026\.11\.21 is already published/u);
    assert.match(phase.problem, /immutable/u);
    assert.match(phase.problem, /--date/u);
  });

  it("refuses from a release list too, so the guard is what main runs", () => {
    const releases = [
      { tagName: "suite-nightly-2026.11.22", isDraft: false },
      { tagName: "suite-nightly-2026.11.23", isDraft: true },
    ];
    assert.deepEqual(releasePhase("draft", releases, "suite-nightly-2026.11.22"), {
      action: "refuse",
      problem: draftRefusalMessage("suite-nightly-2026.11.22"),
    });
    assert.equal(releasePhase("draft", releases, "suite-nightly-2026.11.23").action, "edit");
    assert.equal(releasePhase("draft", releases, "suite-nightly-2026.11.24").action, "create");
    assert.equal(releaseFor(releases, "suite-nightly-2026.11.24"), null);
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
});

describe("RELEASES.md writers", () => {
  it("is written only by --write and --publish", () => {
    assert.equal(writesReleasesPage("write"), true);
    assert.equal(writesReleasesPage("publish"), true);
    assert.equal(writesReleasesPage("draft"), false);
    assert.equal(writesReleasesPage("dry-run"), false);
  });
});

describe("the already-published check", () => {
  const tag = "suite-nightly-2026.11.24";

  it("stops a second nightly with one sentence naming the tag and the gate", () => {
    const sentence = alreadyPublishedMessage(tag);
    assert.match(sentence, /^suite-nightly-2026\.11\.24 is already published;/u);
    assert.match(sentence, /stops before the gate/u);
    assert.match(sentence, /leaves it untouched/u);
    assert.ok(!sentence.includes("\n"), "the early exit prints one sentence, not a paragraph");
  });

  it("stops for a published release, and lets a missing one through", () => {
    assert.deepEqual(publishedCheck([{ tagName: tag, isDraft: false }], tag), {
      published: true,
      sentence: alreadyPublishedMessage(tag),
    });
    assert.deepEqual(publishedCheck([], tag), { published: false, sentence: null });
    assert.deepEqual(publishedCheck([{ tagName: "suite-nightly-2026.11.23" }], tag), {
      published: false,
      sentence: null,
    });
  });

  it("lets a draft through, so a rerun updates the same draft", () => {
    assert.deepEqual(publishedCheck([{ tagName: tag, isDraft: true }], tag), {
      published: false,
      sentence: null,
    });
  });
});

describe("the opt-in second publication", () => {
  const event = (payload) => {
    const dir = mkdtempSync(join(tmpdir(), "suite-event-"));
    const path = join(dir, "event.json");
    writeFileSync(path, JSON.stringify(payload));
    return { path, dir };
  };

  it("reads the date a dispatch named, and none when it named none", () => {
    const named = event({ inputs: { date: "2026-11-25" } });
    try {
      assert.equal(workflowInputDate({ GITHUB_EVENT_PATH: named.path }), "2026-11-25");
    } finally {
      rmSync(named.dir, { recursive: true, force: true });
    }
    const empty = event({ inputs: { date: "" } });
    try {
      assert.equal(workflowInputDate({ GITHUB_EVENT_PATH: empty.path }), null);
    } finally {
      rmSync(empty.dir, { recursive: true, force: true });
    }
    const scheduled = event({ schedule: "0 2 * * *" });
    try {
      assert.equal(workflowInputDate({ GITHUB_EVENT_PATH: scheduled.path }), null);
    } finally {
      rmSync(scheduled.dir, { recursive: true, force: true });
    }
    assert.equal(workflowInputDate({}), null, "a local run has no triggering event");
  });

  it("refuses a named date that is not a calendar date instead of reusing today's tag", () => {
    const bad = event({ inputs: { date: "2026-02-31" } });
    try {
      assert.throws(
        () => workflowInputDate({ GITHUB_EVENT_PATH: bad.path }),
        /date input is "2026-02-31"/u,
      );
    } finally {
      rmSync(bad.dir, { recursive: true, force: true });
    }
  });

  it("names another tag date, never today's published one by default", () => {
    const files = {
      "apps/start/package.json": '{"version":"0.5.1"}',
      "apps/start/CHANGELOG.md": "## [0.5.1] - 2026-11-21\n",
    };
    const load = (path) => files[path] ?? "";
    assert.equal(
      currentAggregateTag({
        load,
        channel: "nightly",
        now: new Date("2026-11-24T02:00:00Z"),
        env: {},
      }),
      "suite-nightly-2026.11.24",
    );
    assert.equal(
      currentAggregateTag({
        load,
        channel: "nightly",
        date: "2026-11-25",
        now: new Date("2026-11-24T02:00:00Z"),
        env: {},
      }),
      "suite-nightly-2026.11.25",
    );
    assert.equal(
      aggregateTag(
        releaseDates(entries, { channel: "nightly", date: "2026-11-25" }).tagDate,
        "nightly",
      ),
      "suite-nightly-2026.11.25",
    );
  });
});

describe("per-app releases are retired", () => {
  const tag = "suite-2026.11.21";
  const date = "2026-11-21";
  const commit = "0fb48469e5de7f812a6322092396d69f669712d3";

  it("a dry run plans the aggregate release and no per-app release or tag", () => {
    const commands = aggregateReleaseCommands({
      mode: "draft",
      aggregate: { action: "create", plan: { createLocal: true, commit } },
      tag,
      date,
    });
    assert.deepEqual(commands[0], { command: "git", args: ["tag", tag, commit] });
    assert.equal(commands.length, 2);
    assert.match(commands[1].args.join(" "), /release create suite-2026\.11\.21/u);
    assert.doesNotMatch(JSON.stringify(commands), /-v\d/u);
  });

  it("does not recreate a missing per-app tag", () => {
    const commands = aggregateReleaseCommands({
      mode: "draft",
      aggregate: { action: "create", plan: { createLocal: false, commit } },
      tag,
      date,
    });
    assert.equal(commands.length, 1);
    assert.ok(
      commands.every((step) =>
        step.args.every(
          (arg) => !/(?:shell|start|go|canvas|planner|budget|sync|help)-v/u.test(arg),
        ),
      ),
    );
  });

  it("writes the page from the tree without any per-app tag", () => {
    // A checkout with no `*-v*` tag still has every package.json and changelog,
    // so collecting entries must not read git or invent a tag to plan.
    const files = {};
    for (const app of APPS) {
      files[app.packageJson] = JSON.stringify({ version: "1.0.0" });
      files[app.changelog] =
        "## [1.0.0] - 2026-11-23\n\n### Added\n\n- **It exists.**\n";
    }
    const collected = collectReleases({ load: (path) => files[path] ?? "" });
    assert.deepEqual(collected.problems, []);
    assert.equal(collected.entries.length, APPS.length);
    for (const entry of collected.entries) {
      assert.equal(entry.tag, undefined);
      assert.equal(entry.plan, undefined);
      assert.equal(entry.pending, undefined);
    }

    const page = releasesPage(collected.entries, {
      date: "2026-11-23",
      tag: "suite-2026.11.23",
    });
    assert.doesNotMatch(page, /\(pending\)/u);
    assert.match(page, /\| \[Suite Shell\]/u);
    assert.match(page, /\| \[Suite Go\]/u);
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

  it("freezes the legacy apps", () => {
    for (const id of ["canvas", "planner", "budget", "help"]) {
      const app = APPS.find((row) => row.id === id);
      assert.equal(isLegacyFrozen(app), true);
      assert.equal(channelLabel(app), "frozen");
    }
  });

  it("retires Suite Sync from the release table and still checks every row it keeps", () => {
    assert.equal(APPS.find((row) => row.id === "sync"), undefined);
    assert.ok(
      APPS.every((row) => row.channel !== undefined || row.frozen === true),
      "every row is a superapp or a frozen legacy app",
    );
  });

  it("shows channel, maturity and install for the two superapps", () => {
    const body = aggregateReleaseBody(entries, { date: "2026-11-22" });
    assert.match(body, /desktop superapp; \*\*Suite Go\*\* is the mobile superapp/u);
    assert.match(body, /\*\*Channel:\*\* stable/u);
    assert.match(body, /\*\*Maturity:\*\* alpha/u);
    assert.match(body, /\| \[Suite Shell\]\([^)]*\) \| stable \| alpha \| 0\.2\.0 \|/u);
    assert.match(body, /\| \[Suite Go\]\([^)]*\) \| stable \| pre-alpha \| 0\.1\.0 \|/u);
    assert.doesNotMatch(body, /\| \[Suite Canvas\]/u);
    assert.doesNotMatch(body, /frozen/u);
  });

  it("renders the two superapp rows in RELEASES.md with no Release column", () => {
    const page = releasesPage(entries, {
      date: "2026-11-22",
      tag: "suite-2026.11.22",
      aggregatePublished: true,
    });
    assert.match(page, /## Channels and maturity/u);
    assert.ok(page.includes(AGGREGATE_TABLE_HEADER[0]));
    assert.doesNotMatch(page, /Released \| Release/u);
    assert.match(page, /a `stable`-channel\s+build can still be `alpha`/u);
    assert.match(page, /\| \[Suite Shell\]/u);
    assert.match(page, /\| \[Suite Go\]/u);
    assert.doesNotMatch(page, /\| \[Suite Start\]/u);
  });
});

describe("release bodies", () => {
  it("renders only the two superapps with version, channel and install", () => {
    assert.deepEqual(
      superappEntries(entries).map((entry) => entry.app.id),
      ["shell", "go"],
    );
    const body = aggregateReleaseBody(entries, { date: "2026-11-22" });
    assert.match(body, /Suite Shell/u);
    assert.match(body, /Suite Go/u);
    assert.match(body, /\| \[Suite Shell\]\([^)]*\) \| stable \| alpha \| 0\.2\.0 \|/u);
    assert.match(body, /\| \[Suite Go\]\([^)]*\) \| stable \| pre-alpha \| 0\.1\.0 \|/u);
    assert.match(body, /flatpak install --user suite run\.suite\.shell/u);
    assert.match(body, new RegExp(flatpakrepoUrl().replaceAll(".", "\\."), "u"));
    assert.doesNotMatch(body, /\| \[Suite Start\]/u);
    assert.doesNotMatch(body, /\| \[Suite Canvas\]/u);
    assert.doesNotMatch(body, /-v\d/u);
  });

  it("never renders the retired relay as an installable row", () => {
    const body = aggregateReleaseBody(entries, { date: "2026-11-22" });
    assert.doesNotMatch(body, /run\.suite\.sync/u);
    assert.doesNotMatch(body, /Suite Sync/u);
  });

  it("never marks a row pending for a page that will not exist", () => {
    const page = releasesPage(entries, { date: "2026-11-22", tag: "suite-2026.11.22" });
    assert.match(page, /not published yet/u);
    assert.doesNotMatch(page, /\(pending\)/u);
    assert.doesNotMatch(page, /-v\d/u);
    assert.doesNotMatch(page, /releases\/tag\/suite-2026\.11\.22/u);
  });

  it("writes RELEASES.md as the mirror of the rolling release once published", () => {
    const page = releasesPage(entries, {
      date: "2026-11-22",
      tag: "suite-2026.11.22",
      aggregatePublished: true,
    });
    assert.match(page, /^# Suite releases/u);
    assert.match(page, /Generated by `scripts\/release-status\.mjs`/u);
    assert.match(page, /signed Flatpak remote is the update path/u);
    assert.match(page, /releases\/tag\/suite-2026\.11\.22/u);
    assert.doesNotMatch(page, /-v\d/u);
    assert.doesNotMatch(page, /\(pending\)/u);
    for (const header of AGGREGATE_TABLE_HEADER) assert.ok(page.includes(header));
    assert.match(page, /GitHub Packages is not used for the Flatpaks/u);
  });
});

describe("sections and the Suite Go APK", () => {
  it("keeps the desktop rows in reading order and Go alone on mobile", () => {
    assert.deepEqual(
      APPS.filter((app) => app.section === "desktop").map((app) => app.id),
      ["shell", "canvas", "planner", "budget", "help"],
    );
    assert.equal(APPS[0].id, "shell");
    assert.deepEqual(
      APPS.filter((app) => app.section === "mobile").map((app) => app.id),
      ["go"],
    );
    assert.equal(go.packageJson, "apps/go/package.json");
    assert.equal(go.changelog, "apps/go/CHANGELOG.md");
    assert.equal(go.kind, "apk");
  });

  it("carries the host as Suite Shell, first in the desktop table", () => {
    assert.equal(shell.name, "Suite Shell");
    assert.equal(shell.packageJson, "apps/shell/package.json");
    assert.equal(shell.changelog, "apps/shell/CHANGELOG.md");
    assert.equal(shell.kind, "flatpak");
    assert.equal(shell.section, "desktop");
    assert.equal(shell.flatpakId, "run.suite.shell");
    assert.equal(installCommand(shell), "flatpak install --user suite run.suite.shell");

    const desktop = aggregateSection("Desktop", [shellEntry], {
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
    const draft = aggregateReleaseBody(entries, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      draft: true,
    });
    assert.match(draft, /uploaded to this draft/u);
    assert.match(draft, /once `--publish` flips the draft/u);
    assert.doesNotMatch(draft, /releases\/download/u);
    assert.doesNotMatch(draft, /carries its release-signed APK/u);
    assert.doesNotMatch(draft, /not attached to this release/u);
  });

  it("puts the store instruction above the tables and Update below them", () => {
    const body = aggregateReleaseBody(entries, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
    });
    const remote = body.indexOf("flatpak remote-add");
    const table = body.indexOf("## Current versions");
    const update = body.indexOf("## Update");
    assert.ok(remote >= 0 && table > remote);
    assert.ok(update > table);

    const page = releasesPage(entries, { date: "2026-11-21", tag: "suite-2026.11.21" });
    const pageDesktop = page.indexOf("## Desktop");
    assert.ok(page.indexOf("flatpak remote-add") < pageDesktop);
    assert.ok(page.indexOf("## Update") > pageDesktop);
  });

  it("says in the aggregate body whether the APK link is live", () => {
    const live = aggregateReleaseBody(entries, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
      apkLive: true,
    });
    assert.match(live, /carries its release-signed APK/u);
    assert.doesNotMatch(live, /debug-signed/u);
    assert.match(live, /releases\/download\/suite-2026\.11\.21\/suite-go-0\.1\.0\.apk/u);
    assert.match(live, /## Suite Go \(mobile\)/u);

    const missing = aggregateReleaseBody(entries, {
      date: "2026-11-21",
      tag: "suite-2026.11.21",
    });
    assert.match(missing, /not attached to this release/u);
    assert.match(missing, /before publishing/u);
    assert.match(missing, /assets are locked/u);
  });

  it("names the aggregate tag from the newest changelog date", () => {
    const files = {
      "apps/shell/package.json": '{"version":"0.2.0"}',
      "apps/shell/CHANGELOG.md": "## [0.2.0] - 2026-11-21\n",
      "apps/go/package.json": '{"version":"0.1.0"}',
      "apps/go/CHANGELOG.md": "## [0.1.0] - 2026-11-18\n",
    };
    assert.equal(
      currentAggregateTag({ load: (path) => files[path] ?? "", env: {} }),
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

  it("reads --check-published as its own mode", () => {
    const options = parseArgs(["--check-published", "--channel", "nightly"]);
    assert.equal(options.checkPublished, true);
    assert.equal(options.channel, "nightly");
    assert.throws(
      () => parseArgs(["--check-published", "--draft"]),
      /pick different modes/u,
    );
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

describe("arguments", () => {
  it("parses --channel and rejects an unknown one", () => {
    assert.equal(parseArgs(["--channel", "preview"]).channel, "preview");
    assert.equal(parseArgs([]).channel, "stable");
    assert.throws(() => parseArgs(["--channel", "canary"]), /unknown channel/u);
  });

  it("parses --manifest and defaults it to no override", () => {
    assert.equal(parseArgs([]).manifest, null);
    assert.equal(
      parseArgs(["--manifest", "some/manifest.json"]).manifest,
      "some/manifest.json",
    );
    assert.throws(() => parseArgs(["--manifest"]), /--manifest needs a value/u);
  });
});

describe("channel releases", () => {
  it("prefixes the tag for a pre-release channel", () => {
    assert.equal(aggregateTag("2026-11-23"), "suite-2026.11.23");
    assert.equal(aggregateTag("2026-11-23", "nightly"), "suite-nightly-2026.11.23");
    assert.equal(aggregateTag("2026-11-23", "preview"), "suite-preview-2026.11.23");
  });

  it("marks pre-release drafts and publications", () => {
    const draft = draftReleaseArgs({
      tag: "suite-nightly-2026.11.23",
      title: "Suite Shell + Suite Go — 2026-11-23",
      notesPath: "notes.md",
      action: "create",
      target: "abc123",
      prerelease: true,
    });
    assert.ok(draft.includes("--prerelease"));
    const publish = publishReleaseArgs({
      tag: "suite-nightly-2026.11.23",
      notesPath: "notes.md",
      latest: false,
      prerelease: true,
    });
    assert.ok(publish.includes("--latest=false"));
    assert.ok(publish.includes("--prerelease"));
    assert.ok(!publish.includes("--latest"));
  });

  it("links the newest pre-release releases from the stable body", () => {
    const links = preReleaseLinks([
      { tagName: "suite-preview-2026.11.22", isDraft: false },
      { tagName: "suite-preview-2026.11.23", isDraft: false },
      { tagName: "suite-nightly-2026.11.23", isDraft: false },
      { tagName: "suite-nightly-2026.11.24", isDraft: true },
      { tagName: "suite-2026.11.23", isDraft: false },
    ]);
    assert.deepEqual(links, [
      { channel: "preview", tag: "suite-preview-2026.11.23" },
      { channel: "nightly", tag: "suite-nightly-2026.11.23" },
    ]);
  });

  it("prunes only the older published releases of one channel", () => {
    const releases = [
      { tagName: "suite-nightly-2026.11.23", isDraft: false },
      { tagName: "suite-nightly-2026.11.22", isDraft: false },
      { tagName: "suite-nightly-2026.11.21", isDraft: false },
      { tagName: "suite-nightly-2026.11.20", isDraft: true },
      { tagName: "suite-preview-2026.11.01", isDraft: false },
      { tagName: "suite-2026.11.01", isDraft: false },
    ];
    assert.deepEqual(pruneCandidates(releases, { channel: "nightly", keep: 2 }), [
      "suite-nightly-2026.11.21",
    ]);
  });
});

describe("release notes name their channel", () => {
  /** The text between two headings, so a label is read under the right app. */
  function between(body, heading, next) {
    const start = body.indexOf(heading);
    assert.ok(start >= 0, `${heading} is missing`);
    const end = body.indexOf(next, start + heading.length);
    return body.slice(start, end === -1 ? body.length : end);
  }

  it("says nightly under Suite Shell and Suite Go", () => {
    const body = aggregateReleaseBody(entries, {
      date: "2026-11-23",
      tag: "suite-nightly-2026.11.23",
      channel: "nightly",
    });
    assert.match(
      between(body, "## Suite Shell (desktop)", "## Suite Go (mobile)"),
      /\*\*Channel:\*\* nightly/u,
    );
    assert.match(
      between(body, "## Suite Go (mobile)", "## Current versions"),
      /\*\*Channel:\*\* nightly/u,
    );
  });

  it("says preview on a preview body", () => {
    const body = aggregateReleaseBody(entries, {
      date: "2026-11-23",
      tag: "suite-preview-2026.11.23",
      channel: "preview",
    });
    assert.match(body, /\*\*Channel:\*\* preview/u);
    assert.doesNotMatch(body, /\*\*Channel:\*\* stable/u);
    assert.ok(body.includes("flatpak install --user suite run.suite.slop.shell//preview"));
  });

  it("installs the pre-release id on its branch, not the stable id", () => {
    const body = aggregateReleaseBody(entries, {
      date: "2026-11-23",
      tag: "suite-nightly-2026.11.23",
      channel: "nightly",
    });
    assert.ok(body.includes("flatpak install --user suite run.suite.slop.shell//nightly"));
    assert.ok(body.includes("flatpak run run.suite.slop.shell//nightly"));
    assert.ok(!body.includes("flatpak install --user suite run.suite.shell"));
    assert.ok(!body.includes("flatpak run run.suite.shell"));

    const stable = aggregateReleaseBody(entries, { date: "2026-11-23" });
    assert.ok(stable.includes("flatpak install --user suite run.suite.shell\n"));
    assert.ok(!stable.includes("run.suite.slop.shell"));
  });

  it("still says stable on a stable body", () => {
    const body = aggregateReleaseBody(entries, { date: "2026-11-23" });
    assert.match(
      between(body, "## Suite Shell (desktop)", "## Suite Go (mobile)"),
      /\*\*Channel:\*\* stable/u,
    );
  });

  it("keeps releaseLabels on the standalone release channel too", () => {
    assert.deepEqual(releaseLabels(shell, "preview"), [
      "- **Channel:** preview",
      "- **Maturity:** alpha",
    ]);
    assert.deepEqual(releaseLabels(shell), [
      "- **Channel:** stable",
      "- **Maturity:** alpha",
    ]);
  });
});

describe("the Artifacts section", () => {
  const flatpakCommit = "c".repeat(64);
  const flatpakSha = "d".repeat(64);
  const apkSha = "e".repeat(64);
  const manifest = {
    format: 1,
    channel: "nightly",
    commit: "a".repeat(40),
    lockfile: { path: "pnpm-lock.yaml", sha256: "b".repeat(64) },
    artifacts: [
      {
        kind: "flatpak",
        id: "run.suite.slop.shell",
        branch: "nightly",
        commit: flatpakCommit,
        file: ".dev/release/suite-shell-nightly.flatpak",
        sha256: flatpakSha,
        size: 1024,
      },
      {
        kind: "apk",
        id: "run.suite.slop.go",
        file: "apps/go/.dev/release/suite-go-nightly-0.1.0.apk",
        sha256: apkSha,
        size: 2048,
      },
    ],
    signers: { flatpak: null, android: "0".repeat(64) },
  };
  const tag = "suite-nightly-2026.11.23";

  it("reads both digests, the manifest link and the verify commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "suite-release-manifest-"));
    try {
      const path = join(dir, MANIFEST_FILE);
      writeFileSync(path, JSON.stringify(manifest));
      const read = readManifest(path);
      assert.ok(read !== null);

      const body = aggregateReleaseBody(entries, {
        date: "2026-11-23",
        tag,
        channel: "nightly",
        manifest: read,
      });

      assert.match(body, /## Artifacts/u);
      assert.ok(body.includes(flatpakCommit), "the OSTree commit is named");
      assert.ok(body.includes(flatpakSha), "the Flatpak bundle digest is named");
      assert.ok(body.includes(apkSha), "the APK digest is named");
      assert.ok(body.includes("branch `nightly`"), "the Flatpak branch is named");
      assert.ok(body.includes(`[${MANIFEST_FILE}](${releaseAssetUrl(tag, MANIFEST_FILE)})`));
      assert.match(body, /sha256sum -c suite-go-nightly-0\.1\.0\.apk\.sha256/u);
      assert.ok(body.includes("flatpak install --user suite run.suite.slop.shell//nightly"));
      assert.ok(body.includes("flatpak info run.suite.slop.shell//nightly"));

      const draft = aggregateReleaseBody(entries, {
        date: "2026-11-23",
        tag,
        channel: "nightly",
        draft: true,
        manifest: read,
      });
      assert.ok(draft.includes(apkSha), "a draft may state a digest: the bytes are already built");
      assert.match(draft, /these are\s+the final bytes/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the catalogue index and the operator fingerprint it must be pinned against", () => {
    const dir = mkdtempSync(join(tmpdir(), "suite-release-index-"));
    try {
      const fingerprint =
        "AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99";
      const path = join(dir, INDEX_RELEASE_FILE);
      writeFileSync(
        path,
        JSON.stringify({
          sequence: 7,
          url: "https://flatpak.suite.run/index.json",
          signatureUrl: "https://flatpak.suite.run/index.json.sig",
          expires: "2026-12-01T00:00:00.000Z",
          fingerprint,
        }),
      );
      const index = readIndexRelease(path);
      assert.ok(index !== null);

      const body = aggregateReleaseBody(entries, {
        date: "2026-11-23",
        tag: "suite-2026.11.23",
        index,
      });
      assert.match(body, /## Catalogue index/u);
      assert.ok(body.includes("sequence 7"));
      assert.ok(body.includes("[index.json](https://flatpak.suite.run/index.json)"));
      assert.ok(body.includes("[index.json.sig](https://flatpak.suite.run/index.json.sig)"));
      assert.ok(body.includes(`Catalogue operator fingerprint: \`${fingerprint}\``));
      assert.ok(body.includes("2026-12-01T00:00:00.000Z"));

      const none = aggregateReleaseBody(entries, { date: "2026-11-23" });
      assert.doesNotMatch(none, /## Catalogue index/u);
      assert.equal(
        readIndexRelease(join(tmpdir(), "suite-no-such-index", INDEX_RELEASE_FILE)),
        null,
      );

      writeFileSync(path, "{}");
      assert.throws(() => readIndexRelease(path), /no usable sequence/u);
      writeFileSync(path, "not json");
      assert.throws(() => readIndexRelease(path), /not valid JSON/u);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("has no Artifacts section when no manifest exists", () => {
    const body = aggregateReleaseBody(entries, {
      date: "2026-11-23",
      tag: "suite-2026.11.23",
    });
    assert.doesNotMatch(body, /## Artifacts/u);
    assert.doesNotMatch(body, /sha256sum/u);
    assert.doesNotMatch(body, /release-manifest\.json/u);
    assert.equal(
      readManifest(join(tmpdir(), "suite-no-such-manifest", MANIFEST_FILE)),
      null,
    );
  });
});

