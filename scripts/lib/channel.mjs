/**
 * The channel identities shared by the release and Flatpak paths.
 *
 * Stable keeps the id a shipped install already has. A pre-release shares one
 * id across the slop, canary and beta tiers, so a machine can hold stable and
 * one pre-release side by side, and moving tier replaces the pre-release rather
 * than adding a third install. The tier is the branch; the id stays put.
 *
 * Pure string work lives here so both scripts describe the same identity and a
 * test can prove the desktop entry registers no MIME type or scheme handler.
 */

/** The released channel, and the one whose id predates the tiers. */
export const STABLE_CHANNEL = "stable";

/** Pre-release tiers, in promotion order. */
export const PRE_RELEASE_CHANNELS = ["slop", "canary", "beta"];

/** Every channel the scripts accept. */
export const CHANNELS = [STABLE_CHANNEL, ...PRE_RELEASE_CHANNELS];

/** True when this channel is one of the pre-release tiers. */
export function isPreRelease(channel) {
  return PRE_RELEASE_CHANNELS.includes(channel);
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

/** The `suite.app.json` id for one app on one channel. */
export function suiteAppId(app, channel) {
  return isPreRelease(channel) ? `slop-${app}` : app;
}

/** The name a person reads, which names the pre-release tier. */
export function displayName(name, channel) {
  return isPreRelease(channel) ? `${name} (${channel})` : name;
}

/**
 * The OSTree branch the channel publishes on.
 *
 * Stable still uses `master`, which is what the existing `suite-local` remote
 * carries. A tier uses its own name, so the branch and the tier cannot drift.
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
 * The build-time field that names the tier.
 *
 * `suite.app.json` deliberately stays inside the contract every installed
 * build already parses; the tier is a build fact, so it rides beside it.
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
 * No `MimeType` and no `x-scheme-handler/*` line: a tier must not claim the
 * stable documents or the suite link. `NoDisplay=false` keeps the card visible
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
