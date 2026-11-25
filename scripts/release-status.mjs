#!/usr/bin/env node
/**
 * The Suite's GitHub releases, generated from the versions already in the tree.
 *
 * GitHub shows one "Latest" release per repository. This repository publishes
 * the rolling Suite release, tagged `suite-YYYY.MM.DD` and marked Latest, plus
 * the pre-release channel pages `suite-<channel>-<date>`. A slop page also names
 * its commit (`suite-slop-<date>-<sha7>`), because every code push to `main`
 * publishes one. The body names the two
 * superapps and how each is installed: a Flatpak command for Suite Desk, or the
 * release-signed Suite Go APK attached to this same release. Each names its
 * release channel and product maturity. Per-app releases are retired; a pack
 * carries a signed version and has no release page. When
 * `.dev/release/release-manifest.json` exists, the body also carries the
 * artifact digests and the commands that verify a download (D6.2).
 *
 * The version has one home: the app's `package.json`. The snapshot date has one
 * home: the `## [version] - YYYY-MM-DD` heading in its changelog. This script
 * reads both, refuses a version without a matching section, and writes nothing
 * to GitHub by default. A pre-release tag carries the day it is published, not
 * the snapshot date, so a nightly gets a new tag every day even when no app
 * version changed (D6.1).
 *
 * Publication is two phases, because published releases are immutable (D6.3):
 * the tag, every asset and the body lock when the release is published.
 *
 * 1. `--draft` creates or updates the rolling release as a draft, with its body
 *    and tag plan. Assets are attached while the release is still a draft.
 *    Rerunning it updates the same draft and writes no page.
 * 2. `--publish` refreshes the draft body from the assets it now carries,
 *    publishes it with `gh release edit --draft=false`, then writes
 *    `RELEASES.md` with real links. A release that is already published is
 *    never edited: it is skipped with a message and the page is rewritten from
 *    the current state. A release with no draft is refused.
 *
 * A missing aggregate tag is created at HEAD, the snapshot the page describes;
 * an existing tag is never moved.
 *
 * `--check-published` is the cheap question a nightly asks before the gate: it
 * names this run's tag and prints one sentence when that tag is already
 * published, so a second nightly on the same day stops instead of failing after
 * the build. It prints nothing when the tag is free or still a draft. A
 * deliberate second publication names another tag date — `--date`, or the
 * workflow's `date` input, which every step that names the tag reads.
 *
 * Usage:
 *   node scripts/release-status.mjs            # dry run: commands and bodies
 *   node scripts/release-status.mjs --draft    # create or update the draft releases
 *   node scripts/release-status.mjs --publish  # publish the drafts, then write RELEASES.md
 *   node scripts/release-status.mjs --write    # refresh RELEASES.md only
 *   node scripts/release-status.mjs --check-published --channel nightly
 *                                               # is this tag already out?
 *   node scripts/release-status.mjs --date 2026-11-21 --draft
 *   node scripts/release-status.mjs --channel slop --revision abc1234 --draft
 *                                               # suite-slop-<date>-abc1234
 *   node scripts/release-status.mjs --help
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { changelogSection, versionFromPackage } from "./release.mjs";
import {
  CHANNELS,
  PRE_RELEASE_CHANNELS,
  STABLE_CHANNEL,
  branchFor,
  channelProblem,
  flatpakId as flatpakIdFor,
} from "./lib/channel.mjs";
import {
  DEFAULT_PUBLIC_URL,
  REMOTE_NAME,
  flatpakrepoUrl as remoteFlatpakrepoUrl,
} from "./lib/flatpakRemote.mjs";
import { INDEX_METADATA_FILE } from "./lib/releaseIndex.mjs";

/** The repository this page and these releases belong to. */
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const RELEASE_REPO = "mrrnbhd/suite-apps";

/** The Flatpak remote a person adds before installing; the signed update path. */
export { REMOTE_NAME };
export const REMOTE_URL = DEFAULT_PUBLIC_URL;

/** The generated human mirror of the Latest release, committed at the root. */
export const RELEASES_FILE = "RELEASES.md";

/** The README carries the same channel table; `--check-readme` keeps it honest. */
export const README_FILE = "README.md";
export const CHANNELS_BLOCK_START =
  "<!-- BEGIN generated:channels (scripts/release-status.mjs; do not edit by hand) -->";
export const CHANNELS_BLOCK_END = "<!-- END generated:channels -->";

/** Where a publish writes each release body before handing it to `gh`. */
export const NOTES_DIR = ".dev/releases";

/**
 * The digest manifest `release-manifest.mjs` writes for one publication (D2.1).
 *
 * The release workflow writes it before `--draft`, attests it, and attaches it
 * to the rolling draft; `--publish` re-renders the body from it. A local
 * `--write` run usually has no manifest, which is why the section is optional.
 */
export const MANIFEST_FILE = "release-manifest.json";
export const MANIFEST_PATH = join(".dev", "release", MANIFEST_FILE);

/**
 * What `release-index.mjs` wrote when it staged a catalogue publication.
 *
 * The index itself is on the Flatpak remote; this local report carries the
 * sequence, expiry and the operator fingerprint the notes print, so a person
 * can pin the catalogue trust root deliberately. A release with no pack has no
 * report, and its notes carry no catalogue section.
 */
export const INDEX_RELEASE_FILE = INDEX_METADATA_FILE;
export const INDEX_RELEASE_PATH = join(".dev", "release", INDEX_RELEASE_FILE);

/** The product-maturity labels, separate from the release channels. */
export const PRODUCT_MATURITY = ["pre-alpha", "alpha", "beta", "1.0"];

/**
 * The four release channels in promotion order, the order
 * `docs/explanation/channels.md` lists them. One list feeds every table below,
 * so a page cannot name a channel the model does not have.
 */
export const CHANNEL_ORDER = [...PRE_RELEASE_CHANNELS, STABLE_CHANNEL];

/**
 * The newest **published** page per channel, or null for one that has none.
 *
 * A draft is excluded: its page is not readable yet, and linking it would send a
 * person to a 404 that is still being written.
 */
export function newestPages(releases) {
  const published = (releases ?? []).filter((row) => row?.isDraft === false);
  const pages = {};
  for (const channel of CHANNEL_ORDER) {
    const pattern = channelTagPattern(channel);
    pages[channel] =
      published
        .map((row) => row.tagName ?? "")
        .filter((tagName) => pattern.test(tagName))
        .sort((left, right) => right.localeCompare(left))[0] ?? null;
  }
  return pages;
}

/**
 * The channel table every release page and `RELEASES.md` carries.
 *
 * `mode` decides the third column: a release page names the Flatpak id a reader
 * types after adding the remote, and the README spends the extra width on the
 * whole command, because that is the page a person starts from. Both render the
 * same rows from the same list, so the two cannot disagree about a channel or a
 * branch.
 */
export function channelTable({
  mode = "page",
  channel = null,
  tag = null,
  pages = {},
  shellApp = null,
} = {}) {
  const header =
    mode === "install"
      ? ["| Channel | Suite Desk | Suite Go | Page |", "| --- | --- | --- | --- |"]
      : ["| Channel | Newest page | Suite Desk |", "| --- | --- | --- |"];
  const rows = CHANNEL_ORDER.map((name) => {
    const shape =
      name === "stable"
        ? "`suite-<date>`"
        : name === "slop"
          ? "`suite-slop-<date>-<revision>`"
          : `\`suite-${name}-<date>\``;
    const page = name === channel && tag !== null ? tag : (pages?.[name] ?? null);
    const where =
      pages === null
        ? shape
        : name === channel && tag !== null
          ? `this page (\`${tag}\`)`
          : page === null
            ? "not published yet"
            : `[\`${page}\`](${releaseUrl(page)})`;
    if (mode === "install") {
      const command = shellApp === null ? "—" : `\`${installCommand(shellApp, name)}\``;
      const apk =
        name === "stable"
          ? `[\`suite-go.apk\`](https://github.com/${RELEASE_REPO}/releases/latest/download/suite-go.apk)`
          : `\`suite-go-${name}-<version>.apk\` on that page`;
      return `| \`${name}\` | ${command} | ${apk} | ${where} |`;
    }
    const id = shellApp === null ? "—" : `\`${releaseFlatpakRef(shellApp, name)}\``;
    return `| \`${name}\` | ${where} | ${id} |`;
  });
  return [...header, ...rows];
}

/** The README block: the version-free channel table, between its markers. */
export function channelsBlock() {
  return [CHANNELS_BLOCK_START, "", ...channelInstallTable(), "", CHANNELS_BLOCK_END].join("\n");
}

/** `text` with the generated channels block replaced. */
export function withChannelsBlock(text, block = channelsBlock()) {
  const start = text.indexOf(CHANNELS_BLOCK_START);
  const end = text.indexOf(CHANNELS_BLOCK_END);
  if (start < 0 || end < start) {
    throw new Error(`${README_FILE} has no ${CHANNELS_BLOCK_START} … ${CHANNELS_BLOCK_END} block`);
  }
  return text.slice(0, start) + block + text.slice(end + CHANNELS_BLOCK_END.length);
}

/**
 * Why `text`'s channels block is out of date, or null when it is current.
 *
 * A hand-edited table and the generator drift silently otherwise, and the README
 * is the page a person installs from. The gate runs this, so a channel rename or
 * a new channel cannot leave the README telling someone to run a command that
 * installs nothing.
 */
export function readmeChannelsDrift(text) {
  const start = text.indexOf(CHANNELS_BLOCK_START);
  const end = text.indexOf(CHANNELS_BLOCK_END);
  if (start < 0 || end < start) {
    return `${README_FILE} has no generated channels block; restore ${CHANNELS_BLOCK_START}`;
  }
  const current = text.slice(start, end + CHANNELS_BLOCK_END.length);
  if (current === channelsBlock()) return null;
  return (
    `${README_FILE}'s channels table is out of date; run ` +
    "`node scripts/release-status.mjs --write` and commit the result"
  );
}

/** The version-free table the README and `RELEASES.md` share. */
export function channelInstallTable() {
  return channelTable({
    mode: "install",
    pages: null,
    shellApp: APPS.find((app) => app.id === "desk") ?? null,
  });
}


/**
 * The apps frozen as legacy until they become packs.
 *
 * The list lives in the channel library so the Flatpak builder refuses a new
 * pre-release build for the same apps this table marks frozen. Sync is retired
 * rather than frozen: it leaves this table entirely (#315) and the relay becomes
 * a host capability, so there is no row to name a channel for.
 */
export { LEGACY_FROZEN_IDS } from "./lib/channel.mjs";

/**
 * Every app whose version and date the aggregate reads. Each section keeps this
 * order, and only the two superapps are rendered on a release page.
 *
 * `kind` says where the installed bytes come from, and `installCell` is the one
 * place that turns it into a cell:
 *
 * - `flatpak` — a signed deployment on the OSTree remote.
 * - `apk` — a release-signed APK attached to the rolling suite release.
 *
 * `section` is the table a row belongs to: `desktop` or `mobile`. The table is
 * rendered by `aggregateSection`, which takes a title and the entries to render,
 * so a section is only a title plus its rows and the shape can be reused by a
 * page that splits the same data differently.
 *
 * `channel` names the release channel of a superapp row: Suite Desk and Suite
 * Go. It is absent on apps that are not superapps. `maturity` is the product
 * label and is independent of the channel, so a `stable` build may be `alpha`.
 * `frozen` marks a legacy app that keeps its code and last artifact but gets no
 * new release or channel; Status owns that inventory, so the release page does
 * not render it.
 *
 * Sync has no row. It stopped being a shipped artifact (#315): the signed remote
 * keeps the last published `run.suite.sync` ref, no new build is published, and
 * `services/relay` stays in the tree as the protocol, client library and relay
 * implementation.
 *
 * `flatpakId` is null outside the Flatpak rows. Per-app tags are retired, so no
 * entry carries a tag prefix: the rolling `suite-YYYY.MM.DD` tag is the only one
 * a release run creates.
 */
export const APPS = [
  {
    id: "desk",
    name: "Suite Desk",
    packageJson: "hosts/desk/package.json",
    changelog: "hosts/desk/CHANGELOG.md",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.desk",
    channel: "stable",
    maturity: "alpha",
  },
  {
    id: "go",
    name: "Suite Go",
    packageJson: "hosts/go/package.json",
    changelog: "hosts/go/CHANGELOG.md",
    kind: "apk",
    section: "mobile",
    flatpakId: null,
    channel: "stable",
    maturity: "pre-alpha",
  },
  {
    id: "canvas",
    name: "Suite Canvas",
    packageJson: "legacy/canvas/desktop/package.json",
    changelog: "legacy/canvas/CHANGELOG.md",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.canvas",
    maturity: "alpha",
    frozen: true,
  },
  {
    id: "planner",
    name: "Suite Planner",
    packageJson: "legacy/planner/package.json",
    changelog: "legacy/planner/CHANGELOG.md",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.planner",
    maturity: "pre-alpha",
    frozen: true,
  },
  {
    id: "budget",
    name: "Suite Budget",
    packageJson: "legacy/budget/package.json",
    changelog: "legacy/budget/CHANGELOG.md",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.budget",
    maturity: "pre-alpha",
    frozen: true,
  },
  {
    id: "help",
    name: "Suite Help",
    packageJson: "legacy/help/package.json",
    changelog: "legacy/help/CHANGELOG.md",
    kind: "flatpak",
    section: "desktop",
    flatpakId: "run.suite.help",
    frozen: true,
  },
];

const USAGE = `usage: node scripts/release-status.mjs [options]

  --dry-run            print every command and body; the default
  --draft              create or update the rolling release as a draft
  --publish            publish the existing draft, then write ${RELEASES_FILE}
  --write              write ${RELEASES_FILE} and stop short of GitHub
  --date <YYYY-MM-DD>  tag date; a pre-release defaults to today in UTC, stable to
                       the newest app release (which is also stable's snapshot date)
  --channel <name>     stable (default), slop, nightly or preview; names the APK asset
  --revision <sha7>    commit the slop page, tag and APK name carry; required for slop
  --check-published    print one sentence and stop when this run's tag is already
                       published; print nothing and exit 0 when it is not
  --check-readme       fail when the README's channel table is not what --write
                       would generate
  --manifest <path>    release manifest for the Artifacts section
                       (default: .dev/release/release-manifest.json when it exists)
  --prune              delete old published pre-release releases (never stable)
  --keep <n>           releases a pruned channel keeps (default: 14, or 7 for slop)
  --help               print this text

Pass one of --draft, --publish, --write and --dry-run, or --check-published or
--check-readme. The two checks read and write nothing.

A release is created as a draft, its assets are attached while it is a draft, and
--publish flips it. A published release is immutable and is never edited.

The versions come from each app's package.json; the dates from its changelog.
Only the rolling release and the pre-release channel pages exist; per-app tags
are retired. --date sets the tag date: stable uses the newest changelog date by
default, a pre-release uses today in UTC, and a same-day rerun of one needs
--date for another day.

The slop channel is published for one commit: pass --revision <sha7>, and the
tag, the body and the Suite Go APK name carry it. A second run for the same
commit is a no-op, not a moved tag.
`;

/**
 * The commit slice a slop tag and its assets carry.
 *
 * A slop build is published for one commit. The short revision is what keeps a
 * second merge on the same day from reusing the first build's tag, and what
 * makes "this commit was already published" a question with an answer.
 */
export const REVISION_PATTERN = /^[0-9a-f]{7}$/u;

/** True when this is the lower-case `sha7` a slop tag may carry. */
export function isRevision(value) {
  return typeof value === "string" && REVISION_PATTERN.test(value);
}

/**
 * Why a channel cannot use this revision, or null.
 *
 * `stable` is a snapshot, not a per-commit build: a revision would move the
 * rolling tag and is refused. Slop requires one so its tag and assets name the
 * commit; nightly and preview may take one but do not need it.
 */
export function revisionProblem(channel, revision) {
  if (revision === null || revision === undefined) {
    if (channel === "slop") {
      return (
        "the slop channel needs --revision <sha7>: its tag and assets name the commit, " +
        "and without one a second build of the same day would reuse the first tag."
      );
    }
    return null;
  }
  if (channel === "stable") {
    return "the stable channel takes no --revision: its tag is the snapshot date, not a commit.";
  }
  if (!isRevision(revision)) {
    return `--revision ${JSON.stringify(revision)} is not a lower-case sha7 (7 hex characters).`;
  }
  return null;
}

/**
 * Why this revision does not name the checked-out commit, or null.
 *
 * The tag, the page and the APK name say which commit the bytes came from, so a
 * revision other than HEAD would label the build with a commit it is not.
 */
export function revisionHeadProblem(revision, head) {
  if (!isRevision(revision) || typeof head !== "string" || head.length < 7) return null;
  if (head.startsWith(revision)) return null;
  return (
    `--revision ${revision} is not HEAD (${head.slice(0, 7)}); the tag, page and asset would ` +
    "name a commit this tree is not."
  );
}

/**
 * The aggregate tag, dotted as the owner chose: `suite-2026.11.21`.
 *
 * A slop tag carries the commit as well: `suite-slop-2026.11.24-abc1234`. The
 * optional revision is appended for any pre-release that names one; stable never
 * carries one.
 */
export function aggregateTag(date, channel = "stable", revision = null) {
  const dotted = date.replace(/-/gu, ".");
  if (channel === "stable") {
    if (revision !== null && revision !== undefined) {
      throw new Error("the stable tag is the snapshot date and never carries a revision");
    }
    return `suite-${dotted}`;
  }
  const tag = `suite-${channel}-${dotted}`;
  return revision === null || revision === undefined ? tag : `${tag}-${revision}`;
}

/** The shape a channel's tag uses, for a page list to filter on. */
export function channelTagPattern(channel) {
  const dotted = String.raw`\d{4}\.\d{2}\.\d{2}`;
  if (channel === "stable") return new RegExp(`^suite-${dotted}$`, "u");
  if (channel === "slop") {
    return new RegExp(`^suite-slop-${dotted}-[0-9a-f]{7}$`, "u");
  }
  return new RegExp(`^suite-${channel}-${dotted}(?:-[0-9a-f]{7})?$`, "u");
}

/** True when a tag belongs to this channel and carries its expected shape. */
export function isChannelTag(tag, channel) {
  return typeof tag === "string" && channelTagPattern(channel).test(tag);
}

/**
 * The aggregate tag the current tree is released under.
 *
 * The workflow attaches assets to the draft after `--draft`, so it has to name
 * the same tag `--draft` created: stable uses the newest changelog date, and a
 * pre-release channel uses today in UTC. `--date` names a tag date explicitly,
 * and so does the workflow's `date` input; `load`, `now` and `env` are
 * injectable so a test needs no tree, no clock and no CI event.
 */
export function currentAggregateTag({
  load = read,
  channel = "stable",
  date = null,
  revision = null,
  now = new Date(),
  env = process.env,
} = {}) {
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
  const { tagDate } = releaseDates(entries, {
    channel,
    date: date ?? workflowInputDate(env),
    now,
  });
  return aggregateTag(tagDate, channel, revision);
}

/** A release's page on GitHub. */
export function releaseUrl(tag) {
  return `https://github.com/${RELEASE_REPO}/releases/tag/${tag}`;
}

/** How many published pages a channel keeps when `--keep` names no number. */
export function defaultKeepFor(channel) {
  return channel === "slop" ? 7 : 14;
}

/**
 * Published pre-release releases older than the newest `keep` for a channel.
 *
 * The tag carries its date, so lexical order is chronological for one fixed
 * tag shape. Only published releases are pruned; a draft is still being written.
 * A slop page must match the revision shape: a build is one commit, and the
 * older revision-less form is history rather than a page this rule prunes.
 */
export function pruneCandidates(releases, { channel, keep = defaultKeepFor(channel) }) {
  return (releases ?? [])
    .filter((row) => row.isDraft === false)
    .filter((row) => isChannelTag(row.tagName, channel))
    .sort((a, b) => b.tagName.localeCompare(a.tagName))
    .slice(keep)
    .map((row) => row.tagName);
}

/**
 * The published slop page for one commit, or null.
 *
 * The date in a slop tag is the publication day, so the same commit re-run on a
 * later day would otherwise get a second page. The commit is the identity that
 * matters: if any published slop tag ends with `-<revision>`, the work is done.
 */
export function slopRevisionRelease(releases, revision, channel = "slop") {
  if (!isRevision(revision)) return null;
  return (
    (releases ?? []).find(
      (row) =>
        row.isDraft === false &&
        isChannelTag(row.tagName, channel) &&
        row.tagName.endsWith(`-${revision}`),
    ) ?? null
  );
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

/**
 * The Flatpak id a release installs: a superapp's pre-release id on a
 * pre-release channel, its stable id otherwise.
 *
 * Only a superapp carries a channel. Since #380 each pre-release channel has its
 * own id (`run.suite.nightly.desk`) and branch (`nightly`), so its install must
 * name both; the frozen legacy rows keep their stable ids on every page, because
 * no pre-release build replaces them.
 */
export function releaseFlatpakId(app, channel = "stable") {
  if (app.kind !== "flatpak") return null;
  if (channel === "stable" || app.channel === undefined) return app.flatpakId;
  return flatpakIdFor(app.id, channel);
}

/** The branch suffix a pre-release ref needs (`//nightly`), or empty on stable. */
function refBranch(app, channel) {
  return channel !== "stable" && app.channel !== undefined ? `//${branchFor(channel)}` : "";
}

/**
 * The full Flatpak ref a release installs or runs.
 *
 * A pre-release is `run.suite.nightly.desk//nightly`: the id names the channel
 * and the branch names the build line, so stable and every pre-release are
 * separate refs.
 */
export function releaseFlatpakRef(app, channel = "stable") {
  return `${releaseFlatpakId(app, channel)}${refBranch(app, channel)}`;
}

/** The install command for a Flatpak app, or null for anything else. */
export function installCommand(app, channel = "stable") {
  if (app.kind !== "flatpak") return null;
  return `flatpak install --user ${REMOTE_NAME} ${releaseFlatpakRef(app, channel)}`;
}

/**
 * The APK a Suite Go version attaches to the rolling release.
 *
 * A slop build carries the commit after the version:
 * `suite-go-slop-0.2.0-abc1234.apk`. The revision is optional for nightly and
 * preview so their existing asset names keep working; stable never takes one.
 */
export function goApkName(version, channel = "stable", revision = null) {
  if (channel === "stable") return `suite-go-${version}.apk`;
  const base = `suite-go-${channel}-${version}`;
  return revision === null || revision === undefined ? `${base}.apk` : `${base}-${revision}.apk`;
}

/** The Go APK's download URL on the aggregate release. */
export function goApkUrl(tag, version, channel = "stable", revision = null) {
  return releaseAssetUrl(tag, goApkName(version, channel, revision));
}

/**
 * The table cell that says how one row is installed.
 *
 * One cell per row, whatever the artifact. `apkLive` is whether the release
 * already carries the APK; until it does the cell names the file instead of
 * linking a download that would 404. `draft` says that cell is written into a
 * release that is still a draft, where the APK is attached before publication,
 * so the wording does not read as a promise the run cannot keep. `channel` is
 * the release's channel, so a pre-release row names the superapp's
 * `run.suite.<channel>.<app>` ref on that branch rather than the stable one.
 */
export function installCell(
  app,
  {
    version = null,
    tag = null,
    apkLive = false,
    draft = false,
    channel = "stable",
    revision = null,
  } = {},
) {
  if (app.kind === "flatpak") return `\`${installCommand(app, channel)}\``;
  if (app.kind === "apk") {
    const name =
      version === null ? "suite-go.apk" : goApkName(version, channel, revision);
    if (apkLive && tag !== null && version !== null) {
      return `[${name}](${goApkUrl(tag, version, channel, revision)})`;
    }
    if (draft) return `\`${name}\` (attached to this draft before publication)`;
    return `\`${name}\` (not uploaded yet)`;
  }
  throw new Error(`no install cell for kind ${String(app.kind)}`);
}

/**
 * The channel a row names: the release's channel, or `frozen` for legacy.
 *
 * A legacy app is not on a channel any more, so saying `frozen` in the channel
 * cell is honest: its code and last artifact stay, but no new build is offered.
 * A superapp names the channel the release is published from, so a nightly page
 * says `nightly` rather than the stable channel the table was first written for.
 */
export function channelLabel(app, channel = "stable") {
  if (app.frozen === true) return "frozen";
  if (app.channel === undefined) return "—";
  return channel;
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
 * channel build can still be `alpha`. `channel` is the release's channel, so a
 * note rendered for `suite-nightly-<date>` names `nightly`, not the channel the
 * app was first catalogued under.
 */
export function releaseLabels(app, channel = "stable") {
  return [
    `- **Channel:** ${channelLabel(app, channel)}`,
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
 * The tag date a workflow explicitly named, or null when it named none.
 *
 * A deliberate second publication has to name another tag date: a published
 * release is immutable, so its tag can never carry a second artifact (D6.3).
 * The nightly takes that choice as its `date` dispatch input, and the release
 * workflow it calls runs this script without `--date`. Reading the triggering
 * event keeps one answer, so `--draft`, the asset upload and `--publish` all
 * name the same tag. A local run has no event file and names the date with
 * `--date`; an input that is not a calendar date refuses rather than silently
 * falling back to today, which would reuse a published tag.
 */
export function workflowInputDate(env = process.env) {
  const path = env.GITHUB_EVENT_PATH;
  if (typeof path !== "string" || path.length === 0) return null;
  let event;
  try {
    event = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  const value = event?.inputs?.date;
  if (value === undefined || value === null || value === "") return null;
  if (!isDate(value)) {
    throw new Error(
      `the workflow's date input is ${JSON.stringify(value)}, not a YYYY-MM-DD calendar ` +
        "date; refusing to publish under a tag it did not name",
    );
  }
  return value;
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
 * The newest changelog date: the snapshot a release describes.
 *
 * A rolling release is a snapshot of the apps, so a day when nothing shipped
 * does not change it. `--date` overrides it for a deliberate backfill; on a
 * pre-release the override moves the tag date instead, because the body keeps
 * naming the snapshot (see `releaseDates`).
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
 * The two dates one release run carries (D6.1).
 *
 * The snapshot date is the newest changelog date, and the body keeps naming it:
 * "This is the <snapshot> build". On a pre-release channel the body names the
 * tag date too, because that tag moves every day and the snapshot does not. The
 * tag date is the day the release is published: stable keeps the snapshot date,
 * while nightly and preview use today in UTC, so a daily publication gets a new
 * `suite-<channel>-YYYY.MM.DD` even when no app version changed.
 *
 * `--date` sets the tag date. On stable the tag date is also the snapshot date,
 * because the rolling tag *is* the snapshot; on a pre-release it only moves the
 * tag, and the body still names the newest changelog date.
 */
export function releaseDates(entries, { channel = "stable", date = null, now = new Date() } = {}) {
  const override = date === null ? null : aggregateDate(entries, date);
  const snapshotDate = aggregateDate(entries, channel === "stable" ? override : null);
  const tagDate = override ?? (channel === "stable" ? snapshotDate : today(now));
  return { snapshotDate, tagDate };
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
 * The one sentence a nightly prints when its tag is already published.
 *
 * A second run on the same day has nothing it may do: the release is
 * immutable, so there is no tag to move and no asset to add. It stops before
 * the gate instead of failing after the build, and it stays green because the
 * day's artifact does exist — this run simply has no work.
 */
export function alreadyPublishedMessage(tag, { channel = "stable", revision = null } = {}) {
  if (channel === "slop" && isRevision(revision)) {
    return (
      `${tag} is already published for commit ${revision}; a second run for the same commit is ` +
      "a no-op, so this run stops before the build and leaves the tag, assets and body untouched."
    );
  }
  return (
    `${tag} is already published; its artifact already exists, so this run stops before ` +
    "the gate and leaves it untouched."
  );
}

/**
 * What a check of this run's tag found: stop with one sentence, or go ahead.
 *
 * A draft does not stop the run: it is mutable, so a rerun updates the same
 * draft and stays idempotent. Only a published release — which cannot be edited
 * and whose tag cannot carry a second artifact — ends the run early. A slop
 * build also stops when the same commit was published on another day: the slop
 * tag names the commit, and a rerun must not move or duplicate that build.
 */
export function publishedCheck(releases, tag, { channel = "stable", revision = null } = {}) {
  const sameCommit = channel === "slop" ? slopRevisionRelease(releases, revision, channel) : null;
  const current = sameCommit ?? releaseFor(releases, tag);
  if (current !== null && current.isDraft !== true) {
    return {
      published: true,
      sentence: alreadyPublishedMessage(current.tagName, { channel, revision }),
    };
  }
  return { published: false, sentence: null };
}

/**
 * The message for a release a draft run refuses to overwrite.
 *
 * A published release cannot be turned back into a draft, and it is immutable
 * (D6.3), so the assets this run would attach have nowhere to go. Skipping and
 * letting the caller upload would fail inside an immutable release, so the
 * draft phase refuses before anything is written.
 */
export function draftRefusalMessage(tag, { channel = "stable", revision = null } = {}) {
  if (channel === "slop" && isRevision(revision)) {
    return (
      `${tag} is already published for commit ${revision}, and published releases are immutable: ` +
      "--draft will not create a second page for the same commit. A rerun for this commit is a " +
      "no-op; a new merge is what produces a new slop tag."
    );
  }
  return (
    `${tag} is already published, and published releases are immutable: --draft will not ` +
    "create or edit a draft over it, because the assets that follow would upload into a " +
    "locked release. A same-day rerun needs --date <YYYY-MM-DD> naming another day."
  );
}

/**
 * What the draft phase may do with one release, or why it must not.
 *
 * A draft is mutable, so rerunning `--draft` edits the same release and stays
 * idempotent. A published release cannot be turned back into a draft, so it is
 * refused by name: the version is already out, and the caller's attachment
 * step would otherwise hit an immutable release. A slop run additionally
 * refuses when this commit was published under another day's tag.
 */
export function draftAction({
  exists,
  isDraft,
  tag,
  channel = "stable",
  revision = null,
  sameCommitTag = null,
}) {
  if (sameCommitTag !== null && sameCommitTag !== tag) {
    return {
      action: "refuse",
      problem: draftRefusalMessage(sameCommitTag, { channel, revision }),
    };
  }
  if (!exists) return { action: "create", problem: null };
  if (isDraft === true) return { action: "edit", problem: null };
  return { action: "refuse", problem: draftRefusalMessage(tag, { channel, revision }) };
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
 * The superapps a release page names, in reading order.
 *
 * A pack carries a signed version and has no release page, so it is not a row:
 * only Suite Desk and Suite Go appear. The other `APPS` entries stay for their
 * version and changelog facts, which the aggregate date reads.
 */
export const SUPERAPP_IDS = ["desk", "go"];

/** The two superapp entries from a collected tree, by id and in page order. */
export function superappEntries(entries) {
  return SUPERAPP_IDS.map((id) => entries.find((entry) => entry.app.id === id)).filter(Boolean);
}

/**
 * The shared table rows, used by the aggregate body and by RELEASES.md.
 *
 * The table names the two superapps and how each is installed. Per-app releases
 * are retired, so there is no Release column and no pending row: a page that
 * names a release which will never exist is the thing this shape avoids.
 *
 * `tag` and `apkLive` describe the aggregate release the APK lives on. The
 * subset passed in is the section being rendered, so callers can split desktop
 * and mobile rows without changing this shape. `draft` marks a body written
 * into a release that is still a draft.
 */
export function aggregateRows(
  entries,
  { tag = null, apkLive = false, draft = false, channel = "stable", revision = null } = {},
) {
  return entries.map((entry) => {
    const { app, version } = entry;
    const install = installCell(app, { version, tag, apkLive, draft, channel, revision });
    return (
      `| [${app.name}](${blobUrl(app.changelog)}) | ${channelLabel(app, channel)} | ` +
      `${maturityLabel(app)} | ${version} | ${install} |`
    );
  });
}

/** The header every generated table carries. */
export const AGGREGATE_TABLE_HEADER = [
  "| App | Channel | Maturity | Version | Install |",
  "| --- | --- | --- | --- | --- |",
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
function goInstallNote(
  entries,
  { tag = null, apkLive = false, draft = false, channel = "stable", revision = null },
) {
  const go = entries.find((entry) => entry.app.kind === "apk") ?? null;
  if (go === null) return [];
  const name = goApkName(go.version, channel, revision);
  if (apkLive && tag !== null) {
    return [
      `Suite Go is not a Flatpak. This release carries its release-signed APK, [${name}](${goApkUrl(tag, go.version, channel, revision)}),`,
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
 * The release manifest at `path`, or null when the file does not exist.
 *
 * The manifest is read, never recomputed: its digests describe the bytes the
 * workflow built, and hashing a file on this machine could describe a different
 * one. A missing manifest is normal on a local `--write` run, so it omits the
 * section rather than failing. A malformed one refuses: a note that names the
 * wrong digest is worse than one that names none.
 */
export function readManifest(path = MANIFEST_PATH, { load = read } = {}) {
  let text;
  try {
    text = load(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `${path} is not valid JSON; refusing to build a note from digests it cannot read`,
    );
  }
}

/**
 * The catalogue report at `path`, or null when this release published no pack.
 *
 * A malformed report refuses, for the same reason a malformed manifest does: a
 * note that prints the wrong operator fingerprint is worse than one that omits
 * the catalogue section entirely.
 */
export function readIndexRelease(path = INDEX_RELEASE_PATH, { load = read } = {}) {
  let text;
  try {
    text = load(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      `${path} is not valid JSON; refusing to print a catalogue fingerprint it cannot read`,
    );
  }
  const valid =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Number.isInteger(value.sequence) &&
    value.sequence > 0 &&
    typeof value.url === "string" &&
    value.url.length > 0 &&
    typeof value.signatureUrl === "string" &&
    value.signatureUrl.length > 0 &&
    typeof value.fingerprint === "string" &&
    value.fingerprint.length > 0;
  if (!valid) {
    throw new Error(
      `${path} has no usable sequence, URLs or fingerprint; refusing to publish a note from it`,
    );
  }
  return value;
}

/** One artifact from the manifest by kind, or null when the manifest omits it. */
function manifestArtifact(manifest, kind) {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  return artifacts.find((artifact) => artifact?.kind === kind) ?? null;
}

/** A manifest value as a code span, or an em dash when it is missing. */
function codeOrDash(value) {
  return typeof value === "string" && value.length > 0 ? `\`${value}\`` : "—";
}

/** The file name inside a manifest's repository-relative artifact path. */
function artifactFileName(artifact) {
  return typeof artifact?.file === "string" && artifact.file.length > 0
    ? basename(artifact.file)
    : null;
}

/**
 * The Artifacts section: the digests from the manifest and how to check them.
 *
 * D6.2 asks a note to carry both the digest and the verification command. The
 * numbers come from `release-manifest.json` as it was written beside the built
 * artifacts, so a draft can state them: the bytes exist before publication and
 * `--publish` only locks them. The install and info commands name the manifest's
 * own Flatpak id and channel branch — `run.suite.nightly.desk//nightly` on a
 * pre-release — and the APK's `.sha256` file is the one uploaded beside the APK.
 */
export function artifactsSection(manifest, { tag = null, draft = false, channel = "stable" } = {}) {
  const flatpak = manifestArtifact(manifest, "flatpak");
  const apk = manifestArtifact(manifest, "apk");
  if (flatpak === null && apk === null) return [];

  const lines = [
    "## Artifacts",
    "",
    "These digests are read from `release-manifest.json`, which is attached to this release;",
    "they describe the bytes that were built, not a later rebuild.",
    "",
  ];

  if (flatpak !== null) {
    const bundle = artifactFileName(flatpak);
    lines.push(
      `- Flatpak ${codeOrDash(flatpak.id)} on branch ${codeOrDash(flatpak.branch)}: ` +
        `OSTree commit ${codeOrDash(flatpak.commit)}, ` +
        `bundle${bundle === null ? "" : ` \`${bundle}\``} SHA-256 ${codeOrDash(flatpak.sha256)}.`,
    );
  }

  const apkFile = artifactFileName(apk);
  if (apk !== null) {
    lines.push(
      `- APK${apkFile === null ? "" : ` \`${apkFile}\``}: SHA-256 ${codeOrDash(apk.sha256)}.`,
    );
  }

  lines.push(
    "",
    tag === null
      ? `Manifest: \`${MANIFEST_FILE}\` on the rolling release.`
      : `Manifest: [${MANIFEST_FILE}](${releaseAssetUrl(tag, MANIFEST_FILE)})`,
    "",
  );

  if (draft) {
    lines.push(
      "The manifest and the artifacts are attached to this draft before publication, so these are",
      "the final bytes; `--publish` locks them and makes the manifest download above live.",
      "",
    );
  }

  const commands = [];
  if (apkFile !== null) commands.push(`sha256sum -c ${apkFile}.sha256`);
  if (flatpak !== null && typeof flatpak.id === "string" && flatpak.id.length > 0) {
    // A pre-release carries the channel in its id and its branch, so the ref
    // needs both: `run.suite.nightly.desk//nightly`. Stable is the default
    // branch and keeps the plain id a shipped install already has.
    const artifactBranch =
      typeof flatpak.branch === "string" && flatpak.branch.length > 0
        ? flatpak.branch
        : branchFor(channel);
    const branch = channel === "stable" ? "" : `//${artifactBranch}`;
    commands.push(
      `flatpak install --user ${REMOTE_NAME} ${flatpak.id}${branch}`,
      `flatpak info ${flatpak.id}${branch}`,
    );
  }
  if (commands.length > 0) {
    lines.push(
      "Download the files beside their `.sha256`, then check them:",
      "",
      "```sh",
      ...commands,
      "```",
      "",
    );
    if (flatpak !== null) {
      lines.push(
        "`flatpak info` prints the deployed OSTree commit; compare it with the one above.",
        "",
      );
    }
  }

  return lines;
}

/**
 * The catalogue paragraph: where the signed index is, and the fingerprint to pin.
 *
 * The index and every pack archive live on the signed Flatpak remote, so a
 * reader adds no second origin. The fingerprint is the point of the section: a
 * host fetches whatever it is served, and only a value copied from here lets a
 * person decide that the catalogue operator is the one they meant.
 */
export function indexReleaseSection(index) {
  const expires =
    typeof index.expires === "string" && index.expires.length > 0
      ? ` It expires at ${index.expires}.`
      : "";
  return [
    "## Catalogue index",
    "",
    `Packs install from the signed catalogue at [index.json](${index.url}), sequence ` +
      `${index.sequence}; its detached signature is [index.json.sig](${index.signatureUrl}). ` +
      `Both are served from the signed Flatpak remote.${expires}`,
    "",
    `Catalogue operator fingerprint: \`${index.fingerprint}\`. Pin that value deliberately ` +
      "before trusting the catalogue; a host verifies the index before it lists a pack.",
    "",
  ];
}

/**
 * The paragraph that states a slop build's proof boundary.
 *
 * Slop is published by a push to `main`, after the merge queue passed. It is
 * deliberately not the full gate: the page must say so, or a reader would take
 * a session build for a release. The commit is named because the tag and every
 * asset name it, and the retention and no-index promises are part of the same
 * boundary.
 */
export function slopProofLines(revision) {
  return [
    `Commit \`${revision}\` on \`main\`. This build is **merge-queue-proven, not`,
    "full-gate-proven**: no fresh gate, e2e, clean install, SBOM or attestation ran for it,",
    "and it carries no pack catalogue index. It is a slop session build: it may be broken,",
    "incomplete, or change shape without notice, it never marks GitHub's Latest release, and",
    "only the seven newest slop pages are kept.",
    "",
  ];
}

/**
 * The aggregate release body: the two superapps and how they install.
 *
 * The rolling release is the snapshot, so the title says which day it is and
 * the current-versions table restates the two versions a reader installs. The
 * remote is added before the table, because every `flatpak install` cell needs
 * it and a reader who starts at the table would run a command that cannot work
 * yet. A pack carries a signed version and has no release page, so no pack row
 * is invented.
 *
 * Stable's tag is the snapshot, so the opening sentence names one day. A
 * pre-release tag carries the publication day instead, so that sentence names
 * both: the snapshot from the changelog and the tag date a reader sees above.
 * A slop body adds the commit and its merge-queue proof boundary.
 */
export function aggregateReleaseBody(
  entries,
  {
    date,
    tagDate = date,
    tag = null,
    apkLive = false,
    draft = false,
    channel = "stable",
    revision = null,
    pages = {},
    manifest = null,
    index = null,
  },
) {
  const superapps = superappEntries(entries);
  const desk = superapps.find((entry) => entry.app.id === "desk") ?? null;
  const go = superapps.find((entry) => entry.app.id === "go") ?? null;
  // The Desk install block is always present, even on a tree whose Desk row
  // could not be collected, so it reads its id from the app table.
  const deskApp = APPS.find((app) => app.id === "desk");
  return [
    `**Suite Desk** is the desktop superapp; **Suite Go** is the mobile superapp. ` +
      (channel === "stable"
        ? `This is the ${date} build.`
        : `This is the ${date} snapshot, published on the **${channel}** channel on ${tagDate}.`),
    "Only the two superapps have a release page; a pack carries a signed version and no page.",
    "",
    ...(channel === "slop" && isRevision(revision) ? slopProofLines(revision) : []),
    "## Channels",
    "",
    `Every channel is a promise; [Channels](${blobUrl("docs/explanation/channels.md")}) owns what each`,
    "one carries. This page is the " + `\`${channel}\` build, and the other three install beside it.`,
    "",
    ...channelTable({ channel, tag, pages, shellApp: deskApp }),
    "",
    `Install one after the remote below is added: \`flatpak install --user ${REMOTE_NAME} <id>\`.`,
    "",
    "## Suite Desk (desktop)",
    "",
    ...(desk === null ? [] : [...releaseLabels(desk.app, channel), ""]),
    "```sh",
    `flatpak remote-add --user --if-not-exists --from ${REMOTE_NAME} ${flatpakrepoUrl()}`,
    installCommand(deskApp, channel),
    `flatpak run ${releaseFlatpakRef(deskApp, channel)}`,
    "```",
    "",
    `Remote: [${REMOTE_NAME}.flatpakrepo](${flatpakrepoUrl()})`,
    "",
    "## Suite Go (mobile)",
    "",
    ...(go === null ? [] : [...releaseLabels(go.app, channel), ""]),
    ...goInstallNote(superapps, { tag, apkLive, draft, channel, revision }),
    "## Current versions",
    "",
    ...aggregateTable(superapps, { tag, apkLive, draft, channel, revision }),
    "",
    ...artifactsSection(manifest, { tag, draft, channel }),
    ...(index === null || channel === "slop" ? [] : indexReleaseSection(index)),
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
 * `RELEASES.md`: the same data, as the human mirror of the Latest release.
 *
 * The generated comment is deliberate. A version belongs in `package.json`; this
 * file restates it because it is a mirror, and a mirror that is typed by hand
 * drifts.
 *
 * The page names the two superapps and no per-app release, so it never has a
 * **pending** row for a page that will never exist. Before publication it says
 * the rolling release is not published yet. `--write` writes it from the tree;
 * `--publish` rewrites it once the release is public. `--draft` never writes it.
 */
export function releasesPage(
  entries,
  { date, tag, aggregatePublished = false, apkLive = false, channel = "stable" },
) {
  const superapps = superappEntries(entries);
  const latest = aggregatePublished
    ? [
        "The signed Flatpak remote is the update path. This page is the human mirror of the",
        `[rolling Suite Desk + Suite Go ${date} release](${releaseUrl(tag)}), which is the repository's`,
        "\"Latest\" release on GitHub. Only the two superapps have a release page; a pack carries",
        "a signed version.",
      ]
    : [
        "The signed Flatpak remote is the update path. This page is the human mirror of the",
        `rolling Suite Desk + Suite Go ${date} release, which is not published yet. \`--draft\``,
        "creates the draft, its assets are attached while it is a draft, and `--publish` publishes",
        "it and refreshes this page.",
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
    "the superapp, Suite Desk and Suite Go, not on individual mini-apps. Packs carry signed versions,",
    "not channels. Maturity is separate: `pre-alpha`, `alpha`, `beta` or `1.0`, so a `stable`-channel",
    "build can still be `alpha`.",
    "",
    ...channelInstallTable(),
    "",
    ...aggregateSection("Desktop", entriesForSection(superapps, "desktop"), {
      tag,
      apkLive,
      channel,
    }),
    "",
    ...aggregateSection("Mobile", entriesForSection(superapps, "mobile"), {
      tag,
      apkLive,
      channel,
    }),
    "",
    ...goInstallNote(superapps, { tag, apkLive, channel }),
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
    revision: null,
    manifest: null,
    prune: false,
    checkPublished: false,
    checkReadme: false,
    keep: null,
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
    } else if (arg === "--channel") {
      options.channel = takeValue(index, "--channel");
      const miss = channelProblem(options.channel);
      if (miss !== null) throw new Error(miss);
      index += 1;
    } else if (arg === "--revision") {
      options.revision = takeValue(index, "--revision");
      if (!isRevision(options.revision)) {
        throw new Error(
          `--revision ${JSON.stringify(options.revision)} is not a lower-case sha7 ` +
            "(7 hex characters)",
        );
      }
      index += 1;
    } else if (arg === "--manifest") {
      options.manifest = takeValue(index, "--manifest");
      index += 1;
    } else if (arg === "--prune") {
      options.prune = true;
    } else if (arg === "--check-published") {
      options.checkPublished = true;
    } else if (arg === "--check-readme") {
      options.checkReadme = true;
    } else if (arg === "--keep") {
      options.keep = Number(takeValue(index, "--keep"));
      if (!Number.isInteger(options.keep) || options.keep < 1) {
        throw new Error("--keep needs a positive whole number");
      }
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
    options.prune ? "--prune" : null,
    options.checkPublished ? "--check-published" : null,
    options.checkReadme ? "--check-readme" : null,
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
function writeReadmeChannels(mode) {
  if (!writesReleasesPage(mode)) {
    throw new Error(`${mode} must not write ${README_FILE}`);
  }
  const path = join(ROOT, README_FILE);
  const text = readFileSync(path, "utf8");
  writeFileSync(path, withChannelsBlock(text));
}

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
  return readFileSync(resolve(ROOT, path), "utf8");
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
 * Read the versions, sections and dates from the tree.
 *
 * No tag is planned here: per-app tags are retired, so `--write` needs no tag
 * lookup and succeeds on a checkout where no per-app tag exists. Every other
 * problem is collected before a single command is printed, so a dry run shows
 * the whole picture or names every reason it stops. `load` is injectable so a
 * test can prove the read needs no git state.
 */
export function collectReleases({ load = read } = {}) {
  const problems = [];
  const entries = [];

  for (const app of APPS) {
    let version = null;
    let changelog;
    try {
      version = versionFromPackage(load(app.packageJson));
      changelog = load(app.changelog);
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
          "A release note is what the section carries, so it has to exist before the release.",
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

    entries.push({
      app,
      version,
      date: changelogDate(changelog, version),
      section,
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

/** Where the aggregate tag may be created: the tree HEAD describes. */
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
export function draftReleaseArgs({
  tag,
  title,
  notesPath,
  action,
  target,
  prerelease = false,
}) {
  const pre = prerelease ? ["--prerelease"] : [];
  if (action === "edit") {
    return ["release", "edit", tag, "--title", title, "--notes-file", notesPath, ...pre];
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
    ...pre,
  ];
}

/**
 * The `gh release` arguments that publish one draft.
 *
 * The notes are refreshed in the same edit that flips `--draft=false`, so a
 * body that links the attached APK becomes public without a second, separate
 * edit after the release is locked. Only a draft is ever passed here.
 */
export function publishReleaseArgs({ tag, notesPath, latest, prerelease = false }) {
  return [
    "release",
    "edit",
    tag,
    "--notes-file",
    notesPath,
    "--draft=false",
    latest ? "--latest" : "--latest=false",
    ...(prerelease ? ["--prerelease"] : []),
  ];
}

/**
 * The title one draft or publication carries.
 *
 * A slop page names its commit as well, because more than one build can share a
 * day. Other channels keep the day-only title they already have.
 */
export function releaseTitle(date, channel = "stable", revision = null) {
  const base = `Suite Desk + Suite Go — ${date}`;
  if (channel === "stable" || !isRevision(revision)) return base;
  return `${base} (${revision})`;
}

/**
 * The git and gh steps one run would take for the rolling release.
 *
 * `--draft`, the dry run and `--publish` share this one plan, so the dry run
 * cannot print a command the real run would not take. Only the rolling release
 * is named: per-app tags and releases are retired, so there is no second tag to
 * create and no `--latest=false` per-app publication.
 */
export function aggregateReleaseCommands({
  mode,
  aggregate,
  tag,
  date,
  channel = "stable",
  revision = null,
  prerelease = false,
}) {
  const notesPath = join(NOTES_DIR, `${tag}.md`);
  if (mode === "publish") {
    if (aggregate.action !== "publish") return [];
    return [
      ...(aggregate.plan.createLocal
        ? [{ command: "git", args: ["tag", tag, aggregate.plan.commit] }]
        : []),
      {
        command: "gh",
        args: publishReleaseArgs({
          tag,
          notesPath,
          latest: channel === "stable",
          prerelease,
        }),
      },
    ];
  }

  if (aggregate.action !== "create" && aggregate.action !== "edit") return [];
  return [
    ...(aggregate.plan.createLocal
      ? [{ command: "git", args: ["tag", tag, aggregate.plan.commit] }]
      : []),
    {
      command: "gh",
      args: draftReleaseArgs({
        tag,
        title: releaseTitle(date, channel, revision),
        notesPath,
        action: aggregate.action,
        target: aggregate.plan.commit,
        prerelease,
      }),
    },
  ];
}

/** Create or update the rolling release as a draft; never write the page. */
function mainDraft({ aggregate, date, tag, releases, notes, prerelease, channel, revision }) {
  if (releases === null) {
    throw new Error(
      "gh release list failed; refusing to draft into a repository it cannot read",
    );
  }

  mkdirSync(join(ROOT, NOTES_DIR), { recursive: true });
  for (const item of notes) writeFileSync(join(ROOT, item.path), item.body);

  for (const step of aggregateReleaseCommands({
    mode: "draft",
    aggregate,
    tag,
    date,
    channel,
    revision,
    prerelease,
  })) {
    run(step.command, step.args);
  }

  process.stdout.write(
    `\nDraft step complete. ${RELEASES_FILE} is written when the release is published.\n` +
      "Attach every asset while the release is a draft, then run:\n" +
      "  mise exec -- node scripts/release-status.mjs --publish\n",
  );
}

/** Publish the rolling draft, then write the page with real links. */
function mainPublish({
  entries,
  aggregate,
  date,
  tag,
  releases,
  notes,
  apkLive,
  channel,
  revision,
  prerelease,
}) {
  if (releases === null) {
    throw new Error("gh release list failed; refusing to publish into a repository it cannot read");
  }

  mkdirSync(join(ROOT, NOTES_DIR), { recursive: true });
  for (const item of notes) writeFileSync(join(ROOT, item.path), item.body);

  for (const step of aggregateReleaseCommands({
    mode: "publish",
    aggregate,
    tag,
    date,
    channel,
    revision,
    prerelease,
  })) {
    run(step.command, step.args);
  }

  // The APK link is live only when the draft already carried the asset; it
  // could not be attached after publication. A pre-release publication does not
  // own the stable page, so it leaves the file alone.
  if (channel === "stable") {
    writeReleasesPage(
      "publish",
      releasesPage(entries, { date, tag, aggregatePublished: true, apkLive }),
    );
    process.stdout.write(`\nwrote ${RELEASES_FILE}\n`);
  } else {
    process.stdout.write(`\n${RELEASES_FILE} is written by the stable channel only.\n`);
  }
  process.stdout.write(
    `${channel === "stable" ? "Latest" : "Published"} release: ${releaseUrl(tag)}\n`,
  );
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
function decidePhase(mode, { exists, isDraft, tag, channel = "stable", revision = null, sameCommitTag = null }) {
  if (mode === "publish") return publishAction({ exists, isDraft, tag });
  if (mode === "write") {
    return {
      action: exists && isDraft !== true ? "link" : "pending",
      problem: null,
    };
  }
  return draftAction({ exists, isDraft, tag, channel, revision, sameCommitTag });
}

/** One release row from a release list, or null when the tag is not there. */
export function releaseFor(releases, tag) {
  return (releases ?? []).find((row) => row.tagName === tag) ?? null;
}

/**
 * Which phase one mode runs for one tag, read from a release list.
 *
 * The list is the injectable seam: the real run reads `gh release list`, and a
 * test passes rows directly, so the decision the draft phase makes over a
 * published release is the one exercised here.
 */
export function releasePhase(
  mode,
  releases,
  tag,
  { channel = "stable", revision = null } = {},
) {
  const row = releaseFor(releases, tag);
  const sameCommit = channel === "slop" ? slopRevisionRelease(releases, revision, channel) : null;
  return decidePhase(mode, {
    exists: row !== null,
    isDraft: row?.isDraft === true,
    tag,
    channel,
    revision,
    sameCommitTag: sameCommit?.tagName ?? null,
  });
}

/**
 * Why this mode must not touch `RELEASES.md`, or null.
 *
 * The page is the mirror of the stable Latest release. `--write` refreshes it
 * from the tree on a workstation; letting a pre-release run that mode would
 * overwrite the stable mirror with a channel page, so it is refused by name.
 */
export function writeModeProblem(channel, mode) {
  if (mode !== "write" || channel === "stable") return null;
  return (
    `--write refreshes ${RELEASES_FILE}, the stable mirror; a ${channel} page is written ` +
    "only by --publish, so this refuses to overwrite the stable page with a pre-release."
  );
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

  if (options.checkReadme) {
    const drift = readmeChannelsDrift(readFileSync(join(ROOT, README_FILE), "utf8"));
    if (drift !== null) {
      process.stderr.write(`${drift}\n`);
      process.exit(1);
    }
    process.stdout.write(`${README_FILE}: the channels table is current\n`);
    return;
  }

  const channelMiss = channelProblem(options.channel);
  if (channelMiss !== null) throw new Error(channelMiss);
  const channel = options.channel;
  const revision = options.revision;
  const prerelease = channel !== "stable";

  const mode = options.draft
    ? "draft"
    : options.publish
      ? "publish"
      : options.write
        ? "write"
        : "dry-run";
  // A slop page is per commit. Requiring the revision before anything is read
  // makes the tag impossible to guess or reuse; a non-slop channel may omit it.
  if (!options.prune) {
    const revisionMiss = revisionProblem(channel, revision);
    if (revisionMiss !== null) throw new Error(revisionMiss);
  }
  if (channel !== "stable" && mode === "write") {
    throw new Error(writeModeProblem(channel, mode));
  }
  const releases = existingReleases();
  // The tag date has one answer per run. `--date` names it; in a dispatch, the
  // workflow's `date` input does, so the check and the publication that follows
  // cannot disagree about which tag they mean.
  const namedDate = options.date ?? workflowInputDate();

  if (options.checkPublished) {
    const tag = currentAggregateTag({ channel, date: namedDate, revision });
    const headMiss = channel === "slop" ? revisionHeadProblem(revision, currentHead()) : null;
    if (headMiss !== null) throw new Error(headMiss);
    if (releases === null) {
      throw new Error(
        `gh release list failed; cannot tell whether ${tag} is already published, so this ` +
          "run does not stop a build it cannot justify",
      );
    }
    const check = publishedCheck(releases, tag, { channel, revision });
    if (check.published) process.stdout.write(`${check.sentence}\n`);
    return;
  }

  if (options.prune) {
    if (channel === "stable") {
      throw new Error("--prune is for a pre-release channel; the stable release is never pruned");
    }
    if (releases === null) {
      throw new Error("gh release list failed; refusing to prune releases it cannot read");
    }
    const keep = options.keep ?? defaultKeepFor(channel);
    const doomed = pruneCandidates(releases, { channel, keep: keep });
    for (const tag of doomed) {
      if (options.dryRun) {
        process.stdout.write(`would delete ${tag}\n`);
      } else {
        run("gh", ["release", "delete", tag, "--yes", "--cleanup-tag"]);
        process.stdout.write(`deleted ${tag}\n`);
      }
    }
    process.stdout.write(
      doomed.length === 0
        ? `Nothing to prune: ${channel} keeps the newest ${keep}.\n`
        : `Pruned ${doomed.length} ${channel} release(s); kept the newest ${keep}.\n`,
    );
    return;
  }

  // D6.2: the digests come from the manifest the workflow wrote beside the
  // artifacts, never from re-hashing them here. A local `--write` run has none,
  // so the section is absent rather than invented; an explicit path that is
  // missing is a mistake and refuses.
  const manifestPath = options.manifest ?? MANIFEST_PATH;
  const manifest = readManifest(manifestPath);
  // The catalogue index is a stable/nightly publication fact. A slop build
  // never writes or reads one: it publishes only its own id, refs and page.
  const indexRelease = channel === "slop" ? null : readIndexRelease();
  if (manifest === null && options.manifest !== null) {
    throw new Error(
      `--manifest ${options.manifest} names no readable file; refusing to omit the Artifacts ` +
        "section it asked for",
    );
  }

  const { problems, entries } = collectReleases();
  const knownReleases = releases ?? [];

  const fatalProblems = [];
  const skipped = [];

  if (problems.length > 0) throw new Error(problems.join("\n\n"));

  const head = currentHead();
  const headMiss = channel === "slop" ? revisionHeadProblem(revision, head) : null;
  if (headMiss !== null) throw new Error(headMiss);
  const { snapshotDate, tagDate } = releaseDates(entries, { channel, date: namedDate });
  const tag = aggregateTag(tagDate, channel, revision);
  const pages = newestPages(releases);
  const aggregate = planAggregate(tag, head);
  if (aggregate.plan.problem !== null && mode !== "write") {
    throw new Error(aggregate.plan.problem);
  }

  const aggregateRow = releaseFor(knownReleases, tag);
  const aggregateExists = aggregateRow !== null;
  const aggregateIsDraft = aggregateRow?.isDraft === true;
  const aggregatePublished = aggregateExists && aggregateRow.isDraft === false;

  if (releases === null && mode === "publish") {
    aggregate.action = "refuse";
    aggregate.actionProblem =
      "gh release list failed; refusing to publish releases it cannot read";
  } else {
    const phase = releasePhase(mode, knownReleases, tag, { channel, revision });
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
  const goAsset = goEntry === null ? null : goApkName(goEntry.version, channel, revision);
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
    date: snapshotDate,
    tagDate,
    tag,
    apkLive,
    draft: draftBodies,
    channel,
    revision,
    pages,
    manifest,
    index: indexRelease,
  });
  const page = releasesPage(entries, {
    date: snapshotDate,
    tag,
    aggregatePublished,
    apkLive,
    channel,
  });
  const notes = [{ path: join(NOTES_DIR, `${tag}.md`), body }];

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
        (mode === "publish" && channel === "stable" ? ` → ${tag} after this run\n` : "\n"),
    );
  }

  process.stdout.write(
    `\nSuite Desk + Suite Go ${snapshotDate} build · ${tag} · aggregate\n` +
      (tagDate === snapshotDate ? "" : `  tag date   ${tagDate} (snapshot ${snapshotDate})\n`) +
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

  // A dry run plans the draft commands, so a refusal the real draft would hit
  // must fail here too rather than print a plan that cannot run.
  if (fatalProblems.length > 0 && mode === "dry-run") {
    throw new Error(fatalProblems.join("\n\n"));
  }

  if (mode === "publish") {
    if (fatalProblems.length > 0) {
      // A version that was never drafted is a refusal, not a skip: publishing
      // it now would have to create a release and attach nothing.
      throw new Error(fatalProblems.join("\n\n"));
    }
    mainPublish({
      entries,
      aggregate,
      date: snapshotDate,
      tag,
      releases,
      notes,
      apkLive,
      channel,
      revision,
      prerelease,
    });
    return;
  }

  if (mode === "draft") {
    if (fatalProblems.length > 0) throw new Error(fatalProblems.join("\n\n"));
    // The title names the publication day; the body names the snapshot.
    mainDraft({ aggregate, date: tagDate, tag, releases, notes, prerelease, channel, revision });
    return;
  }

  if (mode === "write") {
    writeReleasesPage("write", page);
    process.stdout.write(`\nwrote ${RELEASES_FILE}\n`);
    writeReadmeChannels("write");
    process.stdout.write(`wrote the ${README_FILE} channels table\n`);
    return;
  }

  for (const step of aggregateReleaseCommands({
    mode: "draft",
    aggregate,
    tag,
    date: tagDate,
    channel,
    revision,
    prerelease,
  })) {
    process.stdout.write(`\n  $ ${commandText(step.command, step.args)}\n`);
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
