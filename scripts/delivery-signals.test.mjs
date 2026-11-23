import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHANNELS,
  channelForTag,
  changeFailRuns,
  computeSignals,
  countReleases,
  leadTimes,
  nightlyRunsInWindow,
  parseArgs,
  percentile,
  releasesInWindow,
  renderTable,
  reworkSummary,
  windowFor,
} from "./delivery-signals.mjs";

/**
 * One saved window, enough for every metric.
 *
 * The window ends 2026-11-23T22:00Z and is 30 days wide, so it starts
 * 2026-10-24T22:00Z. The nightly samples are 8, 6, 26 and 4 hours: median 7,
 * p90 20.6. The change-fail runs are 2/3 main pushes and 1/2 merge-group runs.
 * The rework commits are one revert and two fixes of a path an earlier commit
 * changed, out of six non-merge commits.
 */
const fixture = {
  repository: "mrrnbhd/suite-apps",
  now: "2026-11-23T22:00:00Z",
  releases: [
    { tagName: "suite-2026.11.22", publishedAt: "2026-11-22T22:00:00Z" },
    { tagName: "canvas-v0.1.12", publishedAt: "2026-11-21T22:14:37Z" },
    { tagName: "suite-nightly-2026.11.22", publishedAt: "2026-11-23T08:00:00Z" },
    { tagName: "nightly-shell-v0.2.0", publishedAt: "2026-11-20T03:00:00Z" },
    { tagName: "suite-preview-2026.11.19", publishedAt: "2026-11-19T03:00:00Z" },
    { tagName: "slop-canvas-v0.1.12", publishedAt: "2026-11-18T03:00:00Z" },
    { tagName: "start-v9.9.9", isDraft: true, createdAt: "2026-11-17T03:00:00Z" },
    { tagName: "canvas-v0.1.0", publishedAt: "2026-10-01T00:00:00Z" },
  ],
  runs: [
    // Nightly: four completed runs of main, plus one in flight and one branch run.
    { workflowName: "nightly", event: "schedule", status: "completed", conclusion: "success", headBranch: "main", headSha: "a".repeat(40), createdAt: "2026-11-20T02:00:00Z" },
    { workflowName: "nightly", event: "schedule", status: "completed", conclusion: "success", headBranch: "main", headSha: "b".repeat(40), createdAt: "2026-11-21T02:00:00Z" },
    { workflowName: "nightly", event: "schedule", status: "completed", conclusion: "success", headBranch: "main", headSha: "c".repeat(40), createdAt: "2026-11-22T02:00:00Z" },
    { workflowName: "nightly", event: "workflow_dispatch", status: "completed", conclusion: "success", headBranch: "main", headSha: "d".repeat(40), createdAt: "2026-11-23T02:00:00Z" },
    { workflowName: "nightly", event: "schedule", status: "in_progress", conclusion: null, headBranch: "main", headSha: "e".repeat(40), createdAt: "2026-11-24T02:00:00Z" },
    { workflowName: "nightly", event: "workflow_dispatch", status: "completed", conclusion: "success", headBranch: "feat/branch", headSha: "f".repeat(40), createdAt: "2026-11-19T02:00:00Z" },
    // Main pushes and merge-group runs.
    { workflowName: "main", event: "push", status: "completed", conclusion: "success", headBranch: "main", headSha: "1".repeat(40), createdAt: "2026-11-10T02:00:00Z" },
    { workflowName: "main", event: "push", status: "completed", conclusion: "failure", headBranch: "main", headSha: "2".repeat(40), createdAt: "2026-11-11T02:00:00Z" },
    { workflowName: "main", event: "push", status: "completed", conclusion: "timed_out", headBranch: "main", headSha: "3".repeat(40), createdAt: "2026-11-12T02:00:00Z" },
    { workflowName: "main", event: "push", status: "completed", conclusion: "failure", headBranch: "feat/branch", headSha: "4".repeat(40), createdAt: "2026-11-12T03:00:00Z" },
    { workflowName: "ci", event: "merge_group", status: "completed", conclusion: "success", headBranch: "gh-readonly-queue/main/x", headSha: "5".repeat(40), createdAt: "2026-11-13T02:00:00Z" },
    { workflowName: "ci", event: "merge_group", status: "completed", conclusion: "failure", headBranch: "gh-readonly-queue/main/y", headSha: "6".repeat(40), createdAt: "2026-11-14T02:00:00Z" },
    { workflowName: "ci", event: "merge_group", status: "completed", conclusion: "cancelled", headBranch: "gh-readonly-queue/main/z", headSha: "7".repeat(40), createdAt: "2026-11-15T02:00:00Z" },
    { workflowName: "ci", event: "pull_request", status: "completed", conclusion: "failure", headBranch: "feat/branch", headSha: "8".repeat(40), createdAt: "2026-11-16T02:00:00Z" },
    { workflowName: "main", event: "push", status: "completed", conclusion: "failure", headBranch: "main", headSha: "9".repeat(40), createdAt: "2026-09-01T02:00:00Z" },
  ],
  commitTimes: {
    ["a".repeat(40)]: "2026-11-19T18:00:00Z",
    ["b".repeat(40)]: "2026-11-20T20:00:00Z",
    ["c".repeat(40)]: "2026-11-21T00:00:00Z",
    ["d".repeat(40)]: "2026-11-22T22:00:00Z",
  },
  commits: [
    { sha: "1".repeat(40), subject: "feat(canvas): add a board", parents: 1, committedAt: "2026-10-25T10:00:00Z", paths: ["apps/canvas/src/board.tsx"] },
    { sha: "2".repeat(40), subject: "fix(canvas): correct the board layout", parents: 1, committedAt: "2026-10-26T10:00:00Z", paths: ["apps/canvas/src/board.tsx"] },
    { sha: "3".repeat(40), subject: "Merge pull request #1 from mrrnbhd/feat/board", parents: 2, committedAt: "2026-10-27T10:00:00Z", paths: [] },
    { sha: "4".repeat(40), subject: 'Revert "feat(canvas): add a board"', parents: 1, committedAt: "2026-10-28T10:00:00Z", paths: ["apps/canvas/src/board.tsx"] },
    { sha: "5".repeat(40), subject: "fix(planner): tidy a new file", parents: 1, committedAt: "2026-10-29T10:00:00Z", paths: ["apps/planner/src/new.ts"] },
    { sha: "6".repeat(40), subject: "chore: bump dependencies", parents: 1, committedAt: "2026-11-01T10:00:00Z", paths: ["package.json"] },
    { sha: "7".repeat(40), subject: "fix: repair package.json", parents: 1, committedAt: "2026-11-02T10:00:00Z", paths: ["package.json"] },
    { sha: "8".repeat(40), subject: 'Revert "old work"', parents: 1, committedAt: "2026-09-01T10:00:00Z", paths: ["apps/canvas/src/old.ts"] },
  ],
};

const emptyFixture = {
  repository: "mrrnbhd/suite-apps",
  now: fixture.now,
  releases: [],
  runs: [],
  commits: [],
  commitTimes: {},
};

describe("channels and release counts", () => {
  it("reads the channel from the tag prefix", () => {
    assert.equal(channelForTag("suite-2026.11.22"), "stable");
    assert.equal(channelForTag("canvas-v0.1.12"), "stable");
    assert.equal(channelForTag("suite-nightly-2026.11.22"), "nightly");
    assert.equal(channelForTag("nightly-shell-v0.2.0"), "nightly");
    assert.equal(channelForTag("suite-preview-2026.11.19"), "preview");
    assert.equal(channelForTag("slop-canvas-v0.1.12"), "slop");
    assert.equal(channelForTag("v0.1.0"), "stable");
  });

  it("counts published releases per channel and skips drafts and old ones", () => {
    const window = windowFor(fixture.now, 30);
    const counted = countReleases(releasesInWindow(fixture.releases, window));
    assert.deepEqual(counted.byChannel, { stable: 2, nightly: 2, preview: 1, slop: 1 });
    assert.equal(counted.total, 6);
    assert.deepEqual(Object.keys(counted.byChannel), CHANNELS);
  });
});

describe("percentiles", () => {
  it("interpolates the median of an even count", () => {
    assert.equal(percentile([4, 6, 8, 26], 0.5), 7);
  });

  it("interpolates p90 between the closest ranks", () => {
    assert.equal(Number(percentile([4, 6, 8, 26], 0.9).toFixed(1)), 20.6);
  });

  it("returns the ends for a single sample and null for none", () => {
    assert.equal(percentile([3], 0), 3);
    assert.equal(percentile([3], 1), 3);
    assert.equal(percentile([], 0.5), null);
  });

  it("refuses a fraction outside 0..1", () => {
    assert.throws(() => percentile([1], 1.5), /between 0 and 1/u);
  });
});

describe("merge to nightly lead time", () => {
  it("takes the committer date of headSha up to the run creation", () => {
    const window = windowFor(fixture.now, 30);
    const runs = nightlyRunsInWindow(fixture.runs, window);
    assert.equal(runs.length, 4, "the in-flight run and the branch run are excluded");
    const lead = leadTimes(runs, fixture.commitTimes);
    assert.equal(lead.n, 4);
    assert.equal(lead.scheduled, 3);
    assert.equal(lead.dispatched, 1);
    assert.equal(lead.medianHours, 7);
    assert.equal(Number(lead.p90Hours.toFixed(1)), 20.6);
    assert.deepEqual(
      lead.samples.map((sample) => sample.hours),
      [8, 6, 26, 4],
    );
  });

  it("fails rather than dropping a run whose commit time is unknown", () => {
    const window = windowFor(fixture.now, 30);
    const runs = nightlyRunsInWindow(fixture.runs, window);
    assert.throws(() => leadTimes(runs, {}), /no commit time for nightly head/u);
  });
});

describe("change-fail rate", () => {
  it("counts failed main pushes and merge-group runs, not cancelled or PR runs", () => {
    const window = windowFor(fixture.now, 30);
    const fail = changeFailRuns(fixture.runs, window);
    assert.deepEqual(fail.mainPush, { failed: 2, total: 3 });
    assert.deepEqual(fail.mergeGroup, { failed: 1, total: 2 });
    assert.equal(fail.failed, 3);
    assert.equal(fail.total, 5);
    assert.equal(fail.rate, 0.6);
  });

  it("is null when the window has no eligible run", () => {
    const window = windowFor(fixture.now, 30);
    const fail = changeFailRuns([], window);
    assert.equal(fail.total, 0);
    assert.equal(fail.rate, null);
  });
});

describe("rework rate", () => {
  const window = windowFor(fixture.now, 30);

  it("counts a revert, and a fix of a path an earlier commit changed", () => {
    const rework = reworkSummary(fixture.commits, window);
    assert.deepEqual(rework, {
      commits: 6,
      rework: 3,
      rate: 0.5,
      reverts: 1,
      fixOfChangedPath: 2,
    });
  });

  it("does not depend on the order the API returned", () => {
    const forward = reworkSummary(fixture.commits, window);
    const backward = reworkSummary([...fixture.commits].reverse(), window);
    assert.deepEqual(backward, forward);
  });

  it("does not count a fix whose path only it changed", () => {
    const commits = [
      { sha: "a".repeat(40), subject: "fw: something", parents: 1, committedAt: "2026-11-01T00:00:00Z", paths: ["apps/x/one.ts"] },
      { sha: "b".repeat(40), subject: "fix(x): add a file", parents: 1, committedAt: "2026-11-02T00:00:00Z", paths: ["apps/x/two.ts"] },
    ];
    const rework = reworkSummary(commits, window);
    assert.equal(rework.commits, 2);
    assert.equal(rework.rework, 0);
    assert.equal(rework.rate, 0);
  });

  it("counts the conventional bare fix: subject", () => {
    const commits = [
      { sha: "a".repeat(40), subject: "chore: start", parents: 1, committedAt: "2026-11-01T00:00:00Z", paths: ["package.json"] },
      { sha: "b".repeat(40), subject: "fix: stop", parents: 1, committedAt: "2026-11-02T00:00:00Z", paths: ["package.json"] },
    ];
    assert.equal(reworkSummary(commits, window).rework, 1);
  });

  it("leaves merge commits out of the denominator", () => {
    const commits = [
      { sha: "a".repeat(40), subject: "Merge pull request #1 from x/y", parents: 2, committedAt: "2026-11-01T00:00:00Z", paths: ["package.json"] },
      { sha: "b".repeat(40), subject: "fix: stop", parents: 1, committedAt: "2026-11-02T00:00:00Z", paths: ["package.json"] },
    ];
    const rework = reworkSummary(commits, window);
    assert.equal(rework.commits, 1);
    assert.equal(rework.rework, 1);
  });
});

describe("the whole model", () => {
  it("computes every metric from one document", () => {
    const model = computeSignals(fixture);
    assert.equal(model.repository, "mrrnbhd/suite-apps");
    assert.equal(model.windowDays, 30);
    assert.equal(model.windowStart, "2026-10-24T22:00:00.000Z");
    assert.equal(model.releases.total, 6);
    assert.equal(model.leadTime.runs, 4);
    assert.equal(model.leadTime.scheduled, 3);
    assert.equal(model.leadTime.medianHours, 7);
    assert.equal(model.leadTime.p90Hours, 20.6);
    assert.equal(model.changeFail.total, 5);
    assert.equal(model.changeFail.rate, 0.6);
    assert.equal(model.rework.commits, 6);
    assert.equal(model.rework.rate, 0.5);
  });

  it("reports an empty window as empty rather than zero percent", () => {
    const model = computeSignals(emptyFixture);
    assert.equal(model.releases.total, 0);
    assert.deepEqual(model.releases.byChannel, { stable: 0, nightly: 0, preview: 0, slop: 0 });
    assert.equal(model.leadTime.runs, 0);
    assert.equal(model.leadTime.scheduled, 0);
    assert.equal(model.leadTime.dispatched, 0);
    assert.equal(model.leadTime.medianHours, null);
    assert.equal(model.leadTime.p90Hours, null);
    assert.equal(model.changeFail.total, 0);
    assert.equal(model.changeFail.rate, null);
    assert.equal(model.rework.commits, 0);
    assert.equal(model.rework.rate, null);
  });

  it("prints the table, its rules and what it does not measure", () => {
    const table = renderTable(computeSignals(fixture));
    assert.match(table, /Delivery signals — mrrnbhd\/suite-apps/u);
    assert.match(table, /Releases published per channel/u);
    assert.match(table, /Merge → nightly lead time/u);
    assert.match(table, /Change-fail rate/u);
    assert.match(table, /Rework rate/u);
    assert.match(table, /What these numbers do not measure/u);
    assert.match(table, /subject starts with revert/u);
    assert.match(table, /20\.6h/u);
    assert.match(table, /3\/5 = 60\.0%/u);
  });

  it("says plainly when nothing happened in the window", () => {
    const table = renderTable(computeSignals(emptyFixture));
    assert.match(table, /no releases were published in the window/u);
    assert.match(table, /— \(0 runs\)/u);
    assert.match(table, /— \(0 commits\)/u);
  });
});

describe("the command line", () => {
  it("defaults to thirty days and a live read", () => {
    assert.deepEqual(parseArgs([]), { since: 30, fixture: null, json: false, help: false });
  });

  it("takes a window, a fixture and JSON", () => {
    assert.deepEqual(parseArgs(["--since", "7", "--fixture", "x.json", "--json"]), {
      since: 7,
      fixture: "x.json",
      json: true,
      help: false,
    });
  });

  it("refuses a window that is not a positive whole number of days", () => {
    assert.throws(() => parseArgs(["--since", "0"]), /positive whole number/u);
    assert.throws(() => parseArgs(["--since", "2.5"]), /positive whole number/u);
    assert.throws(() => parseArgs(["--since"]), /--since needs a value/u);
    assert.throws(() => parseArgs(["--nope"]), /unknown option --nope/u);
  });
});
