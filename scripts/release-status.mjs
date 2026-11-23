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
 *   that app's own release and how it is installed: a Flatpak command, or the
 *   release-signed Suite Go APK attached to this same release. Each row also names
 *   the release channel and product maturity; channels belong to the superapp
 *   (Suite Shell and Suite Go), and the legacy mini-apps are marked frozen.
 * - **One release per app**, tagged `<app>-v<version>`, kept as history and
 *   never marked Latest. It carries the changelog section and an install block;
 *   it carries no app binaries, because the signed Flatpak remote is the update
 *   path.
 *
 * The version has one home: the app's `package.json`. The date has one home:
 * the `## [version] - YYYY-MM-DD` heading in its changelog. This script reads
 * both, refuses a version without a matching section, and writes nothing to
 * GitHub by default.
 *
 * Publication is two phases, because published releases are immutable (D6.3):
 * the tag, every asset and the body lock when the release is published.
 *
 * 1. `--draft` creates or updates every per-app release and the rolling release
 *    as a draft, with its body and tag plan. Assets are attached while the
 *    release is still a draft. Rerunning it updates the same drafts and writes
 *    no page.
 * 2. `--publish` refreshes each draft body from the assets it now carries,
 *    publishes the drafts with `gh release edit --draft=false`, then writes
 *    `RELEASES.md` with real links. A release that is already published is
 *    never edited: it is skipped with a message and the page is rewritten from
 *    the current state. A version with no draft is refused.
 *
 * Backfilling a tag is deliberate: a missing tag is created at the commit that
 * added the changelog section (`git log -S`), never at HEAD, and an existing tag
 * is never moved. When that commit cannot be found the run refuses.
 *
 * Usage:
 *   node scripts/release-status.mjs            # dry run: commands and bodies
 *   node scripts/release-status.mjs --draft    # create or update the draft releases
 *   node scripts/release-status.mjs --publish  # publish the drafts, then write RELEASES.md
 *   node scripts/release-status.mjs --write    # refresh RELEASES.md only
 *   node scripts/release-status.mjs --date 2026-11-21 --draft
 *   node scripts/release-status.mjs --help
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { changelogSection, versionFromPackage } from "./release.mjs";
import { CHANNELS, channelProblem } from "./lib/channel.mjs";
import {
  DEFAULT_PUBLIC_URL,
  REMOTE_NAME,
  flatpakrepoUrl as remoteFlatpakrepoUrl,
} from "./lib/flatpakRemote.mjs";

/** The repository this page and these releases belong to. */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const RELEASE_REPO = "mrrnbhd/suite-apps";

/** The Flatpak remote a person adds before installing; the signed update path. */
export { REMOTE_NAME };
export const REMOTE_URL = DEFAULT_PUBLIC_URL;

/** The generated human mirror of the Latest release, committed at the root. */
export const RELEASES_FILE = "RELEASES.md";

/** Where a publish writes each release body before handing it to `gh`. */
export const NOTES_DIR = ".dev/releases";

/** The product-maturity labels, separate from the release channels. */
export const PRODUCT_MATURITY = ["pre-alpha", "alpha", "beta", "1.0"];

/**
 * The apps frozen as legacy until they become packs.
 *
 * The list lives in the channel library so the Flatpak builder refuses a new
 * pre-release build for the same apps this table marks frozen. Start and Sync
 * are not frozen: they are not superapps either, so their rows name no channel.
 */
export { LEGACY_FROZEN_IDS } from "./lib/channel.mjs";

/**
 * Every app a table names. Each section keeps this order.
 *
 * `kind` says where the installed bytes come from, and `installCell` is the one
 * place that turns it into a cell:
 *
 * - `flatpak` — a signed deployment on the OSTree remote, including the relay.
 * - `apk` — a release-signed APK attached to the rolling suite release.
 *
 * `section` is the table a row belongs to: `desktop` or `mobile`. The table is
 * rendered by `aggregateSection`, which takes a title and the entries to render,
 * so a section is only a title plus its rows and the shape can be reused by a
 * page that splits the same data differently.
 *
 * `channel` names the release channel of a superapp row: Suite Shell and Suite
 * Go. It is absent on apps that are not superapps. `maturity` is the product
 * label and is independent of the channel, so a `stable` build may be `alpha`.
 * `frozen` marks a legacy app that keeps its code and last artifact but gets no
 * new release or channel.
 *
 * `flatpakId` is null outside the Flatpak rows.
 */
export const APPS = [
  {
    id: "shell",
    name: "Suite Shell",
    packageJson: "apps/shell/package.json",
    changelog: "apps/shell/CHANGELOG.md",
    tagPrefix: "shell-v",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.shell",
    channel: "stable",
    maturity: "alpha",
  },
  {
    id: "start",
    name: "Suite Start",
    packageJson: "apps/start/package.json",
    changelog: "apps/start/CHANGELOG.md",
    tagPrefix: "start-v",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.start",
  },
  {
    id: "go",
    name: "Suite Go",
    packageJson: "apps/go/package.json",
    changelog: "apps/go/CHANGELOG.md",
    tagPrefix: "go-v",
    kind: "apk",
    section: "mobile",
    flatpakId: null,
    channel: "stable",
    maturity: "pre-alpha",
  },
  {
    id: "canvas",
    name: "Suite Canvas",
    packageJson: "apps/canvas/desktop/package.json",
    changelog: "apps/canvas/CHANGELOG.md",
    tagPrefix: "canvas-v",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.canvas",
    maturity: "alpha",
    frozen: true,
  },
  {
    id: "planner",
    name: "Suite Planner",
    packageJson: "apps/planner/package.json",
    changelog: "apps/planner/CHANGELOG.md",
    tagPrefix: "planner-v",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.planner",
    maturity: "pre-alpha",
    frozen: true,
  },
  {
    id: "budget",
    name: "Suite Budget",
    packageJson: "apps/budget/package.json",
    changelog: "apps/budget/CHANGELOG.md",
    tagPrefix: "budget-v",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.budget",
    maturity: "pre-alpha",
    frozen: true,
  },
  {
    id: "sync",
    name: "Suite Sync",
    packageJson: "apps/sync/package.json",
    changelog: "apps/sync/CHANGELOG.md",
    tagPrefix: "sync-v",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.sync",
  },
  {
    id: "help",
    name: "Suite Help",
    packageJson: "apps/help/package.json",
    changelog: "apps/help/CHANGELOG.md",
    tagPrefix: "help-v",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.help",
    frozen: true,
  },
];

const USAGE = `usage: node scripts/release-status.mjs [options]

  --dry-run            print every command and body; the default
  --draft              create or update the releases as drafts
  --publish            publish the existing drafts, then write ${RELEASES_FILE}
  --write              write ${RELEASES_FILE} and stop short of GitHub
  --date <YYYY-MM-DD>  date for the aggregate tag (default: the newest app release)
  --channel <name>     stable (default), slop, nightly or preview; names the APK asset
  --help               print this text

Pass one of --draft, --publish, --write and --dry-run.

A release is created as a draft, its assets are attached while it is a draft, and
--publish flips it. A published release is immutable and is never edited.

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

/**
 * The aggregate tag the current tree is released under.
 *
 * The APK is attached to the rolling release, so `android-release.mjs` has to
 * name the same tag `--publish` picks: the newest changelog date, not the wall
 * clock. `load` is injectable so a test needs no tree.
 */
export function currentAggregateTag({ load = read } = {}) {
  const entries = [];
  for (const app of APPS) {
    try {
      const version = versionFromPackage(load(app.packageJson));
      const date = version === null ? null : changelogDate(load(app.changelog), version);
      entries.push({ date });
    } catch {
      // An app whose files cannot be read cannot change the newest date.
    }
  }
  return aggregateTag(aggregateDate(entries));
}

/** A release's page on GitHub. */
export function releaseUrl(tag) {
  return `https://github.com/${RELEASE_REPO}/releases/tag/${tag}`;
}

/** The repository's Latest release, which is the rolling Suite snapshot. */
export function latestReleaseUrl() {
  return `https://github.com/${RELEASE_REPO}/releases/latest`;
}

/** One asset's download URL on a release. */
export function releaseAssetUrl(tag, name) {
  return `https://github.com/${RELEASE_REPO}/releases/download/${tag}/${name}`;
}

/** A file in the repository, for a link inside a release body. */
export function blobUrl(path) {
  return `https://github.com/${RELEASE_REPO}/blob/main/${path}`;
}

/** The `.flatpakrepo` a client adds; it embeds the store's public key. */
export function flatpakrepoUrl() {
  return remoteFlatpakrepoUrl(REMOTE_URL);
}

/** The install command for a Flatpak app, or null for anything else. */
export function installCommand(app) {
  return app.kind !== "flatpak"
    ? null
    : `flatpak install --user ${REMOTE_NAME} ${app.flatpakId}`;
}

/** The APK a Suite Go version attaches to the rolling release. */
export function goApkName(version, channel = "stable") {
  return channel === "stable" ? `suite-go-${version}.apk` : `suite-go-${channel}-${version}.apk`;
}

/** The Go APK's download URL on the aggregate release. */
export function goApkUrl(tag, version, channel = "stable") {
  return releaseAssetUrl(tag, goApkName(version, channel));
}

/**
 * The table cell that says how one row is installed.
 *
 * One cell per row, whatever the artifact. `apkLive` is whether the release
 * already carries the APK; until it does the cell names the file instead of
 * linking a download that would 404. `draft` says that cell is written into a
 * release that is still a draft, where the APK is attached before publication,
 * so the wording does not read as a promise the run cannot keep.
 */
export function installCell(
  app,
  { version = null, tag = null, apkLive = false, draft = false, channel = "stable" } = {},
) {
  if (app.kind === "flatpak") return `\`${installCommand(app)}\``;
  if (app.kind === "apk") {
    const name = version === null ? "suite-go.apk" : goApkName(version, channel);
    if (apkLive && tag !== null && version !== null) {
      return `[${name}](${goApkUrl(tag, version, channel)})`;
    }
    if (draft) return `\`${name}\` (attached to this draft before publication)`;
    return `\`${name}\` (not uploaded yet)`;
  }
  throw new Error(`no install cell for kind ${String(app.kind)}`);
}

/**
 * The channel a row names: a superapp's channel, `frozen` for legacy, or none.
 *
 * A legacy app is not on a channel any more, so saying `frozen` in the channel
 * cell is honest: its code and last artifact stay, but no new build is offered.
 */
export function channelLabel(app) {
  if (app.frozen === true) return "frozen";
  return app.channel ?? "—";
}

/** The product-maturity label, or an em dash when none is recorded. */
export function maturityLabel(app) {
  return app.maturity ?? "—";
}

/** True when this app's releases are frozen until it becomes a pack. */
export function isLegacyFrozen(app) {
  return app.frozen === true;
}

/**
 * The two labels every generated release note carries.
 *
 * Channel and maturity answer different questions: the channel is what a build
 * has survived, the maturity is what the product is ready for. A `stable`
 * channel build can still be `alpha`.
 */
export function releaseLabels(app) {
  return [
    `- **Channel:** ${channelLabel(app)}`,
    `- **Maturity:** ${maturityLabel(app)}`,
  ];
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

/**
 * The message for a release GitHub has already published.
 *
 * Immutable releases lock the tag, every asset and the body at publication
 * (D6.3), so no later run may edit one. The action is a skip: a repository
 * ships several apps from one tag namespace, so the unchanged apps are already
 * published on every normal release day, and one of them must not block the
 * others. The release is left exactly as GitHub has it.
 */
export function publishedReleaseMessage(tag) {
  return (
    `${tag} is already published, and published releases are immutable: this run refuses ` +
    "to edit its tag, assets or body, and leaves it unchanged."
  );
}

/**
 * What the draft phase may do with one release, or why it must not.
 *
 * A draft is mutable, so rerunning `--draft` edits the same release and stays
 * idempotent. A published release cannot be turned back into a draft, so it is
 * skipped: a version that is already out has nothing left to draft.
 */
export function draftAction({ exists, isDraft, tag }) {
  if (!exists) return { action: "create", problem: null };
  if (isDraft === true) return { action: "edit", problem: null };
  return { action: "skip", problem: publishedReleaseMessage(tag) };
}

/**
 * What the publish phase may do with one release, or why it must not.
 *
 * `--publish` only flips drafts. A missing release is a refusal, because the
 * draft phase was skipped; a published one is skipped, because it is already
 * public and immutable.
 */
export function publishAction({ exists, isDraft, tag }) {
  if (!exists) {
    return {
      action: "refuse",
      problem:
        `${tag} has no draft release. Run \`node scripts/release-status.mjs --draft\` first, ` +
        "attach its assets while it is a draft, then publish.",
    };
  }
  if (isDraft === true) return { action: "publish", problem: null };
  return { action: "skip", problem: publishedReleaseMessage(tag) };
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
 *
 * `tag` and `apkLive` describe the aggregate release the APK lives on. The
 * subset passed in is the section being rendered, so callers can split desktop
 * and mobile rows without changing this shape. `draft` marks a body written
 * into a release that is still a draft.
 */
export function aggregateRows(
  entries,
  { markPending = false, tag = null, apkLive = false, draft = false, channel = "stable" } = {},
) {
  return entries.map((entry) => {
    const { app, version, date, tag: appTag } = entry;
    const released = date ?? "—";
    const pending = entry.pending === true || (markPending && entry.published !== true);
    const release = pending
      ? `\`${appTag}\` (pending)`
      : `[\`${appTag}\`](${releaseUrl(appTag)})`;
    const install = installCell(app, { version, tag, apkLive, draft, channel });
    return (
      `| [${app.name}](${blobUrl(app.changelog)}) | ${channelLabel(app)} | ` +
      `${maturityLabel(app)} | ${version} | ${released} | ${release} | ${install} |`
    );
  });
}

/** The header every generated table carries. */
export const AGGREGATE_TABLE_HEADER = [
  "| App | Channel | Maturity | Version | Released | Release | Install |",
  "| --- | --- | --- | --- | --- | --- | --- |",
];

/**
 * One complete table for the entries it is given.
 *
 * A single call renders one table. The parameters are the point: a section
 * renderer, a README or a page that splits the data differently can each call
 * this with its own entries, and none needs a second row implementation.
 */
export function aggregateTable(entries, options = {}) {
  return [...AGGREGATE_TABLE_HEADER, ...aggregateRows(entries, options)];
}

/** The rows one table section carries, in the order the entries arrived. */
export function entriesForSection(entries, sectionId) {
  return entries.filter((entry) => entry.app.section === sectionId);
}

/**
 * One table section: its title and its rows.
 *
 * A section is nothing but a title and the entries it renders. The release page
 * and `RELEASES.md` both build from this, and so can a page that groups the same
 * apps under different titles.
 */
export function aggregateSection(title, entries, options = {}) {
  return [`## ${title}`, "", ...aggregateTable(entries, options)];
}

/**
 * The paragraph that explains the Suite Go row.
 *
 * The APK lives on the rolling release, so whether it is there yet is a fact
 * about this release. Saying so in the body is what keeps the Install cell from
 * being a dead link that looks live. A draft says the APK is attached during the
 * same promotion: it is uploaded to the draft and the link is live once
 * `--publish` flips it, so the draft must not claim the asset already exists.
 */
function goInstallNote(entries, { tag = null, apkLive = false, draft = false, channel = "stable" }) {
  const go = entries.find((entry) => entry.app.kind === "apk") ?? null;
  if (go === null) return [];
  const name = goApkName(go.version, channel);
  if (apkLive && tag !== null) {
    return [
      `Suite Go is not a Flatpak. This release carries its release-signed APK, [${name}](${goApkUrl(tag, go.version, channel)}),`,
      "with a SHA-256 checksum beside it; sideload it with `adb install -r -t`.",
      "",
    ];
  }
  if (draft) {
    return [
      `Suite Go is not a Flatpak. Its release-signed APK, \`${name}\`, is uploaded to this draft`,
      "before publication, so this release carries it once `--publish` flips the draft; sideload it",
      "with `adb install -r -t` after downloading.",
      "",
    ];
  }
  return [
    `Suite Go is not a Flatpak. Its release-signed APK, \`${name}\`, is not attached to this release.`,
    "Attach it to the draft before publishing; after publication the assets are locked.",
    "",
  ];
}

/**
 * The aggregate release body: every current version, in two tables.
 *
 * The versions are the table's purpose and appear once each. The prose does not
 * repeat one; the release title says which day this snapshot is. The remote is
 * added before the tables, because every `flatpak install` cell needs it and a
 * reader who starts at a table would run a command that cannot work yet.
 */
export function aggregateReleaseBody(
  entries,
  { date, tag = null, apkLive = false, draft = false, channel = "stable" },
) {
  const desktop = entriesForSection(entries, "desktop");
  const otherDesktop = desktop.filter((entry) => entry.app.id !== "shell");
  const shell = entries.find((entry) => entry.app.id === "shell") ?? null;
  const go = entries.find((entry) => entry.app.id === "go") ?? null;
  return [
    `**Suite Shell** is the desktop superapp; **Suite Go** is the mobile superapp. This is the ${date} build` +
      (channel === "stable" ? "." : `, published on the **${channel}** channel.`),
    "The split apps remain on the same signed remote, below; the legacy ones are frozen.",
    "",
    "## Suite Shell (desktop)",
    "",
    ...(shell === null ? [] : [...releaseLabels(shell.app), ""]),
    "```sh",
    `flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ${flatpakrepoUrl()}`,
    "flatpak install --user suite run.suite.shell",
    "flatpak run run.suite.shell",
    "```",
    "",
    `Remote: [${REMOTE_NAME}.flatpakrepo](${flatpakrepoUrl()})`,
    "",
    "## Suite Go (mobile)",
    "",
    ...(go === null ? [] : [...releaseLabels(go.app), ""]),
    ...goInstallNote(entries, { tag, apkLive, draft, channel }),
    "## Also on the remote",
    "",
    ...aggregateTable(otherDesktop, { tag, apkLive, draft, channel }),
    "",
    "`frozen` marks a legacy app: its code and last artifact stay, and it gets no new",
    "pre-release channel until it becomes a pack.",
    "",
    "## Update",
    "",
    "Once the remote is added, the desktop apps update with:",
    "",
    "```sh",
    "flatpak update --user",
    "```",
    "",
  ].join("\n");
}

/**
 * One app's release body: its changelog section, then how to install it.
 *
 * No version is restated outside the title `gh` sets; the section is the note.
 * The APK entry is the one that cannot assume its artifact: `apkLive` is read
 * from the rolling release's assets, and without it the body says where the
 * truth is rather than claiming an attachment that may not exist yet. `draft`
 * is the same fact one phase earlier: the release being written is a draft, and
 * `--publish` re-renders it from the assets it carries before flipping it.
 */
export function appReleaseBody(
  app,
  section,
  { tag = null, apkLive = false, draft = false, channel = "stable" } = {},
) {
  // The rolling release is the page a person should read; this one is the note
  // for a version. Say so first, so a direct link from the table does not look
  // like a second, competing install page.
  const lines = [
    `Current versions and the install table are on [the latest Suite release](${latestReleaseUrl()}).`,
    "This page is the release note for this app.",
    "",
    ...releaseLabels(app),
  ];
  if (isLegacyFrozen(app)) {
    lines.push(
      "- **State:** frozen until it becomes a pack; its code and last artifact stay, and it gets no new pre-release channel.",
    );
  }
  lines.push("", section.trim(), "", "## Install", "");

  if (app.kind === "apk") {
    const releaseLink = tag === null ? latestReleaseUrl() : releaseUrl(tag);
    lines.push(
      "Suite Go is a mobile app, not a Flatpak.",
      apkLive
        ? `This build's release-signed APK is attached to [the rolling Suite release](${releaseLink}).`
        : draft
          ? `This build's release-signed APK is uploaded to [the rolling Suite release](${releaseLink}) ` +
            "while that release is a draft, so the download is live once it is published."
          : `Its release-signed APK is published on [the rolling Suite release](${releaseLink}); that ` +
            "release's Mobile table says whether this build is attached yet.",
      "This per-app entry is history and carries no binary.",
      "",
      `[How to sideload it](${blobUrl("apps/go/README.md")}) is in Suite Go's README.`,
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
 * The page can be written before publication, so a row that has no published
 * release says **pending** instead of linking a page that does not exist.
 * `--write` writes it from the tree; `--publish` rewrites it with real links
 * after the drafts are published. `--draft` never writes it.
 */
export function releasesPage(
  entries,
  { date, tag, aggregatePublished = false, apkLive = false, channel = "stable" },
) {
  const latest = aggregatePublished
    ? [
        "The signed Flatpak remote is the update path. This page is the human mirror of the",
        `[aggregate Suite Shell + Suite Go ${date} release](${releaseUrl(tag)}), which is the repository's`,
        "\"Latest\" release on GitHub. The per-app releases stay as history and carry no app",
        "binaries.",
      ]
    : [
        "The signed Flatpak remote is the update path. This page is the human mirror of the",
        `rolling Suite Shell + Suite Go ${date} release, which is not published yet. A row marked **pending**`,
        "has no published release to link yet: `--draft` creates the drafts, and `--publish` publishes",
        "them and refreshes this page. The per-app releases stay as history and carry no app binaries.",
      ];

  return [
    "# Suite releases",
    "",
    "<!-- Generated by `scripts/release-status.mjs` from each app's `package.json` and the date",
    "     in its changelog. Do not edit the table; edit those files and regenerate. -->",
    "",
    ...latest,
    "",
    "## Install",
    "",
    "The signed Flatpak remote is where the desktop apps come from. Add it once, before any",
    "`flatpak install` line below works:",
    "",
    "```sh",
    `flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ${flatpakrepoUrl()}`,
    "```",
    "",
    `Remote: [${REMOTE_NAME}.flatpakrepo](${flatpakrepoUrl()})`,
    "",
    "## Channels and maturity",
    "",
    "A channel is a promise about a build: `slop`, `nightly`, `preview` or `stable`. Channels are on",
    "the superapp, Suite Shell and Suite Go, not on individual mini-apps. Packs carry signed versions,",
    "not channels. Maturity is separate: `pre-alpha`, `alpha`, `beta` or `1.0`, so a `stable`-channel",
    "build can still be `alpha`.",
    "",
    "`frozen` marks a legacy app: Canvas, Planner, Budget and Help keep their code and last artifact,",
    "and they get no new pre-release channel until they become packs. Start and Sync are not",
    "superapps and are not frozen; their rows name no channel.",
    "",
    ...aggregateSection("Desktop", entriesForSection(entries, "desktop"), {
      markPending: true,
      tag,
      apkLive,
    }),
    "",
    ...aggregateSection("Mobile", entriesForSection(entries, "mobile"), {
      markPending: true,
      tag,
      apkLive,
    }),
    "",
    ...goInstallNote(entries, { tag, apkLive, channel }),
    "## Update",
    "",
    "Once the remote is added, the desktop apps update with:",
    "",
    "```sh",
    "flatpak update --user",
    "```",
    "",
    "GitHub Packages is not used for the Flatpaks.",
    "",
    "## Regenerate",
    "",
    "```sh",
    "mise exec -- node scripts/release-status.mjs --draft",
    "mise exec -- node scripts/release-status.mjs --publish",
    "mise exec -- node scripts/release-status.mjs --write",
    "```",
    "",
  ].join("\n");
}

/** Parse the command line; a dry run is the default and one mode at a time. */
export function parseArgs(argv) {
  const options = {
    draft: false,
    publish: false,
    dryRun: false,
    write: false,
    date: null,
    channel: "stable",
    help: false,
  };

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
    else if (arg === "--draft") options.draft = true;
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
    options.draft ? "--draft" : null,
    options.publish ? "--publish" : null,
    options.write ? "--write" : null,
    options.dryRun ? "--dry-run" : null,
  ].filter((mode) => mode !== null);
  if (modes.length > 1) {
    throw new Error(`${modes.join(" and ")} pick different modes; pass at most one`);
  }

  return options;
}

/**
 * The one place that says which modes write `RELEASES.md`.
 *
 * A draft is not public, so drafting must not refresh the mirror; a dry run
 * writes nothing at all. `--write` refreshes the page from the tree and
 * `--publish` writes it once the releases are public.
 */
export function writesReleasesPage(mode) {
  return mode === "write" || mode === "publish";
}

/**
 * Write `RELEASES.md`, refusing from a mode that must not touch the mirror.
 *
 * The guard is the invariant, not a comment: `--draft` and `--dry-run` can
 * never reach the file, whatever a future branch does.
 */
function writeReleasesPage(mode, content) {
  if (!writesReleasesPage(mode)) {
    throw new Error(`${mode} must not write ${RELEASES_FILE}`);
  }
  writeFileSync(join(ROOT, RELEASES_FILE), content);
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

/**
 * Every release that already exists, by tag, or null when the read failed.
 *
 * `isDraft` is the whole draft/publish decision: a draft is mutable, and a
 * published release is immutable (D6.3) and must never be edited again.
 */
function existingReleases() {
  const result = spawnSync(
    "gh",
    ["release", "list", "--limit", "200", "--json", "tagName,isLatest,isDraft,isImmutable"],
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
        ? actionLabel(entry)
        : `${actionLabel(entry)}: ${entry.actionProblem}`;
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

/**
 * The `gh release` arguments for the draft phase.
 *
 * A draft is created with `--draft` and has no `--latest`: Latest is a fact
 * about publication, not about a private draft. Editing an existing draft
 * updates only its title and body, which is what makes a rerun idempotent.
 */
export function draftReleaseArgs({ tag, title, notesPath, action, target }) {
  if (action === "edit") {
    return ["release", "edit", tag, "--title", title, "--notes-file", notesPath];
  }
  return [
    "release",
    "create",
    tag,
    "--title",
    title,
    "--notes-file",
    notesPath,
    "--draft",
    "--target",
    target,
  ];
}

/**
 * The `gh release` arguments that publish one draft.
 *
 * The notes are refreshed in the same edit that flips `--draft=false`, so a
 * body that links the attached APK becomes public without a second, separate
 * edit after the release is locked. Only a draft is ever passed here.
 */
export function publishReleaseArgs({ tag, notesPath, latest }) {
  return [
    "release",
    "edit",
    tag,
    "--notes-file",
    notesPath,
    "--draft=false",
    latest ? "--latest" : "--latest=false",
  ];
}

/** Create or update every release as a draft; never write the page. */
function mainDraft({ entries, aggregate, date, tag, releases, notes }) {
  if (releases === null) {
    throw new Error(
      "gh release list failed; refusing to draft into a repository it cannot read",
    );
  }

  mkdirSync(join(ROOT, NOTES_DIR), { recursive: true });
  for (const item of notes) writeFileSync(join(ROOT, item.path), item.body);

  for (const entry of entries) {
    if (entry.action !== "create" && entry.action !== "edit") continue;
    if (entry.plan.createLocal) run("git", ["tag", entry.tag, entry.plan.commit]);
    run(
      "gh",
      draftReleaseArgs({
        tag: entry.tag,
        title: `${entry.app.name} ${entry.version}`,
        notesPath: join(NOTES_DIR, `${entry.tag}.md`),
        action: entry.action,
        target: entry.plan.commit,
      }),
    );
  }

  if (aggregate.action === "create" || aggregate.action === "edit") {
    if (aggregate.plan.createLocal) run("git", ["tag", tag, aggregate.plan.commit]);
    run(
      "gh",
      draftReleaseArgs({
        tag,
        title: `Suite Shell + Suite Go — ${date}`,
        notesPath: join(NOTES_DIR, `${tag}.md`),
        action: aggregate.action,
        target: aggregate.plan.commit,
      }),
    );
  }

  process.stdout.write(
    `\nDraft step complete. ${RELEASES_FILE} is written when the drafts are published.\n` +
      "Attach every asset while the releases are drafts, then run:\n" +
      "  mise exec -- node scripts/release-status.mjs --publish\n",
  );
}

/** Publish the drafts, then write the page with real links. */
function mainPublish({ entries, aggregate, date, tag, releases, notes, apkLive }) {
  if (releases === null) {
    throw new Error("gh release list failed; refusing to publish into a repository it cannot read");
  }

  mkdirSync(join(ROOT, NOTES_DIR), { recursive: true });
  for (const item of notes) writeFileSync(join(ROOT, item.path), item.body);

  for (const entry of entries) {
    if (entry.action !== "publish") continue;
    if (entry.plan.createLocal) run("git", ["tag", entry.tag, entry.plan.commit]);
    run(
      "gh",
      publishReleaseArgs({
        tag: entry.tag,
        notesPath: join(NOTES_DIR, `${entry.tag}.md`),
        latest: false,
      }),
    );
  }

  if (aggregate.action === "publish") {
    if (aggregate.plan.createLocal) run("git", ["tag", tag, aggregate.plan.commit]);
    run(
      "gh",
      publishReleaseArgs({
        tag,
        notesPath: join(NOTES_DIR, `${tag}.md`),
        latest: true,
      }),
    );
  }

  // Every release named on the page is public now, so the refresh links instead
  // of saying "pending". The APK link is live only when the draft already
  // carried the asset; it could not be attached after publication.
  for (const entry of entries) entry.published = true;
  writeReleasesPage(
    "publish",
    releasesPage(entries, { date, tag, aggregatePublished: true, apkLive }),
  );
  process.stdout.write(`\nwrote ${RELEASES_FILE}\n`);
  process.stdout.write(`Latest release: ${releaseUrl(tag)}\n`);
}

/**
 * Say that a draft is about to be published without Suite Go's APK.
 *
 * The APK is built and uploaded by `scripts/android-release.mjs` while the
 * rolling release is a draft. Publishing without it is irreversible: the
 * published release locks its assets, so the file can never be attached
 * afterwards. A dead download link that looks live is the thing this avoids;
 * the warning names the upload rather than failing a deliberate desktop-only
 * release.
 */
function warnMissingApk({ tag, goAsset }) {
  process.stderr.write(
    `\nwarning: ${tag} is a draft with no ${goAsset}.\n` +
      "         Publishing locks the release's tag, assets and body: the APK could never be\n" +
      "         attached afterwards, and the Suite Go cell will name the file, not link it.\n" +
      "         Attach it to the draft first: node scripts/android-release.mjs --publish\n" +
      `         Then run --publish again so the body and ${RELEASES_FILE} link it.\n`,
  );
}

/** The short label one release's decided phase gets in the summary. */
function actionLabel(entry) {
  const label =
    {
      create: "create as draft",
      edit: "update draft",
      publish: "publish draft",
      refuse: "REFUSED",
      skip: "skip",
      link: "link (published)",
      pending: "pending (not published)",
    }[entry.action] ?? String(entry.action);
  return entry.isLatest === true ? `${label} (currently Latest)` : label;
}

/**
 * Which phase one mode runs for one release.
 *
 * `--write` decides nothing on GitHub: it only needs to know whether a row
 * links or is pending, which `published` already answers.
 */
function decidePhase(mode, { exists, isDraft, tag }) {
  if (mode === "publish") return publishAction({ exists, isDraft, tag });
  if (mode === "write") {
    return {
      action: exists && isDraft !== true ? "link" : "pending",
      problem: null,
    };
  }
  return draftAction({ exists, isDraft, tag });
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

  const channelMiss = channelProblem(options.channel);
  if (channelMiss !== null) throw new Error(channelMiss);

  const mode = options.draft
    ? "draft"
    : options.publish
      ? "publish"
      : options.write
        ? "write"
        : "dry-run";
  const releases = existingReleases();
  const { problems, entries } = collect({ mode });
  const knownReleases = releases ?? [];

  const fatalProblems = [];
  const skipped = [];
  for (const entry of entries) {
    const row = knownReleases.find((candidate) => candidate.tagName === entry.tag) ?? null;
    entry.exists = row !== null;
    entry.isDraft = row?.isDraft === true;
    entry.isLatest = row?.isLatest === true;
    entry.published = row !== null && row.isDraft === false;

    if (releases === null && mode === "publish") {
      entry.action = "refuse";
      entry.actionProblem =
        "gh release list failed; refusing to publish releases it cannot read";
    } else {
      const phase = decidePhase(mode, {
        exists: entry.exists,
        isDraft: entry.isDraft,
        tag: entry.tag,
      });
      entry.action = phase.action;
      entry.actionProblem = phase.problem;
    }

    if (entry.actionProblem !== null && mode !== "write") {
      // A refused or skipped release that is already public still links; only
      // one with no public release is pending in the page a refusal rewrites.
      if (entry.action === "refuse" && entry.published !== true) entry.pending = true;
      if (entry.action === "refuse") fatalProblems.push(entry.actionProblem);
      else skipped.push(entry.actionProblem);
    }
  }

  if (problems.length > 0) throw new Error(problems.join("\n\n"));

  const head = currentHead();
  const date = aggregateDate(entries, options.date);
  const tag = aggregateTag(date);
  const aggregate = planAggregate(tag, head);
  if (aggregate.plan.problem !== null && mode !== "write") {
    throw new Error(aggregate.plan.problem);
  }

  const aggregateRow = knownReleases.find((row) => row.tagName === tag) ?? null;
  const aggregateExists = aggregateRow !== null;
  const aggregateIsDraft = aggregateRow?.isDraft === true;
  const aggregatePublished = aggregateExists && aggregateRow.isDraft === false;

  if (releases === null && mode === "publish") {
    aggregate.action = "refuse";
    aggregate.actionProblem =
      "gh release list failed; refusing to publish releases it cannot read";
  } else {
    const phase = decidePhase(mode, {
      exists: aggregateExists,
      isDraft: aggregateIsDraft,
      tag,
    });
    aggregate.action = phase.action;
    aggregate.actionProblem = phase.problem;
  }
  if (aggregate.actionProblem !== null && mode !== "write") {
    if (aggregate.action === "refuse") fatalProblems.push(aggregate.actionProblem);
    else skipped.push(aggregate.actionProblem);
  }

  // The APK belongs to the aggregate release, so whether its cell links is read
  // from that release's assets, not assumed from the version in the tree. A
  // draft can already carry the APK: the upload happens between `--draft` and
  // `--publish`, and the publish phase re-renders the body from this read.
  const goEntry = entries.find((entry) => entry.app.kind === "apk") ?? null;
  const channel = options.channel;
  const goAsset = goEntry === null ? null : goApkName(goEntry.version, channel);
  const aggregateAssets = aggregateExists ? releaseAssets(tag) : null;
  const apkLive =
    goAsset !== null &&
    aggregateAssets !== null &&
    aggregateAssets.some((asset) => asset?.name === goAsset);
  if (mode === "publish" && aggregateIsDraft && goAsset !== null && !apkLive) {
    warnMissingApk({ tag, goAsset });
  }

  // A draft body says the APK is attached during the same promotion; a published
  // body states what the release actually carries.
  const draftBodies = mode === "draft" || mode === "dry-run";
  const body = aggregateReleaseBody(entries, {
    date,
    tag,
    apkLive,
    draft: draftBodies,
    channel,
  });
  const page = releasesPage(entries, { date, tag, aggregatePublished, apkLive, channel });
  const notes = [
    ...entries.map((entry) => ({
      path: join(NOTES_DIR, `${entry.tag}.md`),
      body: appReleaseBody(entry.app, entry.section, {
        tag,
        apkLive,
        draft: draftBodies,
        channel,
      }),
    })),
    { path: join(NOTES_DIR, `${tag}.md`), body },
  ];

  process.stdout.write(`\nSuite releases · ${mode === "dry-run" ? "dry run" : mode}\n`);
  if (releases === null) {
    process.stdout.write(
      "\ncould not read the existing releases (gh release list failed); " +
        "this run cannot draft or publish.\n",
    );
  } else {
    const latest = releases.find((row) => row.isLatest);
    process.stdout.write(
      `\nLatest on GitHub now: ${latest === undefined ? "none" : latest.tagName}` +
        (mode === "publish" ? ` → ${tag} after this run\n` : "\n"),
    );
  }

  for (const entry of entries) process.stdout.write(`\n${summarize(entry, releases)}\n`);

  process.stdout.write(
    `\nSuite Shell + Suite Go ${date} · ${tag} · aggregate\n` +
      `  release    ${
        releases === null
          ? "unknown (gh release list failed)"
          : aggregate.action === "refuse"
            ? "REFUSED (see below)"
            : actionLabel(aggregate)
      }\n` +
      `  tag        ${tagStatus(aggregate, (commit) => `backfill ${commit.slice(0, 12)} — HEAD, the snapshot this page describes`)}\n`,
  );

  if (skipped.length > 0) {
    process.stdout.write(
      `\n${skipped.length} release(s) already published and immutable; left unchanged:\n`,
    );
    for (const notice of skipped) process.stdout.write(`  - ${notice}\n`);
  }

  if (mode === "publish") {
    if (fatalProblems.length > 0) {
      // A version that was never drafted is a refusal, not a skip: publishing
      // it now would have to create a release and attach nothing.
      throw new Error(fatalProblems.join("\n\n"));
    }
    mainPublish({ entries, aggregate, date, tag, releases, notes, apkLive });
    return;
  }

  if (mode === "draft") {
    if (fatalProblems.length > 0) throw new Error(fatalProblems.join("\n\n"));
    mainDraft({ entries, aggregate, date, tag, releases, notes });
    return;
  }

  if (mode === "write") {
    writeReleasesPage("write", page);
    process.stdout.write(`\nwrote ${RELEASES_FILE}\n`);
    return;
  }

  for (const entry of entries) {
    if (entry.action !== "create" && entry.action !== "edit") continue;
    if (entry.plan.createLocal) {
      process.stdout.write(
        `\n  $ ${commandText("git", ["tag", entry.tag, entry.plan.commit])}`,
      );
    }
    process.stdout.write(
      `\n  $ ${commandText(
        "gh",
        draftReleaseArgs({
          tag: entry.tag,
          title: `${entry.app.name} ${entry.version}`,
          notesPath: join(NOTES_DIR, `${entry.tag}.md`),
          action: entry.action,
          target: entry.plan.commit,
        }),
      )}\n`,
    );
  }

  if (aggregate.action === "create" || aggregate.action === "edit") {
    if (aggregate.plan.createLocal) {
      process.stdout.write(`\n  $ ${commandText("git", ["tag", tag, aggregate.plan.commit])}`);
    }
    process.stdout.write(
      `\n  $ ${commandText(
        "gh",
        draftReleaseArgs({
          tag,
          title: `Suite Shell + Suite Go — ${date}`,
          notesPath: join(NOTES_DIR, `${tag}.md`),
          action: aggregate.action,
          target: aggregate.plan.commit,
        }),
      )}\n`,
    );
  }

  for (const entry of entries) {
    process.stdout.write(`\n--- ${entry.app.name} ${entry.version} · draft body ---\n\n`);
    process.stdout.write(
      appReleaseBody(entry.app, entry.section, { tag, apkLive, draft: true, channel }),
    );
  }

  process.stdout.write(`\n--- ${tag} · draft body ---\n\n`);
  process.stdout.write(body);
  process.stdout.write(
    `\n--- ${RELEASES_FILE} ---\n\n` +
      "would be written from the same table by --write and by --publish; --draft never writes it.\n",
  );
  process.stdout.write(
    "\ndry run: nothing was tagged, drafted, published or written; the bodies above are what a draft would use.\n" +
      "To draft: mise exec -- node scripts/release-status.mjs --draft\n" +
      "Attach the assets while the releases are drafts, then publish:\n" +
      "  mise exec -- node scripts/release-status.mjs --publish\n" +
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
