import type { CatalogueEntry } from "./catalogue.js";
import type { PackageChannel, ReleaseTier } from "./channels.js";
import type { DiscoveredApp, FlatpakInstall, RejectedInstall } from "./registry.js";
import type { AppSource } from "./shared.js";

/**
 * The one way Start reads or changes an installed package.
 *
 * Linux desktop apps ship as Flatpaks. Start's sandbox has no `flatpak` binary of
 * its own, so it asks a host agent over D-Bus for every operation. The window must
 * not learn a second way to list, install or start an app for that to be a
 * transport swap rather than a second implementation. So every operation below is
 * a method on a backend, and the native one is the only place that spawns anything.
 *
 * The data is the model Start already has: `DiscoveredApp` keeps the manifest, the
 * record's executable and the Flatpak identity; `InstallRecord` and `FlatpakInstall`
 * are what discovery and Flatpak produce. A backend adapts them, never replaces them.
 */

/**
 * The release channel a package came from.
 *
 * Kept on the record and the request so a backend can answer "where did this
 * come from?" and "where should this go?" without the window knowing a channel.
 */
export type { PackageChannel } from "./channels.js";

/**
 * One build a store publishes for a pre-release id.
 *
 * The id is shared by `slop`, `canary` and `beta`; the branch is the tier. Start
 * reads all of them at once so it can offer a switch instead of a second install.
 */
export interface StoreChannel {
  readonly tier: ReleaseTier;
  readonly branch: string;
  readonly commit: string;
}

/** One installed app, with who owns its files and the channel it came from. */
export interface InstalledPackage {
  /** What discovery found, unchanged: manifest, executable, Flatpak identity. */
  readonly app: DiscoveredApp;
  /** Who may replace the files. The same names the cards use. */
  readonly ownership: AppSource;
  /** The channel this install came from: stable, or the pre-release tier. */
  readonly channel: PackageChannel;
}

/** What one backend can see on this machine right now. */
export interface PackageListing {
  readonly packages: readonly InstalledPackage[];
  /** Installs that exist but cannot be launched, so a card can say why. */
  readonly rejected: readonly RejectedInstall[];
  /**
   * The Flatpak commit each catalogue app's store offers, by app id.
   *
   * An installed app is compared with its own origin; an app that is not
   * installed is compared with the store a fresh install would use.
   */
  readonly offers: ReadonlyMap<string, string>;
  /**
   * Every tier branch the store publishes for a pre-release id.
   *
   * Keyed by the pre-release id (`slop-<app>`), because the id is shared and the
   * branch is what differs. Empty for an app with no pre-release deployment.
   */
  readonly channels: ReadonlyMap<string, readonly StoreChannel[]>;
}

export interface PackageListOptions {
  /** Re-read what the store offers instead of answering from the short cache. */
  readonly refresh?: boolean;
}

/**
 * One install request.
 *
 * `channel` names the target tier for a pre-release; stable ignores it. A
 * pre-release that is already installed is switched, never installed a second time.
 */
export interface PackageInstallRequest {
  readonly entry: CatalogueEntry;
  /** The target tier for a pre-release switch or first install. */
  readonly channel?: PackageChannel;
}

/** A replacement of something already installed. */
export interface PackageUpdateRequest extends PackageInstallRequest {
  /** The deployment Flatpak owns, when it is the writer of this install. */
  readonly flatpak?: FlatpakInstall;
}

export interface PackageInstallResult {
  readonly id: string;
  /** The version now installed, or null when the backend could not read one. */
  readonly version: string | null;
}

export interface PackageRemoveRequest {
  readonly entry: CatalogueEntry;
  /**
   * The discovered package to remove.
   *
   * Absent for a record whose files discovery refused to launch: there is still a
   * record to delete, and no owned deployment to ask Flatpak about.
   */
  readonly package?: InstalledPackage;
}

/** What to start, and which card should show that it is running. */
export interface PackageLaunchRequest {
  readonly executable: string;
  readonly argv: readonly string[];
  /** Present when Flatpak owns this install. */
  readonly flatpak?: FlatpakInstall;
  /** The card whose running state this launch feeds. */
  readonly appId?: string;
}

export interface PackageCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * A Flatpak deployment Start manages by application id rather than as a catalogue card.
 *
 * Suite Sync is the one such deployment: its tray app keeps the relay, and Start does
 * not list it beside the document apps or supervise its process. It is still a package,
 * so it crosses the same seam: list it with `flatpak list`, install it from the Suite
 * store, and open it with `flatpak run`.
 */
export interface DeploymentState {
  readonly installed: boolean;
  /** The version Flatpak reports, or null when it reports none. */
  readonly version: string | null;
  /** The deployed commit, or null when Flatpak did not resolve one. */
  readonly commit: string | null;
  /** Whether Install can be offered: Flatpak and a Suite remote are both available. */
  readonly canInstall: boolean;
  /** Why the deployment cannot be read, installed or opened. Null when all is well. */
  readonly problem: string | null;
}

/**
 * How a launch went, for the window.
 *
 * The backend owns the child process, so it also owns the first second and a half of
 * its life (see `launchVerdict`). These callbacks are how main keeps the "running"
 * dot and the failure sentence without spawning anything itself.
 */
export interface PackageLaunchObserver {
  /** The child exists; null when the platform did not give a pid. */
  readonly started?: (pid: number | null) => void;
  /** The child outlived the moment Start watches for. */
  readonly settled?: () => void;
  /** The child is gone, whatever the outcome. */
  readonly exited?: (pid: number | null) => void;
  /** A launch that did not work, in the words the card should show. */
  readonly failed?: (reason: string) => void;
}

/**
 * Every package operation Start performs.
 *
 * `install` and `update` are separate because they promise different things: an
 * update replaces the deployment Flatpak owns, while an install asks the store for
 * a first copy. The backend decides the command from its own listing, so the
 * window never has to speak Flatpak.
 */
export interface PackageBackend {
  list(options?: PackageListOptions): Promise<PackageListing>;
  install(request: PackageInstallRequest): Promise<PackageInstallResult>;
  update(request: PackageUpdateRequest): Promise<PackageInstallResult>;
  remove(request: PackageRemoveRequest): Promise<void>;
  /** What a launch would run, without running it. For `--dry-run` and tests. */
  command(request: PackageLaunchRequest): PackageCommand;
  launch(request: PackageLaunchRequest, observer?: PackageLaunchObserver): void;
  /** Where a deployment lives, for Reveal. Null when this backend cannot say. */
  location(package_: InstalledPackage): Promise<string | null>;

  /**
   * Read a Flatpak Start manages without a catalogue card, by application id.
   *
   * The answer is the pane's whole state: whether the deployment is there, what
   * version and commit it reports, and whether Install is possible at all.
   */
  deployment(application: string): Promise<DeploymentState>;
  /** Ask Flatpak to install one deployment from the Suite store. Returns its version. */
  installDeployment(application: string): Promise<string | null>;
  /** Start one deployment with `flatpak run`, through the same launch path as a card. */
  openDeployment(application: string, observer?: PackageLaunchObserver): Promise<void>;

  /** Register an executable a person picked. False when it is not a Suite app. */
  adopt(executable: string): Promise<boolean>;
  /** Forget a record without touching files Start does not own. */
  forget(id: string): Promise<void>;
}
