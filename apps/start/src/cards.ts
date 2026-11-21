import { workspaceLink } from "@suite/contracts";
import { APP_ICONS } from "./appIcons.js";
import { type CatalogueApp, isNewer, SELF_ID } from "./catalogue.js";
import {
  isPreReleaseId,
  PRE_RELEASE_TIERS,
  type PreReleaseTier,
  preReleaseNotice,
  type ReleaseTier,
  tierForInstall,
  tierFromBranch,
} from "./channels.js";
import type { IndexedFile } from "./fileIndex.js";
import { commitsMatch } from "./flatpak.js";
import type { StoreChannel } from "./packageBackend.js";
import type { RecentEntry } from "./recents.js";
import type { DiscoveredApp, RejectedInstall } from "./registry.js";
import { packageSource } from "./registry.js";
import { type ReportedUpdate, UNREPORTED } from "./reportedUpdate.js";
import type { AppCard, AppCardState, FileCard } from "./shared.js";

/**
 * One card per app the suite offers, one per app it does not know, and one per
 * install that cannot be used.
 *
 * A card used to exist only for what discovery found, which made a new machine an
 * empty window — the one answer a front door cannot give. So the catalogue decides
 * which cards exist, and discovery decides what each one says about being installed.
 *
 * A refused install is still a card rather than a second list, because the question a
 * person asks is "what do I have?", and "an app that will not start" belongs in the
 * answer. What is wrong with it is a line on the card, and a card with no launch button
 * is honest where a dead button is not.
 */
export interface CardInput {
  readonly apps: readonly DiscoveredApp[];
  readonly rejected: readonly RejectedInstall[];
  readonly files: readonly IndexedFile[];
  readonly recents: readonly RecentEntry[];
  /** What each app reported about its own updating, by app id. */
  readonly updates: ReadonlyMap<string, ReportedUpdate>;
  /** What the suite offers, installed or not. The hub's own row is not a card. */
  readonly catalogue: readonly CatalogueApp[];
  /** How many version directories each app has on disk, by app id. */
  readonly versions: ReadonlyMap<string, number>;
  /** The version a rollback would return to, by app id, when one is on disk. */
  readonly previous?: ReadonlyMap<string, string | null> | undefined;
  /** Which apps Start started and has not seen exit, by app id. */
  readonly running: ReadonlySet<string>;
  /** Where Start installs. An app under it is Start's to manage, whoever asked first. */
  readonly appsRoot: string;
  /**
   * What the store offers, by app id: the commit `suite-local` publishes.
   *
   * Absent when the store has not been read (no Flatpak, no remote, or the
   * window has not opened yet), which is why the card treats it as "no
   * information" rather than "nothing available".
   */
  readonly store?: ReadonlyMap<string, string> | undefined;
  /**
   * The tier branches the store publishes for a pre-release id.
   *
   * A pre-release card uses this to offer a switch and to know whether the branch
   * that is installed has a newer commit. Absent means "no information".
   */
  readonly storeChannels?: ReadonlyMap<string, readonly StoreChannel[]> | undefined;
}

/** The folder name a refused install is known by. */
function nameFor(path: string): string {
  const segments = path.split(/[\\/]+/u).filter((segment) => segment.length > 0);
  const last = segments.at(-1);
  const parent = segments.at(-2);
  if (last === "suite.app.json" && parent !== undefined) return parent;
  return last ?? path;
}

/**
 * What one entry can offer, given what this machine actually has.
 *
 * The installed version comes from discovery rather than from the catalogue: discovery is
 * what read the disk, and a catalogue that remembered an install after it was removed
 * would put "up to date" on a card with no version at all.
 *
 * A store that offers the app is enough to make "not installed yet" true even when
 * no AppImage feed answered: the Install button works through Flatpak, so calling the
 * card "no release found" would hide the one channel that can install it.
 */
function stateFor(
  installedVersion: string | null,
  available: string | null,
  installChannel: "appimage" | "flatpak" = "appimage",
): AppCardState {
  if (installedVersion === null) {
    return available !== null || installChannel === "flatpak" ? "not-installed" : "no-release";
  }
  if (available === null) return "no-release";
  return isNewer(available, installedVersion) ? "update-available" : "current";
}

export function appCards(input: CardInput): readonly AppCard[] {
  const refused: AppCard[] = input.rejected.map((install) => ({
    id: install.id ?? null,
    name: nameFor(install.path),
    source: "folder",
    installChannel: "appimage",
    icon: install.id === undefined ? null : (APP_ICONS[install.id] ?? null),
    state: "refused",
    version: null,
    available: null,
    reason: install.reason,
    versions: 0,
    previousVersion: null,
    running: false,
    releases: null,
    channel: "stable",
    tier: "stable",
    switchTier: null,
    channelNotice: null,
    update: UNREPORTED,
    executable: null,
    fileExtensions: [],
    lastOpenedAt: null,
    fileCount: 0,
    health: { ok: false, reason: install.reason },
  }));

  const byId = new Map(input.apps.map((app) => [app.manifest.id, app]));

  const offered: AppCard[] = input.catalogue
    .filter((entry) => entry.id !== SELF_ID)
    .flatMap((entry): AppCard[] => {
      const found = byId.get(entry.id) ?? null;
      byId.delete(entry.id);
      const isPre = entry.preRelease === true || isPreReleaseId(entry.id);
      const storeChannels = input.storeChannels?.get(entry.id) ?? [];
      const storeCommit = input.store?.get(entry.id) ?? null;

      // A pre-release card exists when its id exists on this machine or in the
      // store. A machine with neither still gets only the stable card, as before.
      if (isPre && found === null && storeChannels.length === 0 && storeCommit === null) {
        return [];
      }

      // A Flatpak answers to its remote, not to the AppImage feed. Saying
      // "newer version available" from a feed this install cannot read would
      // offer an Update button that installs a second copy in another format.
      const fromFlatpak = found?.flatpak !== undefined;
      const flatpakOnly = entry.flatpakOnly === true;
      const installChannel: "appimage" | "flatpak" =
        flatpakOnly || fromFlatpak || storeCommit !== null || storeChannels.length > 0
          ? "flatpak"
          : "appimage";
      const source = found === null ? "managed" : packageSource(found, input.appsRoot);

      const installedBranch = tierFromBranch(found?.flatpak?.branch);
      const tier: ReleaseTier = isPre
        ? tierForInstall({
            id: entry.id,
            branch: found?.flatpak?.branch,
            channel: found?.manifest.update?.channel ?? entry.channel,
          })
        : "stable";
      const branchOffer =
        installedBranch === null
          ? null
          : (storeChannels.find((candidate) => candidate.tier === installedBranch) ?? null);
      const flatpakUpdate =
        fromFlatpak &&
        found?.flatpak?.commit !== undefined &&
        (installedBranch !== null
          ? branchOffer !== null && !commitsMatch(found.flatpak.commit, branchOffer.commit)
          : storeCommit !== null && !commitsMatch(found.flatpak.commit, storeCommit));

      // One pre-release id, so a second branch is never a second install. The card
      // offers the other branch as a switch; the backend replaces the deployment.
      const switchTier: PreReleaseTier | null =
        isPre && installedBranch !== null
          ? (PRE_RELEASE_TIERS.find(
              (candidate) =>
                candidate !== installedBranch &&
                storeChannels.some((offer) => offer.tier === candidate),
            ) ?? null)
          : null;

      return [
        {
          id: entry.id,
          name: found?.manifest.name ?? entry.name,
          source,
          installChannel,
          icon: APP_ICONS[entry.id] ?? null,
          state: fromFlatpak
            ? flatpakUpdate
              ? "update-available"
              : "current"
            : source === "folder"
              ? // A copy a person placed is not Start's to replace. Reading the hub's feed
                // into its state would offer an Update that installs a second copy.
                "local"
              : stateFor(
                  found?.manifest.version ?? null,
                  flatpakOnly ? null : entry.available,
                  installChannel,
                ),
          version: found?.manifest.version ?? null,
          available: flatpakOnly ? null : fromFlatpak ? null : entry.available,
          reason: flatpakOnly ? null : fromFlatpak ? null : entry.reason,
          versions: fromFlatpak ? 1 : (input.versions.get(entry.id) ?? (found === null ? 0 : 1)),
          previousVersion: fromFlatpak ? null : (input.previous?.get(entry.id) ?? null),
          running: input.running.has(entry.id),
          releases: fromFlatpak ? null : (entry.releases ?? null),
          channel: found?.manifest.update?.channel ?? entry.channel,
          tier,
          switchTier,
          channelNotice:
            isPre && tier !== "stable"
              ? preReleaseNotice(tier as PreReleaseTier, switchTier)
              : null,
          update: input.updates.get(entry.id) ?? UNREPORTED,
          executable: found?.executable ?? null,
          fileExtensions: found?.manifest.fileExtensions ?? entry.extensions,
          lastOpenedAt: input.recents.find((row) => row.appId === entry.id)?.openedAt ?? null,
          fileCount: input.files.filter((file) => file.appId === entry.id).length,
          health: { ok: true },
        },
      ];
    });

  // Discovery found an app the catalogue does not name — either a copy this person placed
  // (D44 makes it first-class) or a managed install whose feed has not answered yet. Only
  // the first is "from a folder"; the second is Start's, and says so.
  const local: AppCard[] = [...byId.values()].map((entry) => {
    const source = packageSource(entry, input.appsRoot);
    return {
      id: entry.manifest.id,
      name: entry.manifest.name,
      source,
      installChannel: "appimage",
      icon: APP_ICONS[entry.manifest.id] ?? null,
      state: source === "folder" ? "local" : source === "flatpak" ? "current" : "no-release",
      version: entry.manifest.version,
      available: null,
      reason: source === "managed" ? "its release feed has not been read yet" : null,
      versions: source === "flatpak" ? 1 : (input.versions.get(entry.manifest.id) ?? 1),
      previousVersion: input.previous?.get(entry.manifest.id) ?? null,
      running: input.running.has(entry.manifest.id),
      releases: null,
      channel: entry.manifest.update?.channel ?? "stable",
      tier: isPreReleaseId(entry.manifest.id)
        ? tierForInstall({
            id: entry.manifest.id,
            branch: entry.flatpak?.branch,
            channel: entry.channel ?? entry.manifest.update?.channel,
          })
        : "stable",
      switchTier: null,
      channelNotice: isPreReleaseId(entry.manifest.id)
        ? preReleaseNotice(
            tierForInstall({
              id: entry.manifest.id,
              branch: entry.flatpak?.branch,
              channel: entry.channel ?? entry.manifest.update?.channel,
            }) as PreReleaseTier,
          )
        : null,
      update: input.updates.get(entry.manifest.id) ?? UNREPORTED,
      executable: entry.executable,
      fileExtensions: entry.manifest.fileExtensions,
      lastOpenedAt: input.recents.find((row) => row.appId === entry.manifest.id)?.openedAt ?? null,
      fileCount: input.files.filter((file) => file.appId === entry.manifest.id).length,
      health: { ok: true },
    };
  });

  return [...refused, ...offered, ...local];
}

/** How Flatpak, when it is the writer of this hub, is asked to replace it. */
export interface SelfCardOptions {
  /** True when Flatpak deployed this Start, so Flatpak is its update channel. */
  readonly flatpak?: boolean;
  /**
   * Whether the update action exists.
   *
   * A Flatpak whose application id is Start's own may ask Flatpak for the newest
   * build. Any other id has no deployment this process may name, so it keeps the
   * fact and loses the button rather than offering one that would fail.
   */
  readonly canUpdate?: boolean;
  /** True after Flatpak reported a successful update; the new build is not running yet. */
  readonly updated?: boolean;
  /** What Flatpak said when the update failed, when it did. */
  readonly error?: string | null;
}

/**
 * The hub's own row: a fact rather than a button.
 *
 * Start cannot replace its own running binary, so the row says what version it is
 * running and what its feed offers, and offers nothing to press. The one exception
 * is a Flatpak deployment: Flatpak is the writer there, so the row can ask it for
 * the newest build and say that the result arrives at the next launch.
 */
export function selfCard(
  entry: CatalogueApp,
  version: string,
  options: SelfCardOptions = {},
): AppCard {
  if (options.flatpak === true) {
    const canUpdate = options.canUpdate === true;
    return {
      id: SELF_ID,
      name: entry.name,
      source: "flatpak",
      installChannel: "flatpak",
      icon: null,
      // "update-available" is the renderer's word for "there is something to press",
      // not a claim that a newer version was found: Flatpak was not asked.
      state: canUpdate ? "update-available" : "no-release",
      version,
      available: null,
      reason:
        options.error ??
        (options.updated === true
          ? "Flatpak deployed the newest build; it starts next launch"
          : "not checked (Flatpak)"),
      versions: 1,
      previousVersion: null,
      running: false,
      releases: null,
      channel: entry.channel,
      tier: "stable",
      switchTier: null,
      channelNotice: null,
      update: UNREPORTED,
      executable: null,
      fileExtensions: [],
      lastOpenedAt: null,
      fileCount: 0,
      health: { ok: true },
    };
  }

  return {
    id: SELF_ID,
    name: entry.name,
    source: "managed",
    installChannel: "appimage",
    icon: null,
    state:
      entry.available === null
        ? "no-release"
        : isNewer(entry.available, version)
          ? "update-available"
          : "current",
    version,
    available: entry.available,
    reason: entry.reason,
    versions: 1,
    previousVersion: null,
    running: false,
    releases: entry.releases ?? null,
    channel: entry.channel,
    tier: "stable",
    switchTier: null,
    channelNotice: null,
    update: UNREPORTED,
    executable: null,
    fileExtensions: [],
    lastOpenedAt: null,
    fileCount: 0,
    health: { ok: true },
  };
}

/** How many cards carry a reason; the number the rail shows. */
export function attentionCount(cards: readonly AppCard[]): number {
  return cards.filter((card) => !card.health.ok).length;
}

/**
 * One row per indexed document, with the link that opens it.
 *
 * The link is built here rather than in the renderer so the shape has exactly one
 * author — `workspaceLink` in the contract — and so the hub cannot invent a link
 * an app would refuse. A name the builder refuses carries no link, and the row
 * simply does not offer one.
 */
export function fileCards(files: readonly IndexedFile[]): readonly FileCard[] {
  return files.map((file) => ({
    path: file.path,
    name: file.name,
    appId: file.appId,
    appName: file.appName,
    folder: file.folder,
    modifiedAt: file.modifiedAt,
    installed: file.installed,
    link: workspaceLink(file.appId, file.name),
  }));
}
