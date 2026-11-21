import { dirname, join, resolve, sep } from "node:path";
import type { SuiteReleaseChannel } from "@suite/contracts";

/**
 * The channel vocabulary Start uses, and the rules that keep stable and a
 * pre-release from being confused.
 *
 * The tier model is product-wide ([docs/explanation/channels.md](../../../docs/explanation/channels.md)).
 * Start consumes it rather than inventing a second one:
 *
 * - stable is the id `run.suite.<app>` / `<app>`;
 * - every pre-release tier shares the id `run.suite.slop.<app>` / `slop-<app>`;
 * - the Flatpak ref branch (`slop`, `canary`, `beta`) names the tier.
 *
 * One pre-release id means one pre-release install. Two cards never means two
 * `run.suite.slop.<app>` deployments.
 */

/** Every tier a card can name. */
export const RELEASE_TIERS = ["stable", "slop", "canary", "beta"] as const;
export type ReleaseTier = (typeof RELEASE_TIERS)[number];

/** The tiers that share the pre-release id, in promotion order. */
export const PRE_RELEASE_TIERS = ["slop", "canary", "beta"] as const;
export type PreReleaseTier = (typeof PRE_RELEASE_TIERS)[number];

/**
 * The pre-release id prefix. It is an id, not a label, so it is lower-case.
 *
 * The hyphen is canonical: it is the id the release script writes into a
 * pre-release `suite.app.json`, and the form the manifest id schema accepts.
 */
export const PRE_RELEASE_ID_PREFIX = "slop-";

/**
 * The prefix earlier pre-release builds wrote: `slop.<app>`.
 *
 * It is still read because a manifest installed before the id became canonical
 * is not rewritten in place. Classifying one as stable would hand that build the
 * stable documents folder, which is exactly what the pre-release id exists to
 * prevent. Nothing generates this form any more.
 */
export const LEGACY_PRE_RELEASE_ID_PREFIX = "slop.";

/** The channel a package came from, as the package backend records it. */
export type PackageChannel = SuiteReleaseChannel | PreReleaseTier;

/** The pre-release id for one app: `slop-<app>`. */
export function preReleaseIdFor(appId: string): string {
  return `${PRE_RELEASE_ID_PREFIX}${appId}`;
}

/** The matched prefix of a pre-release id, current or legacy, or null. */
function preReleasePrefixOf(id: string): string | null {
  for (const prefix of [PRE_RELEASE_ID_PREFIX, LEGACY_PRE_RELEASE_ID_PREFIX]) {
    if (id.startsWith(prefix) && id.length > prefix.length) return prefix;
  }
  return null;
}

/** Whether an app id belongs to the one pre-release identity, in either form. */
export function isPreReleaseId(id: string): boolean {
  return preReleasePrefixOf(id) !== null;
}

/** The stable app id behind a pre-release id, or the id itself when it is stable. */
export function appIdFor(id: string): string {
  const prefix = preReleasePrefixOf(id);
  return prefix === null ? id : id.slice(prefix.length);
}

/** Whether a Flatpak branch names a pre-release tier. */
export function isPreReleaseTier(value: unknown): value is PreReleaseTier {
  return typeof value === "string" && (PRE_RELEASE_TIERS as readonly string[]).includes(value);
}

/** The tier a Flatpak ref branch names, or null for a stable/default branch. */
export function tierFromBranch(branch: string | null | undefined): PreReleaseTier | null {
  return isPreReleaseTier(branch) ? branch : null;
}

/** Whether a stored or requested channel is one Start knows. */
export function isPackageChannel(value: unknown): value is PackageChannel {
  return value === "stable" || value === "alpha" || value === "beta" || isPreReleaseTier(value);
}

/**
 * The tier a manifest's channel names.
 *
 * `update.channel` is a feed channel, not a build identity, so this is only a
 * fallback when no ref branch can answer. `alpha` is the old stable build's feed
 * label and maps to the earliest pre-release tier; a build with no identity is
 * stable.
 */
export function tierFromChannel(
  channel: string | null | undefined,
  fallback: ReleaseTier = "stable",
): ReleaseTier {
  if (channel === "stable") return "stable";
  if (channel === "alpha" || channel === "slop") return "slop";
  if (channel === "canary") return "canary";
  if (channel === "beta") return "beta";
  return fallback;
}

/** The tier to name for an installed package. */
export function tierForInstall(input: {
  readonly id: string;
  readonly branch?: string | null | undefined;
  readonly channel?: string | null | undefined;
}): ReleaseTier {
  if (!isPreReleaseId(input.id)) return "stable";
  return tierFromBranch(input.branch) ?? tierFromChannel(input.channel ?? null, "slop");
}

/**
 * The sentence a pre-release card carries.
 *
 * A badge is not a warning: the card says, in words, what the tier promises and
 * where removal leaves the data. When a switch is offered, it also says that the
 * install stays and the data folder is the one that moves.
 */
export function preReleaseNotice(
  tier: PreReleaseTier,
  switchTo: PreReleaseTier | null = null,
): string {
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  const switching =
    switchTo === null
      ? ""
      : ` Switching to ${switchTo} keeps this install and changes its data folder to ${switchTo}; stable is untouched.`;
  return (
    `${label} is a pre-release tier: it may be broken, incomplete, or change shape without ` +
    `notice. Its data folder is separate from stable and from every other tier; uninstalling ` +
    `asks before deleting it.${switching}`
  );
}

/** Where the pre-release documents and machine data live, a sibling of `Documents/Suite`. */
export const PRE_RELEASE_DOCUMENTS_FOLDER = "Suite Slop";

/**
 * The pre-release data folder for one app.
 *
 * The build owns the folder under `Suite Slop`; Start only needs its path to ask
 * before removal, so this mirrors the convention the apps use rather than keeping
 * a second one.
 */
export function preReleaseDataDirectory(documentsSuiteRoot: string, folder: string): string {
  return join(dirname(documentsSuiteRoot), PRE_RELEASE_DOCUMENTS_FOLDER, folder);
}

/** Whether `path` is really inside the pre-release data tree, before it is deleted. */
export function isPreReleaseDataPath(documentsSuiteRoot: string, path: string): boolean {
  const root = resolve(dirname(documentsSuiteRoot), PRE_RELEASE_DOCUMENTS_FOLDER);
  const target = resolve(path);
  return target.startsWith(`${root}${sep}`);
}

/** What the confirmation dialog says, so the copy has one author and a test. */
export interface RemovalCopy {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
}

/**
 * Removal copy for a pre-release.
 *
 * It names the format, so a Flatpak deployment and a managed folder are not
 * described as the same thing, and it names the separate data path. The dialog
 * offers keeping the data as a distinct answer rather than burying it in one
 * destructive button.
 */
export function preReleaseRemovalCopy(input: {
  readonly name: string;
  readonly tier: ReleaseTier;
  readonly dataDirectory: string;
  readonly flatpak?: { readonly application: string; readonly installation: string } | undefined;
}): RemovalCopy {
  const removed =
    input.flatpak === undefined
      ? "This deletes the version folders, menu entry and install record Start placed."
      : `This asks Flatpak to remove ${input.flatpak.application} from the ${input.flatpak.installation} installation.`;
  return {
    message: `Uninstall ${input.name} (${input.tier})?`,
    detail:
      `${removed} The ${input.tier} channel's data is separate, at ${input.dataDirectory}. ` +
      "Stable documents are never touched. Choose whether to delete the channel's data too.",
    buttons: ["Cancel", "Uninstall, keep data", "Uninstall and delete data"],
  };
}
