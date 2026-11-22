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
  --write              write ${RELEASES_FILE} and stop short of GitHub
  --publish            create or update the releases, then write ${RELEASES_FILE}
  --date <YYYY-MM-DD>  date for the aggregate tag (default: the newest app release)
  --help               print this text

Pass one of --publish, --write and --dry-run.

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
export function goApkName(version) {
  return `suite-go-${version}.apk`;
}

/** The Go APK's download URL on the aggregate release. */
export function goApkUrl(tag, version) {
  return releaseAssetUrl(tag, goApkName(version));
}

/**
 * The table cell that says how one row is installed.
 *
 * One cell per row, whatever the artifact. `apkLive` is whether the aggregate
 * release already carries the APK; until it does the cell names the file
 * instead of linking a download that would 404.
 */
export function installCell(app, { version = null, tag = null, apkLive = false } = {}) {
  if (app.kind === "flatpak") return `\`${installCommand(app)}\``;
  if (app.kind === "apk") {
    const name = version === null ? "suite-go.apk" : goApkName(version);
    if (apkLive && tag !== null && version !== null) {
      return `[${name}](${goApkUrl(tag, version)})`;
    }
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
 * What a publish may do with one release, or why it must not.
 *
 * Every artifact already exists elsewhere — the signed Flatpak remote, the
 * rolling release's APK — so a release page is created when missing and edited
 * in place when it exists. An existing page keeps whatever assets it carries.
 */
export function releaseAction({ exists }) {
  return exists
    ? { action: "edit", problem: null }
    : { action: "create", problem: null };
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
 * and mobile rows without changing this shape.
 */
export function aggregateRows(
  entries,
  { markPending = false, tag = null, apkLive = false } = {},
) {
  return entries.map((entry) => {
    const { app, version, date, tag: appTag } = entry;
    const released = date ?? "—";
    const pending = entry.pending === true || (markPending && entry.published !== true);
    const release = pending
      ? `\`${appTag}\` (pending)`
      : `[\`${appTag}\`](${releaseUrl(appTag)})`;
    const install = installCell(app, { version, tag, apkLive });
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
 * being a dead link that looks live.
 */
function goInstallNote(entries, { tag = null, apkLive = false }) {
  const go = entries.find((entry) => entry.app.kind === "apk") ?? null;
  if (go === null) return [];
  const name = goApkName(go.version);
  if (apkLive && tag !== null) {
    return [
      `Suite Go is not a Flatpak. This release carries its release-signed APK, [${name}](${goApkUrl(tag, go.version)}),`,
      "with a SHA-256 checksum beside it; sideload it with `adb install -r -t`.",
      "",
    ];
  }
  return [
    `Suite Go is not a Flatpak. Its release-signed APK, \`${name}\`, is not attached to this release yet:`,
    "`node scripts/android-release.mjs --publish` uploads it, and the link appears once it is there.",
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
export function aggregateReleaseBody(entries, { date, tag = null, apkLive = false }) {
  const desktop = entriesForSection(entries, "desktop");
  const otherDesktop = desktop.filter((entry) => entry.app.id !== "shell");
  const shell = entries.find((entry) => entry.app.id === "shell") ?? null;
  const go = entries.find((entry) => entry.app.id === "go") ?? null;
  return [
    `**Suite Shell** is the desktop superapp; **Suite Go** is the mobile superapp. This is the ${date} build.`,
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
    ...goInstallNote(entries, { tag, apkLive }),
    "## Also on the remote",
    "",
    ...aggregateTable(otherDesktop, { tag, apkLive }),
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
 * truth is rather than claiming an attachment that may not exist yet.
 */
export function appReleaseBody(app, section, { tag = null, apkLive = false } = {}) {
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
 * The page can be written before publication, so a row that has no release yet
 * says **pending** instead of linking a page that does not exist. `--publish`
 * rewrites the page with real links once the releases are created.
 */
export function releasesPage(
  entries,
  { date, tag, aggregatePublished = false, apkLive = false },
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
        "has no release to link until `--publish` creates it and refreshes this page; the",
        "per-app releases stay as history and carry no app binaries.",
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
    ...goInstallNote(entries, { tag, apkLive }),
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

function mainPublish({ entries, aggregate, date, tag, releases, notes, apkLive }) {
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
      title: `Suite Shell + Suite Go — ${date}`,
      notesPath: join(NOTES_DIR, `${tag}.md`),
      latest: true,
      action: aggregateExisting === null ? "create" : "edit",
      target: aggregate.plan.commit,
    }),
  );

  // Everything named on the page now exists, so the refresh links instead of
  // saying "pending". The APK is uploaded by `android-release.mjs`, so its link
  // is live only when this run already found the asset on the aggregate release.
  for (const entry of entries) entry.published = true;
  writeFileSync(
    join(ROOT, RELEASES_FILE),
    releasesPage(entries, { date, tag, aggregatePublished: true, apkLive }),
  );
  process.stdout.write(`\nwrote ${RELEASES_FILE}\n`);
  process.stdout.write(`Latest release: ${releaseUrl(tag)}\n`);
}

/**
 * Say that the Suite Go link is not live, without failing the release.
 *
 * The APK is built and uploaded by `scripts/android-release.mjs` after the
 * aggregate release exists, so a release run can legitimately see no asset
 * yet. A dead download link that looks live is the thing this avoids: the
 * body and the page say the file is not attached, and this names the upload.
 */
function warnMissingApk({ tag, goAsset, apkLive, aggregateExists, releasesKnown }) {
  if (goAsset === null || apkLive || !releasesKnown) return;
  const situation = aggregateExists
    ? `${tag} carries no ${goAsset}`
    : `${tag} does not exist yet, so ${goAsset} cannot be attached`;
  process.stderr.write(
    `\nwarning: ${situation}.\n` +
      "         The Suite Go Install cell names the file instead of linking a download.\n" +
      "         Upload it with: node scripts/android-release.mjs --publish\n" +
      `         Then run this script again so the body and ${RELEASES_FILE} link it.\n`,
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

  const mode = options.publish ? "publish" : options.write ? "write" : "dry-run";
  const releases = existingReleases();
  const { problems, entries } = collect({ mode });

  const knownReleases = releases ?? [];
  for (const entry of entries) {
    const exists = knownReleases.some((row) => row.tagName === entry.tag);
    entry.published = releases !== null && exists;
    if (releases === null) {
      entry.action = "create";
      entry.actionProblem = null;
      continue;
    }
    const action = releaseAction({ exists });
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

  const aggregatePublished = releases !== null && knownReleases.some((row) => row.tagName === tag);
  const aggregateExisting = knownReleases.find((row) => row.tagName === tag) ?? null;
  // The APK belongs to the aggregate release, so whether its cell links is read
  // from that release's assets, not assumed from the version in the tree.
  const goEntry = entries.find((entry) => entry.app.kind === "apk") ?? null;
  const goAsset = goEntry === null ? null : goApkName(goEntry.version);
  const aggregateAssets = aggregateExisting === null ? null : releaseAssets(tag);
  const apkLive =
    goAsset !== null &&
    aggregateAssets !== null &&
    aggregateAssets.some((asset) => asset?.name === goAsset);
  warnMissingApk({
    tag,
    goAsset,
    apkLive,
    aggregateExists: aggregateExisting !== null,
    releasesKnown: releases !== null,
  });

  const body = aggregateReleaseBody(entries, { date, tag, apkLive });
  const page = releasesPage(entries, { date, tag, aggregatePublished, apkLive });
  const notes = [
    ...entries.map((entry) => ({
      path: join(NOTES_DIR, `${entry.tag}.md`),
      body: appReleaseBody(entry.app, entry.section, { tag, apkLive }),
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

  process.stdout.write(
    `\nSuite Shell + Suite Go ${date} · ${tag} · aggregate\n` +
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
    mainPublish({ entries, aggregate, date, tag, releases, notes, apkLive });
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
        title: `Suite Shell + Suite Go — ${date}`,
        notesPath: join(NOTES_DIR, `${tag}.md`),
        latest: true,
        action: aggregateExisting === null ? "create" : "edit",
        target: aggregate.plan.commit,
      }),
    )}\n`,
  );

  for (const entry of entries) {
    process.stdout.write(`\n--- ${entry.app.name} ${entry.version} · body ---\n\n`);
    process.stdout.write(appReleaseBody(entry.app, entry.section, { tag, apkLive }));
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
