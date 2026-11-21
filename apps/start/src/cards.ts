import { workspaceLink } from "@suite/contracts";
import { APP_ICONS } from "./appIcons.js";
import { type CatalogueApp, SELF_ID } from "./catalogue.js";
import {
  appIdFor,
  isPreReleaseId,
  PRE_RELEASE_TIERS,
  type PreReleaseTier,
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
import type { AppCard, AppCardState, FileCard } from "./shared.js";

/**
 * One card per app the suite offers, one per app it does not know, and one per
 * install that cannot be used.
 *
 * A card used to exist only for what discovery found, which made a new machine an
 * empty window — the one answer a front door cannot give. So the catalogue decides
 * which cards exist, and discovery decides what each one says about being installed.
 *
 * Linux desktop apps ship as Flatpaks. A card therefore compares the deployment's
 * commit with the commit its own origin offers; a copy in a folder is opened and
 * forgotten, never downloaded or updated.
 */
export interface CardInput {
  readonly apps: readonly DiscoveredApp[];
  readonly rejected: readonly RejectedInstall[];
  readonly files: readonly IndexedFile[];
  readonly recents: readonly RecentEntry[];
  /** What the suite offers, installed or not. The hub's own row is not a card. */
  readonly catalogue: readonly CatalogueApp[];
  /** Which apps Start started and has not seen exit, by app id. */
  readonly running: ReadonlySet<string>;
  /**
   * What the store offers, by app id: the commit the app's origin publishes.
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
 * The mark an app carries, including when the card names the pre-release identity.
 *
 * A pre-release card's id is `slop-<app>` (or the older `slop.<app>`), and the
 * artwork belongs to the stable app it previews. Mapping the id back is what keeps
 * the card recognisable instead of falling back to no mark at all.
 */
function iconFor(id: string): string | null {
  return APP_ICONS[appIdFor(id)] ?? null;
}

export function appCards(input: CardInput): readonly AppCard[] {
  const refused: AppCard[] = input.rejected.map((install) => ({
    id: install.id ?? null,
    name: nameFor(install.path),
    source: "folder",
    icon: install.id === undefined ? null : iconFor(install.id),
    state: "refused",
    version: null,
    reason: install.reason,
    running: false,
    channel: "stable",
    tier: "stable",
    switchTier: null,
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
      const inStore = storeCommit !== null || storeChannels.length > 0;

      // A pre-release card exists when its id exists on this machine or in the
      // store. A machine with neither still gets only the stable card.
      if (isPre && found === null && !inStore) return [];

      const fromFlatpak = found?.flatpak !== undefined;
      const source = found === null ? "folder" : packageSource(found);

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

      const state: AppCardState = fromFlatpak
        ? flatpakUpdate
          ? "update-available"
          : "current"
        : found !== null
          ? // A copy in a folder is not Start's to replace.
            "local"
          : inStore
            ? "not-installed"
            : "no-release";

      return [
        {
          id: entry.id,
          name: found?.manifest.name ?? entry.name,
          source,
          icon: iconFor(entry.id),
          state,
          version: found?.manifest.version ?? null,
          reason: state === "no-release" ? "the store does not offer this app" : null,
          running: input.running.has(entry.id),
          channel: found?.manifest.update?.channel ?? entry.channel,
          tier,
          switchTier,
          executable: found?.executable ?? null,
          fileExtensions: found?.manifest.fileExtensions ?? entry.extensions,
          lastOpenedAt: input.recents.find((row) => row.appId === entry.id)?.openedAt ?? null,
          fileCount: input.files.filter((file) => file.appId === entry.id).length,
          health: { ok: true },
        },
      ];
    });

  // Discovery found an app the catalogue does not name: a copy this person placed
  // (D44 makes it first-class). It has no store entry, so it says so.
  const local: AppCard[] = [...byId.values()].map((entry) => {
    const source = packageSource(entry);
    return {
      id: entry.manifest.id,
      name: entry.manifest.name,
      source,
      icon: iconFor(entry.manifest.id),
      state: source === "flatpak" ? "current" : "local",
      version: entry.manifest.version,
      reason: null,
      running: input.running.has(entry.manifest.id),
      channel: entry.manifest.update?.channel ?? "stable",
      tier: isPreReleaseId(entry.manifest.id)
        ? tierForInstall({
            id: entry.manifest.id,
            branch: entry.flatpak?.branch,
            channel: entry.channel ?? entry.manifest.update?.channel,
          })
        : "stable",
      switchTier: null,
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
   * Whether the deployment's own origin publishes a different commit.
   *
   * True only after both commits were read and compared. Any other id, a copy
   * Flatpak does not own, and a failed check all lose the button rather than
   * offering one that would fail or claiming an update nobody found.
   */
  readonly canUpdate?: boolean;
  /**
   * Whether the origin answered.
   *
   * This is the difference between "Flatpak reports the newest build is
   * installed" and "not checked"; neither offers a button.
   */
  readonly checked?: boolean;
  /** True after Flatpak reported a successful update; the new build is not running yet. */
  readonly updated?: boolean;
  /** What Flatpak said when the update failed, when it did. */
  readonly error?: string | null;
}

/**
 * The hub's own row: a fact rather than a button.
 *
 * A Flatpak deployment has a writer: Flatpak owns it, so the row can ask for the
 * newest build and say that the result arrives at the next launch. Any other
 * build cannot replace its own running binary.
 */
export function selfCard(
  entry: CatalogueApp,
  version: string,
  options: SelfCardOptions = {},
): AppCard {
  if (options.flatpak === true) {
    // A successful update is the newest word even when a cached comparison still
    // saw the old commit: the next launch is what this row is waiting for now.
    const canUpdate = options.canUpdate === true && options.updated !== true;
    return {
      id: SELF_ID,
      name: entry.name,
      source: "flatpak",
      icon: null,
      // "update-available" is the renderer's word for "there is something to press".
      // It is set only for a commit the origin really publishes.
      state: canUpdate ? "update-available" : "current",
      version,
      reason:
        options.updated === true
          ? "Flatpak deployed the newest build; it starts next launch"
          : (options.error ??
            (canUpdate
              ? "Flatpak reports a newer build is available"
              : options.checked === true
                ? "Flatpak reports the newest build is installed"
                : "not checked (Flatpak)")),
      running: false,
      channel: entry.channel,
      tier: "stable",
      switchTier: null,
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
    source: "folder",
    icon: null,
    state: "current",
    version,
    reason: null,
    running: false,
    channel: entry.channel,
    tier: "stable",
    switchTier: null,
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
