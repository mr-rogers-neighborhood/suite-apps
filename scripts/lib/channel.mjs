/**
 * The channel identities shared by the release and Flatpak paths.
 *
 * Stable keeps the id a shipped install already has. A pre-release shares one
 * id across the slop, nightly and preview channels, so a machine can hold stable
 * and one pre-release side by side, and moving channel replaces the pre-release
 * rather than adding a third install. The channel is the branch; the id stays
 * put. `canary` and `beta` were the old names and are refused rather than
 * silently aliased, so a stale command fails where it is typed.
 *
 * Pure string work lives here so both scripts describe the same identity and a
 * test can prove the desktop entry registers no MIME type or scheme handler.
 */

/** The released channel, and the one whose id predates the channels. */
export const STABLE_CHANNEL = "stable";

/** Pre-release channels, in promotion order. */
export const PRE_RELEASE_CHANNELS = ["slop", "nightly", "preview"];

/** Every channel the scripts accept. */
export const CHANNELS = [STABLE_CHANNEL, ...PRE_RELEASE_CHANNELS];

/**
 * The legacy mini-apps, frozen until they become packs.
 *
 * Their code and last artifacts stay, and a person can still install the last
 * stable ref. They get no new release and no new pre-release build; the
 * superapp carries the channel. One list is read by the release table and by
 * the Flatpak builder, so a fold here closes every path at once.
 */
export const LEGACY_FROZEN_IDS = ["canvas", "planner", "budget", "help"];

/** True when this channel is one of the pre-release channels. */
export function isPreRelease(channel) {
  return PRE_RELEASE_CHANNELS.includes(channel);
}

/**
 * Why this app cannot build on this channel, or null.
 *
 * A frozen legacy app has no pre-release identity to publish. The factory's
 * `slop` build is a session channel rather than a shipped one, so an explicit
 * `session` request may still build one; every other path is refused before a
 * manifest is written.
 */
export function channelProblemForApp(app, channel, { session = false } = {}) {
  if (!isPreRelease(channel) || session) return null;
  if (!LEGACY_FROZEN_IDS.includes(app)) return null;
  return (
    `${app} is frozen as a legacy mini-app: it gets no new pre-release build. ` +
    "The last stable ref is its release, and the superapp carries the channel. " +
    "A factory session build may pass --session; it is local and never published."
  );
}

/**
 * Why this channel cannot be used, or null.
 *
 * The value comes from argv, so an unknown name is refused before a build or a
 * commit rather than being written into an id.
 */
export function channelProblem(channel) {
  if (CHANNELS.includes(channel)) return null;
  return `unknown channel ${JSON.stringify(channel)}; known: ${CHANNELS.join(", ")}`;
}

/** The Flatpak application id for one app on one channel. */
export function flatpakId(app, channel) {
  if (!isPreRelease(channel) && channel !== STABLE_CHANNEL) {
    throw new Error(channelProblem(channel) ?? "unknown channel");
  }
  return isPreRelease(channel) ? `run.suite.slop.${app}` : `run.suite.${app}`;
}

/**
 * The `suite.app.json` id for one app on one channel.
 *
 * A pre-release id is `slop-<app>` with a hyphen: that is the canonical manifest
 * id, and the one every app classifies as a pre-release. The Flatpak id is a
 * different field and keeps its dots (`run.suite.slop.<app>`); the branch names
 * the channel. Do not change this to the dot form an early build wrote — that form
 * is read for compatibility, never written.
 */
export function suiteAppId(app, channel) {
  return isPreRelease(channel) ? `slop-${app}` : app;
}

/** The name a person reads, which names the pre-release channel. */
export function displayName(name, channel) {
  return isPreRelease(channel) ? `${name} (${channel})` : name;
}

/**
 * The OSTree branch the channel publishes on.
 *
 * Stable still uses `master`, which is what the existing `suite-local` remote
 * carries. A pre-release channel uses its own name, so the branch and the
 * channel cannot drift.
 */
export function branchFor(channel) {
  return isPreRelease(channel) ? channel : "master";
}

/** The release tag for one app on one channel. */
export function releaseTag(appId, version, channel = STABLE_CHANNEL) {
  return isPreRelease(channel)
    ? `${channel}-${appId}-v${version}`
    : `${appId}-v${version}`;
}

/** The artifact stem, distinct per channel so two tags cannot collide locally. */
export function artifactStem(appId, channel = STABLE_CHANNEL) {
  return isPreRelease(channel) ? `suite-${appId}-${channel}` : `suite-${appId}`;
}

/**
 * The manifest a pre-release ships: a distinct id and no file association.
 *
 * `update` is removed rather than pointed at the stable feed: a pre-release is
 * not offered stable as an automatic update. The approach that a pre-release
 * is another build of the same app belongs in the channel record beside it.
 */
export function preReleaseAppManifest(base, channel) {
  if (!isPreRelease(channel)) {
    throw new Error(`preReleaseAppManifest needs a pre-release channel, not ${channel}`);
  }
  const id = suiteAppId(base.id, channel);
  const manifest = {
    format: base.format,
    id,
    name: displayName(base.name, channel),
    version: base.version,
    deepLinkPrefix: `suite://${id}/`,
    fileExtensions: [],
  };
  if (base.contractVersion !== undefined) manifest.contractVersion = base.contractVersion;
  if (base.capabilities !== undefined) manifest.capabilities = base.capabilities;
  if (base.minHubVersion !== undefined) manifest.minHubVersion = base.minHubVersion;
  return manifest;
}

/**
 * The build-time field that names the channel.
 *
 * `suite.app.json` deliberately stays inside the contract every installed
 * build already parses; the channel is a build fact, so it rides beside it.
 */
export function channelRecord({ app, channel }) {
  if (!isPreRelease(channel)) {
    throw new Error(`channelRecord needs a pre-release channel, not ${channel}`);
  }
  return {
    format: "suite.channel",
    app,
    channel,
    id: flatpakId(app, channel),
    stableId: flatpakId(app, STABLE_CHANNEL),
    branch: branchFor(channel),
  };
}

/**
 * The pre-release desktop entry.
 *
 * No `MimeType` and no `x-scheme-handler/*` line: a pre-release channel must not
 * claim the stable documents or the suite link. `NoDisplay=false` keeps the card visible
 * beside stable, and the icon name is the app id so a taskbar can find it.
 */
export function desktopEntry({
  id,
  name,
  comment,
  categories = "Office;",
  startupClass = id,
}) {
  return [
    "[Desktop Entry]",
    `Name=${name}`,
    `Comment=${comment}`,
    `Exec=${id} %U`,
    `Icon=${id}`,
    "Terminal=false",
    "Type=Application",
    `Categories=${categories}`,
    "NoDisplay=false",
    `StartupWMClass=${startupClass}`,
    "",
  ].join("\n");
}

/** The wrapper Flatpak runs; the app's own binary is unchanged. */
export function launcherScript({ id, folder, binary }) {
  return [
    "#!/bin/sh",
    `# ${id}: the pre-release launcher. The binary is the same build stable runs.`,
    `exec zypak-wrapper.sh /app/${folder}/${binary} "$@"`,
    "",
  ].join("\n");
}

/** Rewrite a stable AppStream record for the pre-release id. */
export function preReleaseMetainfo(text, { stableId, id, name }) {
  return text
    .replace(new RegExp(`<id>${escapeRegExp(stableId)}</id>`, "gu"), `<id>${id}</id>`)
    .replace(/<name>[^<]*<\/name>/u, `<name>${name}</name>`)
    .replace(
      new RegExp(`(<launchable type="desktop-id">)${escapeRegExp(stableId)}`, "gu"),
      `$1${id}`,
    );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
