#!/usr/bin/env node
/**
 * Delivery signals: what shipped, how late, and how often the checks failed.
 *
 * Four numbers, read from GitHub and never written back:
 *
 * - **Publication frequency.** GitHub releases published in the window, split by
 *   channel. Tag prefixes carry the channel (`nightly-...`, `suite-preview-...`);
 *   everything else is stable, exactly as `release-status.mjs` writes it.
 * - **Merge → nightly lead time.** For each completed `nightly` run of `main` in
 *   the window, the committer date of the run's `headSha` up to the run's
 *   `createdAt`. Median and p90, in hours.
 * - **Change-fail rate.** Completed `main` push runs and `merge_group` runs of the
 *   workflows in `.github/workflows/` that failed, as a share of those runs. A run
 *   that was cancelled or never started was not evaluated, so it is in neither the
 *   numerator nor the denominator; a Dependabot or Pages run is not a delivery
 *   check and is not read at all.
 * - **Rework rate.** The share of non-merge `main` commits whose subject starts
 *   with `revert`, or with `fix` and the commit changes a file an earlier commit
 *   in the window also changed. The exact rule is printed with every table.
 *
 * The point of printing the rules and the gaps beside the numbers is that none
 * of these is a delivery score. A release that carries no artifact still counts,
 * lead time stops at a workflow run rather than at an install, and rework is a
 * churn proxy, not a defect rate (D9.1). User update adoption is deliberately
 * absent: desktop and mobile users update on their own schedule (D9.1).
 *
 * Without `--fixture` every fact comes from `gh`, and a reading failure is the
 * command's own error rather than a partial table. `--fixture` reads a saved
 * document with the same shape so the arithmetic can run with no network.
 *
 * Usage:
 *   node scripts/delivery-signals.mjs                       # last 30 days, live
 *   node scripts/delivery-signals.mjs --since 90 --json
 *   node scripts/delivery-signals.mjs --fixture signals.json --since 30
 *   node scripts/delivery-signals.mjs --help
 *
 * spec: D9.1 D9.2
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** The default window, and the one the weekly workflow runs. */
export const DEFAULT_SINCE_DAYS = 30;

/** Every channel a release can publish on, in the order the table prints them. */
export const CHANNELS = ["stable", "nightly", "preview", "slop"];

/** The channels whose tag carries a prefix; stable keeps the bare tag. */
const PRE_RELEASE_CHANNELS = CHANNELS.filter((channel) => channel !== "stable");

/** A conclusion that means the run failed. Cancelled and skipped are not failures. */
export const FAILED_CONCLUSIONS = ["failure", "timed_out", "startup_failure"];

/** Completed runs that never evaluated the change: excluded from the denominator. */
const NOT_EVALUATED_CONCLUSIONS = ["cancelled", "skipped", "neutral", "stale", "action_required"];

const USAGE = `usage: node scripts/delivery-signals.mjs [options]

  --since <days>     window to measure, ending now (default: ${DEFAULT_SINCE_DAYS})
  --fixture <path>   read a saved document instead of calling gh
  --json             print the model as JSON instead of the table
  --help             print this text

Reads releases, Actions runs and main commits through gh. A gh failure is
printed as gh reported it and the command exits nonzero; it never prints a
partial table.

The model has the shape:
  { repository, generatedAt, windowDays, windowStart, windowEnd,
    releases, leadTime, changeFail, rework }

spec: D9.1 D9.2
`;

/**
 * Parse the command line.
 *
 * `--since` must be a positive whole number of days. `--fixture` reads that
 * document instead of the live path, so a saved window always reproduces.
 */
export function parseArgs(argv) {
  const options = { since: DEFAULT_SINCE_DAYS, fixture: null, json: false, help: false };

  function takeValue(index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    return value;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--since") {
      options.since = Number(takeValue(index, "--since"));
      if (!Number.isInteger(options.since) || options.since < 1) {
        throw new Error("--since needs a positive whole number of days");
      }
      index += 1;
    } else if (arg === "--fixture") {
      options.fixture = takeValue(index, "--fixture");
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }

  return options;
}

/** The window ending at `now`, as dates. */
export function windowFor(now, sinceDays = DEFAULT_SINCE_DAYS) {
  const end = new Date(now);
  if (Number.isNaN(end.getTime())) {
    throw new Error(`not a timestamp: ${JSON.stringify(now)}`);
  }
  return { start: new Date(end.getTime() - sinceDays * DAY_MS), end };
}

function inWindow(timestamp, window) {
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && time >= window.start.getTime() && time <= window.end.getTime();
}

/**
 * The channel a release tag belongs to.
 *
 * The release script writes `<channel>-<app>-v<version>` for an app and
 * `suite-<channel>-<date>` for the rolling release; a stable tag carries no
 * channel prefix. An unknown tag is stable rather than guessed: the two shapes
 * above are the only ones this repository publishes.
 */
export function channelForTag(tag) {
  const name = String(tag ?? "");
  for (const channel of PRE_RELEASE_CHANNELS) {
    if (name.startsWith(`suite-${channel}-`) || name.startsWith(`${channel}-`)) return channel;
  }
  return "stable";
}

/**
 * A percentile by linear interpolation between the closest ranks.
 *
 * `percentile([4, 6, 8, 26], 0.5)` is 7 and `0.9` is 20.6. The median of an even
 * count is the mean of the two middle values, as a reader expects.
 */
export function percentile(values, fraction) {
  if (fraction < 0 || fraction > 1) {
    throw new Error(`percentile needs a fraction between 0 and 1, not ${fraction}`);
  }
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = (sorted.length - 1) * fraction;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** Releases that were published inside the window; a draft was not published. */
export function releasesInWindow(releases, window) {
  return releases.filter((release) => {
    if (release.isDraft === true) return false;
    const published = release.publishedAt ?? release.createdAt;
    return published !== null && published !== undefined && inWindow(published, window);
  });
}

/** Releases per channel, plus the total. */
export function countReleases(releases) {
  const byChannel = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
  for (const release of releases) byChannel[channelForTag(release.tagName)] += 1;
  return { byChannel, total: releases.length };
}

function workflowName(run) {
  return run.workflowName ?? run.name ?? "";
}

/** Completed `nightly` runs of `main` created inside the window. */
export function nightlyRunsInWindow(runs, window) {
  return runs.filter(
    (run) =>
      workflowName(run) === "nightly" &&
      run.status === "completed" &&
      run.headBranch === "main" &&
      inWindow(run.createdAt, window),
  );
}

/**
 * One lead-time sample per nightly run: commit time of `headSha` → run creation.
 *
 * Every run must have a resolved commit time. A missing one is an error rather
 * than a dropped sample, so the count in the table is the count that was read.
 */
export function leadTimes(runs, commitTimes) {
  const samples = [];
  for (const run of runs) {
    const committedAt = commitTimes[run.headSha];
    if (committedAt === undefined) {
      throw new Error(`no commit time for nightly head ${run.headSha}`);
    }
    const hours = (new Date(run.createdAt).getTime() - new Date(committedAt).getTime()) / HOUR_MS;
    if (!Number.isFinite(hours) || hours < 0) {
      throw new Error(`nightly run ${run.createdAt} predates its commit ${committedAt}`);
    }
    samples.push({ headSha: run.headSha, createdAt: run.createdAt, committedAt, hours });
  }
  const values = samples.map((sample) => sample.hours);
  const scheduled = runs.filter((run) => run.event === "schedule").length;
  return {
    samples,
    n: values.length,
    scheduled,
    dispatched: values.length - scheduled,
    medianHours: percentile(values, 0.5),
    p90Hours: percentile(values, 0.9),
  };
}

/**
 * Change-fail: failed `main` push and `merge_group` runs, over those runs.
 *
 * A completed run whose conclusion never evaluated the change (cancelled,
 * skipped, ...) is left out of both sides. A run still in flight is not a
 * result yet, so it is left out too.
 */
export function changeFailRuns(runs, window) {
  const eligible = runs.filter(
    (run) =>
      run.status === "completed" &&
      !NOT_EVALUATED_CONCLUSIONS.includes(run.conclusion) &&
      inWindow(run.createdAt, window) &&
      ((run.event === "push" && run.headBranch === "main") || run.event === "merge_group"),
  );
  const tally = (subset) => ({
    failed: subset.filter((run) => FAILED_CONCLUSIONS.includes(run.conclusion)).length,
    total: subset.length,
  });
  const mainPush = tally(eligible.filter((run) => run.event === "push"));
  const mergeGroup = tally(eligible.filter((run) => run.event === "merge_group"));
  const failed = mainPush.failed + mergeGroup.failed;
  const total = mainPush.total + mergeGroup.total;
  return { failed, total, rate: total === 0 ? null : failed / total, mainPush, mergeGroup };
}

/** True when a commit subject is a revert, whatever the case. */
export function isRevertSubject(subject) {
  return /^revert\b/iu.test(String(subject ?? ""));
}

/** True when a commit subject is a conventional `fix` type. */
export function isFixSubject(subject) {
  return /^fix(?:\(|!|:|\s|$)/iu.test(String(subject ?? ""));
}

/**
 * Rework: a commit that undoes, or patches, work an earlier window commit did.
 *
 * The rule is deliberately narrow and is printed under every table:
 *
 * - a subject that starts with `revert` always counts;
 * - a subject that starts with `fix` counts only when it changes an exact file
 *   path an *earlier* commit in the window changed;
 * - merge commits are not rework and are not in the denominator, because a PR
 *   merge would otherwise count every branch commit twice.
 *
 * Commits are ordered by committer date, then by sha, so the result does not
 * depend on the order the API returned. Paths are exact file names, never
 * directories: a directory rule would call unrelated work a rework.
 */
export function reworkSummary(commits, window) {
  const ordered = commits
    .filter((commit) => inWindow(commit.committedAt, window))
    .sort(
      (left, right) =>
        String(left.committedAt).localeCompare(String(right.committedAt)) ||
        String(left.sha).localeCompare(String(right.sha)),
    );
  const changed = new Set();
  let evaluated = 0;
  let reverts = 0;
  let fixOfChangedPath = 0;
  for (const commit of ordered) {
    const subject = String(commit.subject ?? "");
    const paths = Array.isArray(commit.paths) ? commit.paths : [];
    const merge = (commit.parents ?? 0) > 1 || /^merge\b/iu.test(subject);
    if (merge) {
      for (const path of paths) changed.add(path);
      continue;
    }
    evaluated += 1;
    if (isRevertSubject(subject)) {
      reverts += 1;
    } else if (isFixSubject(subject) && paths.some((path) => changed.has(path))) {
      fixOfChangedPath += 1;
    }
    for (const path of paths) changed.add(path);
  }
  const rework = reverts + fixOfChangedPath;
  return {
    commits: evaluated,
    rework,
    rate: evaluated === 0 ? null : rework / evaluated,
    reverts,
    fixOfChangedPath,
  };
}

function round(value) {
  return value === null ? null : Number(value.toFixed(2));
}

/** The whole model from one input document. No I/O. */
export function computeSignals(input) {
  const sinceDays = input.sinceDays ?? DEFAULT_SINCE_DAYS;
  if (!Number.isInteger(sinceDays) || sinceDays < 1) {
    throw new Error(`sinceDays must be a positive whole number, not ${JSON.stringify(sinceDays)}`);
  }
  const window = windowFor(input.now, sinceDays);
  const releases = countReleases(releasesInWindow(input.releases ?? [], window));
  const lead = leadTimes(nightlyRunsInWindow(input.runs ?? [], window), input.commitTimes ?? {});
  const fail = changeFailRuns(input.runs ?? [], window);
  const rework = reworkSummary(input.commits ?? [], window);
  return {
    repository: input.repository ?? null,
    generatedAt: window.end.toISOString(),
    windowDays: sinceDays,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    releases,
    leadTime: {
      runs: lead.n,
      scheduled: lead.scheduled,
      dispatched: lead.dispatched,
      medianHours: round(lead.medianHours),
      p90Hours: round(lead.p90Hours),
      samples: lead.samples.map((sample) => ({
        headSha: sample.headSha,
        committedAt: sample.committedAt,
        createdAt: sample.createdAt,
        hours: round(sample.hours),
      })),
    },
    changeFail: {
      failed: fail.failed,
      total: fail.total,
      rate: round(fail.rate),
      mainPush: fail.mainPush,
      mergeGroup: fail.mergeGroup,
    },
    rework: {
      commits: rework.commits,
      rework: rework.rework,
      rate: round(rework.rate),
      reverts: rework.reverts,
      fixOfChangedPath: rework.fixOfChangedPath,
    },
  };
}

function formatHours(hours) {
  return hours === null ? "—" : `${hours.toFixed(1)}h`;
}

function formatShare(numerator, denominator, rate, unit) {
  if (denominator === 0 || rate === null) return `— (0 ${unit})`;
  return `${numerator}/${denominator} = ${(rate * 100).toFixed(1)}%`;
}

function date(iso) {
  return String(iso).slice(0, 10);
}

/**
 * The compact table, with the rules and the gaps that keep it honest.
 *
 * Every metric carries the sentence that says what it is not. A reader should
 * never have to open the script to learn that a release with no artifact still
 * counts or that a cancelled run is missing from the denominator.
 */
export function renderTable(model) {
  const row = (label, value) => `  ${label.padEnd(28)}${value}`;
  const lines = [];
  lines.push(`Delivery signals — ${model.repository ?? "unknown repository"}`);
  lines.push(
    `Window: last ${model.windowDays} days (${date(model.windowStart)} → ${date(model.windowEnd)}), dates UTC`,
  );
  lines.push("");

  lines.push("Releases published per channel");
  for (const channel of CHANNELS) {
    lines.push(row(channel, String(model.releases.byChannel[channel])));
  }
  lines.push(row("total", String(model.releases.total)));
  if (model.releases.total === 0) lines.push("  no releases were published in the window");
  lines.push("");

  lines.push("Merge → nightly lead time");
  lines.push(
    row(
      "runs",
      `${model.leadTime.runs} (${model.leadTime.scheduled} scheduled, ${model.leadTime.dispatched} dispatched)`,
    ),
  );
  lines.push(row("median", formatHours(model.leadTime.medianHours)));
  lines.push(row("p90", formatHours(model.leadTime.p90Hours)));
  lines.push("");

  lines.push("Change-fail rate");
  lines.push(
    row(
      "all",
      formatShare(model.changeFail.failed, model.changeFail.total, model.changeFail.rate, "runs"),
    ),
  );
  lines.push(
    row(
      "main push",
      formatShare(
        model.changeFail.mainPush.failed,
        model.changeFail.mainPush.total,
        model.changeFail.mainPush.total === 0
          ? null
          : model.changeFail.mainPush.failed / model.changeFail.mainPush.total,
        "runs",
      ),
    ),
  );
  lines.push(
    row(
      "merge group",
      formatShare(
        model.changeFail.mergeGroup.failed,
        model.changeFail.mergeGroup.total,
        model.changeFail.mergeGroup.total === 0
          ? null
          : model.changeFail.mergeGroup.failed / model.changeFail.mergeGroup.total,
        "runs",
      ),
    ),
  );
  lines.push("");

  lines.push("Rework rate");
  lines.push(
    row(
      "all",
      formatShare(model.rework.rework, model.rework.commits, model.rework.rate, "commits"),
    ),
  );
  lines.push(row("revert subject", String(model.rework.reverts)));
  lines.push(row("fix of a changed path", String(model.rework.fixOfChangedPath)));
  lines.push("");

  lines.push("What these numbers do not measure");
  lines.push(
    "  releases     GitHub Releases only; the signed Flatpak remote is not read, and a",
  );
  lines.push("               release that carries no new artifact still counts.");
  lines.push(
    "  lead time    time to a workflow run, not to an install; a manual nightly dispatch",
  );
  lines.push("               shortens it, and a commit keeps the date it was committed.");
  lines.push(
    "  change-fail  only main push and merge_group runs of this repository's",
  );
  lines.push(
    "               workflows; a red nightly or release run is outside it, a",
  );
  lines.push("               cancelled or in-flight run is not counted, and a Dependabot");
  lines.push("               or Pages run is not read at all.");
  lines.push(
    "  rework       a churn proxy, not a defect rate; it cannot see a fix that touches",
  );
  lines.push("               a path only later, or never, in the window.");
  lines.push("");
  lines.push("Rules");
  lines.push("  lead time    committer date of the nightly run's headSha → the run's createdAt;");
  lines.push("               scheduled and dispatched runs both count.");
  lines.push("  change-fail  failed = failure, timed_out or startup_failure; completed runs only.");
  lines.push("               scope = workflows whose file is under .github/workflows/.");
  lines.push(
    "  rework       subject starts with revert, or with fix and the commit changes an",
  );
  lines.push(
    "               exact path an earlier main commit in the window changed. Merge",
  );
  lines.push("               commits are neither rework nor in the denominator.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Reading: live through gh, or one fixture document.
// ---------------------------------------------------------------------------

function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (result.error) {
    throw new Error(`gh ${args.join(" ")}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || `gh exited ${result.status}`).trim();
    throw new Error(message);
  }
  return result.stdout;
}

function ghJson(args) {
  const stdout = gh(args).trim();
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`gh ${args.join(" ")} did not return JSON: ${stdout.slice(0, 200)}`);
  }
}

/** One commit detail, cached by sha: subject, committer date, parents and paths. */
function commitDetail(repo, sha, cache) {
  if (cache.has(sha)) return cache.get(sha);
  const detail = ghJson(["api", `repos/${repo}/commits/${sha}`]);
  const entry = {
    sha,
    subject: String(detail.commit?.message ?? "").split("\n")[0],
    committedAt: detail.commit?.committer?.date,
    parents: Array.isArray(detail.parents) ? detail.parents.length : 0,
    paths: Array.isArray(detail.files) ? detail.files.map((file) => file.filename) : [],
  };
  if (entry.committedAt === undefined) {
    throw new Error(`commit ${sha} has no committer date`);
  }
  cache.set(sha, entry);
  return entry;
}

/** Every main commit the API returns in the window, newest first; capped at 1000. */
function readMainCommitShas(repo, window) {
  const shas = [];
  for (let page = 1; page <= 10; page += 1) {
    const query =
      `repos/${repo}/commits?sha=main&since=${encodeURIComponent(window.start.toISOString())}` +
      `&until=${encodeURIComponent(window.end.toISOString())}&per_page=100&page=${page}`;
    const batch = ghJson(["api", query]);
    if (!Array.isArray(batch)) {
      throw new Error(`gh api ${query} did not return a list`);
    }
    for (const commit of batch) shas.push(commit.sha);
    if (batch.length < 100) return shas;
  }
  throw new Error("more than 1000 main commits in the window; run with a smaller --since");
}

function requireNotTruncated(items, limit, what) {
  if (items.length < limit) return;
  throw new Error(
    `read ${limit} ${what}, the whole limit: narrow --since rather than report a truncated window`,
  );
}

/** Read the whole model input through gh. Any failure is thrown, never swallowed. */
export function fetchLive(sinceDays = DEFAULT_SINCE_DAYS) {
  const now = new Date().toISOString();
  const window = windowFor(now, sinceDays);
  const repository = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();

  const releaseLimit = 200;
  const releases = ghJson([
    "release",
    "list",
    "--repo",
    repository,
    "--limit",
    String(releaseLimit),
    "--json",
    "tagName,name,isDraft,isPrerelease,publishedAt,createdAt",
  ]);
  requireNotTruncated(releases, releaseLimit, "releases");

  const runLimit = 1000;
  const listedRuns = ghJson([
    "run",
    "list",
    "--repo",
    repository,
    "--limit",
    String(runLimit),
    "--created",
    `>=${date(window.start.toISOString())}`,
    "--json",
    "databaseId,workflowDatabaseId,workflowName,name,event,status,conclusion,headBranch,headSha,createdAt",
  ]);
  requireNotTruncated(listedRuns, runLimit, "runs");

  // Only workflows committed here are delivery checks: Dependabot's update runs
  // and the Pages deployment share the run list but are not this pipeline.
  const workflowList = ghJson(["api", `repos/${repository}/actions/workflows?per_page=100`]);
  const workflows = Array.isArray(workflowList?.workflows) ? workflowList.workflows : null;
  if (workflows === null) {
    throw new Error(`gh api repos/${repository}/actions/workflows returned no workflow list`);
  }
  if (workflows.length === 100) {
    throw new Error("100 workflows were read with per_page=100; this reader does not paginate");
  }
  const repositoryWorkflowIds = new Set(
    workflows
      .filter((workflow) => String(workflow.path ?? "").startsWith(".github/workflows/"))
      .map((workflow) => workflow.id),
  );
  const runs = listedRuns.filter((run) => repositoryWorkflowIds.has(run.workflowDatabaseId));

  const cache = new Map();
  const commits = readMainCommitShas(repository, window).map((sha) =>
    commitDetail(repository, sha, cache),
  );

  const commitTimes = {};
  for (const nightly of nightlyRunsInWindow(runs, window)) {
    commitTimes[nightly.headSha] = commitDetail(repository, nightly.headSha, cache).committedAt;
  }

  return { repository, now, sinceDays, releases, runs, commits, commitTimes };
}

/** Read a saved input document. `now` is required so a window is reproducible. */
export function readFixture(path) {
  const input = JSON.parse(readFileSync(path, "utf8"));
  if (typeof input.now !== "string") {
    throw new Error(`fixture ${path} has no "now" timestamp`);
  }
  for (const key of ["releases", "runs", "commits"]) {
    if (input[key] !== undefined && !Array.isArray(input[key])) {
      throw new Error(`fixture ${path} has a non-list "${key}"`);
    }
  }
  if (input.commitTimes !== undefined && typeof input.commitTimes !== "object") {
    throw new Error(`fixture ${path} has a non-object "commitTimes"`);
  }
  return input;
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`delivery-signals: ${error.message}\n`);
    process.exit(2);
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    const input = options.fixture === null
      ? fetchLive(options.since)
      : { ...readFixture(options.fixture), sinceDays: options.since };
    const model = computeSignals(input);
    process.stdout.write(options.json ? `${JSON.stringify(model, null, 2)}\n` : renderTable(model));
  } catch (error) {
    process.stderr.write(`delivery-signals: ${error.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
