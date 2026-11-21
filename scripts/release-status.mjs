#!/usr/bin/env node
/**
 * The Suite's GitHub releases, generated from the versions already in the tree.
 *
 * GitHub shows one "Latest" release per repository, and this repository ships
 * several apps from one tag namespace. The release page therefore has two
 * shapes:
 *
 * - **One rolling Suite release**, tagged `suite-YYYY.MM.DD`, marked Latest. Its
 *   body is a table of every app's current version, its release date, a link to
 *   that app's own release and the command that installs it.
 * - **One release per app**, tagged `<app>-v<version>`, kept as history and
 *   never marked Latest. It carries the changelog section and an install block;
 *   it carries no app binaries, because the signed Flatpak remote is the update
 *   path.
 *
 * The version has one home: the app's `package.json`. The date has one home: the
 * `## [version] - YYYY-MM-DD` heading in its changelog. This script reads both,
 * refuses a version without a matching section, and writes nothing to GitHub
 * unless `--publish` is passed.
 *
 * Backfilling a tag is deliberate: a missing tag is created at the commit that
 * added the changelog section (`git log -S`), never at HEAD, and an existing tag
 * is never moved. When that commit cannot be found the run refuses.
 *
 * Usage:
 *   node scripts/release-status.mjs            # dry run: commands and bodies
 *   node scripts/release-status.mjs --write    # refresh RELEASES.md only
 *   node scripts/release-status.mjs --publish  # create or update the releases
 *   node scripts/release-status.mjs --date 2026-11-21 --publish
 *   node scripts/release-status.mjs --help
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { changelogSection, versionFromPackage } from "./release.mjs";
import {
  DEFAULT_PUBLIC_URL,
  REMOTE_NAME,
  flatpakrepoUrl as remoteFlatpakrepoUrl,
} from "./lib/flatpakRemote.mjs";

/** The repository this page and these releases belong to. */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const RELEASE_REPO = "mr-rogers-neighborhood/suite-apps";

/** The Flatpak remote a person adds before installing; the signed update path. */
export { REMOTE_NAME };
export const REMOTE_URL = DEFAULT_PUBLIC_URL;

/** The generated human mirror of the Latest release, committed at the root. */
export const RELEASES_FILE = "RELEASES.md";

/** Where a publish writes each release body before handing it to `gh`. */
export const NOTES_DIR = ".dev/releases";

/**
 * Every app the table names, in the order a person reads them.
 *
 * `flatpakId` is null for the relay: it is a server tarball, not a Flatpak, and
 * its install line is the relay guide rather than `flatpak install`.
 */
export const APPS = [
  {
    id: "start",
    name: "Suite Start",
    packageJson: "apps/start/package.json",
    changelog: "apps/start/CHANGELOG.md",
    tagPrefix: "start-v",
    flatpakId: "run.suite.start",
  },
  {
    id: "planner",
    name: "Suite Planner",
    packageJson: "apps/planner/package.json",
    changelog: "apps/planner/CHANGELOG.md",
    tagPrefix: "planner-v",
    flatpakId: "run.suite.planner",
  },
  {
    id: "budget",
    name: "Suite Budget",
    packageJson: "apps/budget/package.json",
    changelog: "apps/budget/CHANGELOG.md",
    tagPrefix: "budget-v",
    flatpakId: "run.suite.budget",
  },
  {
    id: "help",
    name: "Suite Help",
    packageJson: "apps/help/package.json",
    changelog: "apps/help/CHANGELOG.md",
    tagPrefix: "help-v",
    flatpakId: "run.suite.help",
  },
  {
    id: "canvas",
    name: "Suite Canvas",
    packageJson: "apps/canvas/desktop/package.json",
    changelog: "apps/canvas/CHANGELOG.md",
    tagPrefix: "canvas-v",
    flatpakId: "run.suite.canvas",
  },
  {
    id: "sync",
    name: "Suite Sync",
    packageJson: "apps/sync/package.json",
    changelog: "apps/sync/CHANGELOG.md",
    tagPrefix: "sync-v",
    flatpakId: null,
  },
];

const USAGE = `usage: node scripts/release-status.mjs [options]

  --dry-run            print every command and body; the default
  --write              write ${RELEASES_FILE} and stop short of GitHub
  --publish            create or update the releases, then write ${RELEASES_FILE}
  --date <YYYY-MM-DD>  date for the aggregate tag (default: the newest app release)
  --help               print this text

Pass one of --publish, --write and --dry-run. A relay release must already exist
(\`node scripts/release.mjs sync --publish\`); this script only edits its body.

The versions come from each app's package.json; the dates from its changelog.
`;

/** The tag one app's version is released under. */
export function tagFor(app, version) {
  return `${app.tagPrefix}${version}`;
}

/** The aggregate tag, dotted as the owner chose: `suite-2026.11.21`. */
export function aggregateTag(date) {
  return `suite-${date.replace(/-/gu, ".")}`;
}

/** A release's page on GitHub. */
export function releaseUrl(tag) {
  return `https://github.com/${RELEASE_REPO}/releases/tag/${tag}`;
}

/** A file in the repository, for a link inside a release body. */
export function blobUrl(path) {
  return `https://github.com/${RELEASE_REPO}/blob/main/${path}`;
}

/** The `.flatpakrepo` a client adds; it embeds the store's public key. */
export function flatpakrepoUrl() {
  return remoteFlatpakrepoUrl(REMOTE_URL);
}

/** The install command for a Flatpak app, or null for the relay. */
export function installCommand(app) {
  return app.flatpakId === null
    ? null
    : `flatpak install --user ${REMOTE_NAME} ${app.flatpakId}`;
}

/** The table cell that says how one row is installed. */
export function installCell(app) {
  const command = installCommand(app);
  if (command !== null) return `\`${command}\``;
  return `[relay tarball](${blobUrl("apps/sync/docs/how-to/relay.md")})`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The `YYYY-MM-DD` in a `## [version] - YYYY-MM-DD` heading, or null.
 *
 * The date belongs beside the version, so a section without one is read as
 * undated rather than borrowed from another section.
 */
export function changelogDate(changelog, version) {
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\]\\s*-\\s*(\\d{4}-\\d{2}-\\d{2})`, "mu");
  const match = heading.exec(changelog);
  return match?.[1] ?? null;
}

/** True when this is a calendar date the tag may carry. */
export function isDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

/** Today in UTC, the shape a tag needs. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Why a changelog date cannot become a tag, or null when it can.
 *
 * The heading is the only source of the aggregate date, so a typo such as
 * `2026-02-31` would otherwise become an equally invalid `suite-2026.02.31` tag.
 */
export function changelogDateProblem(changelog, version) {
  const date = changelogDate(changelog, version);
  if (date === null || isDate(date)) return null;
  return (
    `${changelog} dates ${version} as '${date}', which is not a real calendar date. ` +
    "Fix the heading before it becomes an invalid suite-YYYY.MM.DD tag."
  );
}

/**
 * The date the aggregate release carries.
 *
 * The newest app date, not the wall clock: a rolling release is a snapshot of
 * the apps, so a day when nothing shipped does not need a new tag and a re-run
 * produces the same page. `--date` overrides it for a deliberate backfill.
 */
export function aggregateDate(entries, override = null) {
  if (override !== null) {
    if (!isDate(override)) {
      throw new Error(
        `--date needs a real YYYY-MM-DD calendar date, not ${JSON.stringify(override)}`,
      );
    }
    return override;
  }
  const dates = entries.map((entry) => entry.date).filter((date) => date !== null);
  if (dates.length === 0) return today();
  return dates.reduce((newest, date) => (date > newest ? date : newest));
}

/** The one instruction a refused relay release always gives. */
const RELAY_PUBLISH_SENTENCE =
  "The relay's tarball and signature are published by `node scripts/release.mjs sync --publish`; " +
  "run that first, then this edits its body.";

/** True for an asset that makes a relay release installable or verifiable. */
export function isRelayAsset(name) {
  return /\.(?:tar|tar\.(?:gz|xz|zst)|tgz)$/iu.test(name) || /^SHA256SUMS$/u.test(name);
}

/**
 * Why an existing relay release may not be edited, or null when it may.
 *
 * The release must already carry its tarball or checksums: an existing
 * `sync-v<version>` with only a body would keep looking installable while
 * `scripts/release.mjs sync --publish` has never put the bytes there. An
 * unreadable asset list is refused too, because the guard cannot verify it.
 */
export function relayAssetProblem(tag, assets) {
  if (!Array.isArray(assets)) {
    return (
      `could not read the assets of ${tag}, so it is unknown whether its tarball and checksums ` +
      `are there. ${RELAY_PUBLISH_SENTENCE}`
    );
  }
  const names = assets.map((asset) => asset?.name ?? "");
  if (names.some(isRelayAsset)) return null;
  return `the GitHub release ${tag} carries no tarball or checksum asset. ${RELAY_PUBLISH_SENTENCE}`;
}

/**
 * What a publish may do with one release, or why it must not.
 *
 * A desktop app may be created: its Flatpak is already on the signed remote.
 * The relay may not: its tarball and signature belong to
 * `scripts/release.mjs sync --publish`, and an assetless `sync-v<version>`
 * release would look installable while carrying nothing. Its body is edited in
 * place, so the assets stay; `assets` is read before this decides.
 */
export function releaseAction({ app, tag, exists, assets }) {
  if (exists) {
    if (app.flatpakId !== null) return { action: "edit", problem: null };
    const problem = relayAssetProblem(tag, assets);
    return problem === null
      ? { action: "edit", problem: null }
      : { action: null, problem };
  }
  if (app.flatpakId === null) {
    return {
      action: null,
      problem: `no GitHub release exists for ${tag}. ${RELAY_PUBLISH_SENTENCE}`,
    };
  }
  return { action: "create", problem: null };
}

/** Why an unknown origin tag state blocks a decision, or null when it is known. */
export function remoteLookupProblem(tag) {
  return (
    "could not read tags from origin (`git ls-remote` failed), so it is unknown whether " +
    `${tag} exists. Refusing rather than creating a tag or a release over one.`
  );
}

/**
 * Where a tag may be created, and what it points at.
 *
 * The rules are the point: an existing remote tag is authoritative and is never
 * moved, an existing local tag is used as-is, and a missing tag is created at
 * the commit that added the changelog section. A missing commit refuses instead
 * of tagging HEAD, which would publish a note at a tree that never had it.
 */
export function planTag({ tag, version, changelog, localCommit, remoteCommit, changelogCommit }) {
  if (localCommit !== null && remoteCommit !== null && localCommit !== remoteCommit) {
    return {
      tag,
      commit: null,
      createLocal: false,
      problem:
        `origin's ${tag} is ${remoteCommit.slice(0, 12)} but the local tag is ` +
        `${localCommit.slice(0, 12)}; refusing to move either. Delete one deliberately first.`,
    };
  }

  if (remoteCommit !== null) {
    return { tag, commit: remoteCommit, createLocal: localCommit === null, problem: null };
  }
  if (localCommit !== null) {
    return { tag, commit: localCommit, createLocal: false, problem: null };
  }
  if (changelogCommit !== null) {
    return { tag, commit: changelogCommit, createLocal: true, problem: null };
  }

  return {
    tag,
    commit: null,
    createLocal: false,
    problem:
      `no ${tag} exists and no commit adds '## [${version}]' to ${changelog}. ` +
      "Tagging HEAD would publish a release note at a tree that never had it, so this refuses.",
  };
}

/**
 * What a per-app tag-plan problem means in this mode.
 *
 * A page refresh writes a table and needs no tag, so the row is marked
 * **pending** and the page is still written. `--publish` and the dry run print
 * commands that would create a tag and a release, so they need a complete plan
 * and refuse.
 */
export function tagPlanDisposition(problem, mode) {
  if (problem === null) return { problem: null, pending: false };
  if (mode === "write") return { problem: null, pending: true };
  return { problem, pending: false };
}

/**
 * The shared table rows, used by the aggregate body and by RELEASES.md.
 *
 * The release body is written by `--publish`, after every per-app release
 * exists, so it always links. The page may be written before publication, so
 * with `markPending` it says a row is pending rather than linking a 404. An
 * entry marked `pending` by a guard is pending in either row.
 */
export function aggregateRows(entries, { markPending = false } = {}) {
  return entries.map((entry) => {
    const { app, version, date, tag } = entry;
    const released = date ?? "—";
    const pending = entry.pending === true || (markPending && entry.published !== true);
    const release = pending ? `\`${tag}\` (pending)` : `[\`${tag}\`](${releaseUrl(tag)})`;
    return (
      `| [${app.name}](${blobUrl(app.changelog)}) | ${version} | ${released} | ` +
      `${release} | ${installCell(app)} |`
    );
  });
}

/** The header every generated table carries. */
export const AGGREGATE_TABLE_HEADER = [
  "| App | Version | Released | Release | Install |",
  "| --- | --- | --- | --- | --- |",
];

/** True when the relay's release is refused or not published yet. */
function relayPending(entries) {
  const relay = entries.find((entry) => entry.app.flatpakId === null) ?? null;
  return relay !== null && relay.pending === true;
}

/**
 * The aggregate release body: every current version, one install path.
 *
 * The versions are the table's purpose and appear once each. The prose does not
 * repeat one; the release title says which day this snapshot is.
 */
export function aggregateReleaseBody(entries, { date }) {
  const relay = relayPending(entries)
    ? [
        "The Suite Sync relay release is pending; its tarball and `SHA256SUMS` are published by",
        "`node scripts/release.mjs sync --publish`, and this release links it once they are.",
        "",
      ]
    : [
        "Suite Sync is a server tarball, not a Flatpak. It is installed and verified by hand from",
        `[its guide](${blobUrl("apps/sync/docs/how-to/relay.md")}).`,
        "",
      ];

  return [
    `The current version of every Suite app on ${date}, in one place. GitHub shows one`,
    "\"Latest\" release per repository, so this is it; the per-app releases are history.",
    "",
    ...AGGREGATE_TABLE_HEADER,
    ...aggregateRows(entries),
    "",
    "## Update",
    "",
    "The signed Flatpak remote is the update path. Add it once, then update:",
    "",
    "```sh",
    `flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ${flatpakrepoUrl()}`,
    "flatpak update --user",
    "```",
    "",
    `Remote: [${REMOTE_NAME}.flatpakrepo](${flatpakrepoUrl()})`,
    "",
    ...relay,
  ].join("\n");
}

/**
 * One app's release body: its changelog section, then how to install it.
 *
 * No version is restated outside the title `gh` sets; the section is the note.
 */
export function appReleaseBody(app, section) {
  const lines = [section.trim(), "", "## Install", ""];

  if (app.flatpakId === null) {
    lines.push(
      "Suite Sync is a server tarball, not a Flatpak. This release carries the tarball and its",
      "signed `SHA256SUMS`; the host needs Node.js 22 or later, and the person replaces the tree",
      "deliberately. There is no remote and no automatic update.",
      "",
      "```sh",
      "sha256sum -c SHA256SUMS",
      "```",
      "",
      `Read [Leave a relay running](${blobUrl("apps/sync/docs/how-to/relay.md")}) before exposing it.`,
      "",
    );
  } else {
    lines.push(
      "The signed Flatpak remote is the update path. This release carries no app binaries.",
      "",
      "```sh",
      `flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ${flatpakrepoUrl()}`,
      installCommand(app),
      "flatpak update --user",
      "```",
      "",
      `Remote: [${REMOTE_NAME}.flatpakrepo](${flatpakrepoUrl()})`,
      "",
      "Flatpak owns the deployment; this section is the release note.",
      "",
    );
  }

  return lines.join("\n");
}

/**
 * `RELEASES.md`: the same data, as the human mirror of the Latest release.
 *
 * The generated comment is deliberate. A version belongs in `package.json`; this
 * file restates it because it is a mirror, and a mirror that is typed by hand
 * drifts.
 *
 * The page can be written before publication, so a row that has no release yet
 * says **pending** instead of linking a page that does not exist. `--publish`
 * rewrites the page with real links once the releases are created.
 */
export function releasesPage(entries, { date, tag, aggregatePublished = false }) {
  const latest = aggregatePublished
    ? [
        "The signed Flatpak remote is the update path. This page is the human mirror of the",
        `[aggregate Suite ${date} release](${releaseUrl(tag)}), which is the repository's`,
        "\"Latest\" release on GitHub. The per-app releases below stay as history and carry no app",
        "binaries.",
      ]
    : [
        "The signed Flatpak remote is the update path. This page is the human mirror of the",
        `rolling Suite ${date} release, which is not published yet. A row marked **pending**`,
        "has no release to link until `--publish` creates it and refreshes this page; the",
        "per-app releases below stay as history and carry no app binaries.",
      ];

  const relay = relayPending(entries)
    ? [
        "The Suite Sync relay release is pending; `node scripts/release.mjs sync --publish`",
        "publishes its tarball and checksums, and this page links it after that.",
      ]
    : [
        "Suite Sync is a server tarball, not a Flatpak; install and verify it from its own release.",
      ];

  return [
    "# Suite releases",
    "",
    "<!-- Generated by `scripts/release-status.mjs` from each app's `package.json` and the date",
    "     in its changelog. Do not edit the table; edit those files and regenerate. -->",
    "",
    ...latest,
    "",
    ...AGGREGATE_TABLE_HEADER,
    ...aggregateRows(entries, { markPending: true }),
    "",
    "## Update",
    "",
    "```sh",
    `flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ${flatpakrepoUrl()}`,
    "flatpak update --user",
    "```",
    "",
    `Remote: [${REMOTE_NAME}.flatpakrepo](${flatpakrepoUrl()})`,
    "",
    ...relay,
    "GitHub Packages is not used for the Flatpaks.",
    "",
    "## Regenerate",
    "",
    "```sh",
    "mise exec -- node scripts/release-status.mjs --write",
    "mise exec -- node scripts/release-status.mjs --publish",
    "```",
    "",
  ].join("\n");
}

/** Parse the command line; a dry run is the default and one mode at a time. */
export function parseArgs(argv) {
  const options = { publish: false, dryRun: false, write: false, date: null, help: false };

  function takeValue(index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    return value;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--publish") options.publish = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--write") options.write = true;
    else if (arg === "--date") {
      options.date = takeValue(index, "--date");
      index += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown option ${arg}`);
    } else {
      throw new Error(`unexpected argument ${arg}`);
    }
  }

  const modes = [
    options.publish ? "--publish" : null,
    options.write ? "--write" : null,
    options.dryRun ? "--dry-run" : null,
  ].filter((mode) => mode !== null);
  if (modes.length > 1) {
    throw new Error(`${modes.join(" and ")} pick different modes; pass at most one`);
  }

  return options;
}

function quote(value) {
  return /^[A-Za-z0-9_./:=@-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`;
}

function commandText(command, args) {
  return [command, ...args.map(quote)].join(" ");
}

function run(command, args) {
  process.stdout.write(`\n$ ${commandText(command, args)}\n`);
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function git(args) {
  return spawnSync("git", args, { cwd: ROOT, encoding: "utf8", env: process.env });
}

function read(path) {
  return readFileSync(join(ROOT, path), "utf8");
}

function localTagCommit(tag) {
  const result = git(["rev-parse", "-q", "--verify", `refs/tags/${tag}`]);
  return result.status === 0 ? result.stdout.trim() : null;
}

/** The remote tag's commit, `{ known: false }` when the network read failed. */
function remoteTagCommit(tag) {
  const result = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (result.status !== 0) return { known: false, commit: null };
  const line = result.stdout.trim().split(/\r?\n/u)[0] ?? "";
  const [commit] = line.split(/\s+/u);
  return { known: true, commit: commit === undefined || commit.length === 0 ? null : commit };
}

/** The commit that added `## [version]` to this changelog, or null. */
function changelogCommit(app, version) {
  const result = git(["log", "-1", "--format=%H", `-S## [${version}]`, "--", app.changelog]);
  if (result.status !== 0) return null;
  const commit = result.stdout.trim();
  return commit.length === 0 ? null : commit;
}

/** Every release that already exists, by tag, or null when the read failed. */
function existingReleases() {
  const result = spawnSync(
    "gh",
    ["release", "list", "--limit", "200", "--json", "tagName,isLatest"],
    { cwd: ROOT, encoding: "utf8", env: process.env },
  );
  if (result.error || result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** The assets on an existing release, or null when the read failed. */
function releaseAssets(tag) {
  const result = spawnSync("gh", ["release", "view", tag, "--json", "assets"], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error || result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed.assets) ? parsed.assets : null;
  } catch {
    return null;
  }
}

function currentHead() {
  const result = git(["rev-parse", "HEAD"]);
  if (result.status !== 0) throw new Error("could not read HEAD");
  return result.stdout.trim();
}

/**
 * Read the versions, sections and dates, and decide every tag.
 *
 * Everything that can refuse the run is collected before a single command is
 * printed, so a dry run shows the whole picture or names every reason it stops.
 * `mode` is `"write"` for a page refresh, which needs no tag decision, so an
 * offline origin lookup or a missing changelog commit marks that row pending
 * instead of blocking the page.
 */
function collect({ mode = "dry-run" } = {}) {
  const strictTags = mode !== "write";
  const problems = [];
  const entries = [];

  for (const app of APPS) {
    let version = null;
    let changelog;
    try {
      version = versionFromPackage(read(app.packageJson));
      changelog = read(app.changelog);
    } catch (error) {
      problems.push(`${app.name}: ${error.message}`);
      continue;
    }

    if (version === null) {
      problems.push(`${app.packageJson} names no version`);
      continue;
    }

    const section = changelogSection(changelog, version);
    if (section === null) {
      problems.push(
        `${app.name} ${version} has no '## [${version}]' heading in ${app.changelog}. ` +
          "A release note is what the tag promises, so it has to exist before the tag.",
      );
      continue;
    }
    if (section.length === 0) {
      problems.push(`${app.name} ${version} has an empty changelog section in ${app.changelog}`);
      continue;
    }

    const dateProblem = changelogDateProblem(changelog, version);
    if (dateProblem !== null) {
      problems.push(`${app.name}: ${dateProblem}`);
      continue;
    }

    const tag = tagFor(app, version);
    const localCommit = localTagCommit(tag);
    const remote = remoteTagCommit(tag);
    if (strictTags && !remote.known) problems.push(`${tag}: ${remoteLookupProblem(tag)}`);
    const plan = planTag({
      tag,
      version,
      changelog: app.changelog,
      localCommit,
      remoteCommit: remote.known ? remote.commit : null,
      changelogCommit: localCommit === null && remote.commit === null
        ? changelogCommit(app, version)
        : null,
    });
    const disposition = tagPlanDisposition(plan.problem, mode);
    if (disposition.problem !== null) problems.push(disposition.problem);

    entries.push({
      app,
      version,
      date: changelogDate(changelog, version),
      section,
      tag,
      plan,
      localCommit,
      remoteKnown: remote.known,
      remoteCommit: remote.commit,
      pending: disposition.pending,
      published: false,
    });
  }

  return { problems, entries };
}

function tagStatus(item, backfill) {
  if (item.plan.problem !== null) return `REFUSED: ${item.plan.problem}`;
  if (item.localCommit !== null && item.remoteKnown && item.remoteCommit !== null) {
    return `exists as ${item.plan.commit.slice(0, 12)}`;
  }
  if (item.localCommit !== null) return `exists locally as ${item.plan.commit.slice(0, 12)}`;
  if (item.remoteKnown && item.remoteCommit !== null) {
    return `exists on origin as ${item.plan.commit.slice(0, 12)}`;
  }
  if (!item.remoteKnown) return "unknown: origin tag lookup failed";
  return backfill(item.plan.commit);
}

function summarize(entry, releases) {
  const release = releases?.find((row) => row.tagName === entry.tag) ?? null;
  let releaseLine = "unknown (gh release list failed)";
  if (releases !== null) {
    releaseLine =
      entry.actionProblem === null || entry.actionProblem === undefined
        ? `${entry.action}${release?.isLatest === true ? " (currently Latest)" : ""}`
        : `REFUSED: ${entry.actionProblem}`;
  }
  const lines = [`${entry.app.name} ${entry.version} · ${entry.tag} · ${entry.date ?? "undated"}`];
  lines.push(`  release    ${releaseLine}`);
  lines.push(
    `  tag        ${tagStatus(
      entry,
      (commit) =>
        `backfill ${commit.slice(0, 12)} — the commit that added ` +
        `'## [${entry.version}]' to ${entry.app.changelog}`,
    )}`,
  );
  return lines.join("\n");
}

/** Where the aggregate tag may be created: the snapshot HEAD describes. */
function planAggregate(tag, head) {
  const localCommit = localTagCommit(tag);
  const remote = remoteTagCommit(tag);
  const plan = remote.known
    ? planTag({
        tag,
        version: tag,
        changelog: "HEAD",
        localCommit,
        remoteCommit: remote.commit,
        changelogCommit: head,
      })
    : { tag, commit: null, createLocal: false, problem: `${tag}: ${remoteLookupProblem(tag)}` };
  return {
    tag,
    plan,
    localCommit,
    remoteKnown: remote.known,
    remoteCommit: remote.commit,
  };
}

function releaseArgs({ tag, title, notesPath, latest, action, target }) {
  if (action === "edit") {
    return [
      "release",
      "edit",
      tag,
      "--title",
      title,
      "--notes-file",
      notesPath,
      latest ? "--latest" : "--latest=false",
    ];
  }
  return [
    "release",
    "create",
    tag,
    "--title",
    title,
    "--notes-file",
    notesPath,
    latest ? "--latest" : "--latest=false",
    "--target",
    target,
  ];
}

function mainPublish({ entries, aggregate, date, tag, releases, notes }) {
  if (releases === null) {
    throw new Error("gh release list failed; refusing to publish into a repository it cannot read");
  }

  mkdirSync(join(ROOT, NOTES_DIR), { recursive: true });
  for (const item of notes) writeFileSync(join(ROOT, item.path), item.body);

  for (const entry of entries) {
    if (entry.action === null) {
      throw new Error(entry.actionProblem ?? `${entry.tag} has no release action`);
    }
    if (entry.plan.createLocal) run("git", ["tag", entry.tag, entry.plan.commit]);
    run(
      "gh",
      releaseArgs({
        tag: entry.tag,
        title: `${entry.app.name} ${entry.version}`,
        notesPath: join(NOTES_DIR, `${entry.tag}.md`),
        latest: false,
        action: entry.action,
        target: entry.plan.commit,
      }),
    );
  }

  if (aggregate.plan.createLocal) run("git", ["tag", tag, aggregate.plan.commit]);
  const aggregateExisting = releases.find((row) => row.tagName === tag) ?? null;
  run(
    "gh",
    releaseArgs({
      tag,
      title: `Suite ${date}`,
      notesPath: join(NOTES_DIR, `${tag}.md`),
      latest: true,
      action: aggregateExisting === null ? "create" : "edit",
      target: aggregate.plan.commit,
    }),
  );

  // Everything named on the page now exists, so the refresh links instead of
  // saying "pending".
  for (const entry of entries) entry.published = true;
  writeFileSync(
    join(ROOT, RELEASES_FILE),
    releasesPage(entries, { date, tag, aggregatePublished: true }),
  );
  process.stdout.write(`\nwrote ${RELEASES_FILE}\n`);
  process.stdout.write(`Latest release: ${releaseUrl(tag)}\n`);
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exit(2);
  }

  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const mode = options.publish ? "publish" : options.write ? "write" : "dry-run";
  const releases = existingReleases();
  const { problems, entries } = collect({ mode });

  const knownReleases = releases ?? [];
  for (const entry of entries) {
    const exists = knownReleases.some((row) => row.tagName === entry.tag);
    entry.published = releases !== null && exists;
    if (releases === null) {
      entry.action = entry.app.flatpakId === null ? "edit" : "create";
      entry.actionProblem = null;
      continue;
    }
    // The relay's body is edited in place, so its assets are what make the
    // release real; read them before deciding that "edit" is safe.
    const assets =
      exists && entry.app.flatpakId === null ? releaseAssets(entry.tag) : undefined;
    const action = releaseAction({ app: entry.app, tag: entry.tag, exists, assets });
    entry.action = action.action;
    entry.actionProblem = action.problem;
    if (action.problem !== null) {
      entry.pending = true;
      if (mode !== "write") problems.push(action.problem);
    }
  }

  if (problems.length > 0) throw new Error(problems.join("\n\n"));

  const head = currentHead();
  const date = aggregateDate(entries, options.date);
  const tag = aggregateTag(date);
  const aggregate = planAggregate(tag, head);
  if (aggregate.plan.problem !== null && !options.write) throw new Error(aggregate.plan.problem);

  const body = aggregateReleaseBody(entries, { date });
  const aggregatePublished = releases !== null && knownReleases.some((row) => row.tagName === tag);
  const page = releasesPage(entries, { date, tag, aggregatePublished });
  const notes = [
    ...entries.map((entry) => ({
      path: join(NOTES_DIR, `${entry.tag}.md`),
      body: appReleaseBody(entry.app, entry.section),
    })),
    { path: join(NOTES_DIR, `${tag}.md`), body },
  ];

  process.stdout.write(
    `\nSuite releases · ${mode === "dry-run" ? "dry run" : mode}\n`,
  );
  if (releases === null) {
    process.stdout.write(
      "\ncould not read the existing releases (gh release list failed); " +
        "this run assumes there are none and cannot publish.\n",
    );
  } else {
    const latest = releases.find((row) => row.isLatest);
    process.stdout.write(
      `\nLatest on GitHub now: ${latest === undefined ? "none" : latest.tagName} → ` +
        `${tag} after this run\n`,
    );
  }

  for (const entry of entries) process.stdout.write(`\n${summarize(entry, releases)}\n`);

  const aggregateExisting = knownReleases.find((row) => row.tagName === tag) ?? null;
  process.stdout.write(
    `\nSuite ${date} · ${tag} · aggregate\n` +
      `  release    ${
        releases === null
          ? "unknown (gh release list failed)"
          : aggregateExisting === null
            ? "create (Latest)"
            : "edit (Latest)"
      }\n` +
      `  tag        ${tagStatus(aggregate, (commit) => `backfill ${commit.slice(0, 12)} — HEAD, the snapshot this page describes`)}\n`,
  );

  if (options.publish) {
    mainPublish({ entries, aggregate, date, tag, releases, notes });
    return;
  }

  if (options.write) {
    writeFileSync(join(ROOT, RELEASES_FILE), page);
    process.stdout.write(`\nwrote ${RELEASES_FILE}\n`);
    return;
  }

  for (const entry of entries) {
    if (entry.plan.createLocal) {
      process.stdout.write(
        `\n  $ ${commandText("git", ["tag", entry.tag, entry.plan.commit])}`,
      );
    }
    process.stdout.write(
      `\n  $ ${commandText(
        "gh",
        releaseArgs({
          tag: entry.tag,
          title: `${entry.app.name} ${entry.version}`,
          notesPath: join(NOTES_DIR, `${entry.tag}.md`),
          latest: false,
          action: entry.action ?? "edit",
          target: entry.plan.commit,
        }),
      )}\n`,
    );
  }

  if (aggregate.plan.createLocal) {
    process.stdout.write(`\n  $ ${commandText("git", ["tag", tag, aggregate.plan.commit])}`);
  }
  process.stdout.write(
    `\n  $ ${commandText(
      "gh",
      releaseArgs({
        tag,
        title: `Suite ${date}`,
        notesPath: join(NOTES_DIR, `${tag}.md`),
        latest: true,
        action: aggregateExisting === null ? "create" : "edit",
        target: aggregate.plan.commit,
      }),
    )}\n`,
  );

  for (const entry of entries) {
    process.stdout.write(`\n--- ${entry.app.name} ${entry.version} · body ---\n\n`);
    process.stdout.write(appReleaseBody(entry.app, entry.section));
  }

  process.stdout.write(`\n--- ${tag} · body ---\n\n`);
  process.stdout.write(body);
  process.stdout.write(
    `\n--- ${RELEASES_FILE} ---\n\n` +
      "would be written from the same table, with the generated header and a regenerate block.\n",
  );
  process.stdout.write(
    "\ndry run: nothing was tagged, published or written; the bodies above are what would be used.\n" +
      "To publish: mise exec -- node scripts/release-status.mjs --publish\n" +
      "To refresh the page only: mise exec -- node scripts/release-status.mjs --write\n",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`\n${error.message}\n`);
    process.exit(1);
  }
}
