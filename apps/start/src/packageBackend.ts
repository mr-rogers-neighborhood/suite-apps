import type { SuiteReleaseChannel } from "@suite/contracts";
import type { FeedArtifact } from "@suite/desktop";
import type { CatalogueEntry } from "./catalogue.js";
import type { DownloadProgress, InstalledApp } from "./install.js";
import type { DiscoveredApp, FlatpakInstall, InstallRecord, RejectedInstall } from "./registry.js";
import type { AppSource } from "./shared.js";

/**
 * The one way Start reads or changes an installed package.
 *
 * Today Start is an AppImage that talks to Flatpak and to `~/Applications` itself.
 * A packaged-as-Flatpak Start cannot: its sandbox has no `flatpak` binary and no
 * writable applications root, so it has to ask a host agent over D-Bus. The window
 * must not learn a second way to list, install or start an app for that to be a
 * transport swap rather than a second implementation. So every operation below is a
 * method on a backend, and the native one is the only place that spawns anything.
 *
 * The data is the model Start already has: `DiscoveredApp` keeps the manifest, the
 * record's executable and the Flatpak identity; `InstallRecord` and `FlatpakInstall`
 * are what discovery and Flatpak produce. A backend adapts them, never replaces them.
 */

/**
 * The release channel a package came from.
 *
 * Reserved. The native backend reads the channel the manifest records and installs
 * the one feed it has always installed; nothing switches on this value yet. It is on
 * the record and the request so a future backend can answer "where did this come
 * from?" and "where should this go?" without changing the seam.
 */
export type PackageChannel = SuiteReleaseChannel;

/** One installed app, with who owns its files and the channel it came from. */
export interface InstalledPackage {
  /** What discovery found, unchanged: manifest, executable, Flatpak identity. */
  readonly app: DiscoveredApp;
  /** Who may replace the files. The same names the cards use. */
  readonly ownership: AppSource;
  /** The channel this install came from. Reserved; see `PackageChannel`. */
  readonly channel: PackageChannel;
}

/** What one backend can see on this machine right now. */
export interface PackageListing {
  readonly packages: readonly InstalledPackage[];
  /** Installs that exist but cannot be launched, so a card can say why. */
  readonly rejected: readonly RejectedInstall[];
  /**
   * Versions of each catalogue app on disk, newest first.
   *
   * Empty for an app that is not installed. A Flatpak deployment has no version
   * directories of its own and answers empty here too.
   */
  readonly versions: ReadonlyMap<string, readonly string[]>;
  /**
   * The Flatpak commit each catalogue app's store offers, by app id.
   *
   * Absent when this machine has no store, or when the store has not been read.
   * The card reads it as "which channel would Install use", not as a promise.
   */
  readonly offers: ReadonlyMap<string, string>;
}

export interface PackageListOptions {
  /** Re-read what the store offers instead of answering from the short cache. */
  readonly refresh?: boolean;
}

/**
 * One install request.
 *
 * The version, artifact and feed are present for an AppImage and absent when the
 * backend is asked to install from a store it owns. `channel` is reserved: a native
 * backend accepts it and keeps today's single behaviour.
 */
export interface PackageInstallRequest {
  readonly entry: CatalogueEntry;
  /** The version the verified feed named. */
  readonly version?: string;
  /** The artifact that same verified manifest named. */
  readonly artifact?: FeedArtifact;
  /** The feed an AppImage download reads. */
  readonly feed?: string;
  /** Reserved. Native installs the one channel it has always installed. */
  readonly channel?: PackageChannel;
  /** Called as bytes arrive; only the card's progress bar consumes it. */
  readonly onProgress?: DownloadProgress;
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
  /** Present only when Start placed the bytes itself, never for a Flatpak deployment. */
  readonly installed?: InstalledApp;
}

export interface PackageRemoveRequest {
  readonly entry: CatalogueEntry;
  /**
   * The discovered package to remove.
   *
   * Absent for a record whose files discovery refused to launch: there is still a
   * folder and a record to delete, and no owned deployment to ask Flatpak about.
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
 * update may prune the version it replaced, while an install leaves other copies
 * alone. The backend decides the format (AppImage or Flatpak) from its own listing,
 * so the window never has to speak either one.
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

  /** Register an executable a person picked. False when it is not a Suite app. */
  adopt(executable: string): Promise<boolean>;
  /** Forget a record without touching files Start does not own. */
  forget(id: string): Promise<void>;
  /** Managed installs whose menu entry Startup may repair. */
  repairable(): Promise<readonly InstallRecord[]>;
  /** Point an install back at the version it replaced. Null when there is none. */
  rollback(entry: CatalogueEntry): Promise<InstalledApp | null>;
}
