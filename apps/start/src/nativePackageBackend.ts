import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CatalogueEntry } from "./catalogue.js";
import {
  FLATPAK_APP_PREFIX,
  type FlatpakApp,
  findFlatpak,
  flatpakIdFor,
  flatpakLocation,
  flatpakScopeArgs,
  installedCommitArgs,
  installedInfoArgs,
  parseCommitOutput,
  parseFlatpakList,
  parseVersionOutput,
  runFlatpak,
  storeInfoArgs,
  storeInstallArgs,
  storeRemote,
  storeUpdateArgs,
  withFlatpakInstalls,
} from "./flatpak.js";
import {
  type Download,
  executableInVersion,
  type InstalledApp,
  installApp,
  installedVersions,
  repairableInstalls,
} from "./install.js";
import type { RegistryStore } from "./installs.js";
import { launchVerdict } from "./launchCheck.js";
import { launchCommand } from "./launchCommand.js";
import { nodeRegistryFileSystem } from "./nodeFileSystem.js";
import type {
  InstalledPackage,
  PackageBackend,
  PackageChannel,
  PackageCommand,
  PackageInstallRequest,
  PackageInstallResult,
  PackageLaunchObserver,
  PackageLaunchRequest,
  PackageListing,
  PackageListOptions,
  PackageRemoveRequest,
  PackageUpdateRequest,
} from "./packageBackend.js";
import {
  APP_MANIFEST_FILENAME,
  type DiscoveredApp,
  discoverApps,
  type FlatpakInstall,
  type InstallRecord,
  packageSource,
} from "./registry.js";

/**
 * The backend Start ships with.
 *
 * It is the same work the window used to do inline: `discoverApps` over the install
 * roots, `flatpak list` for what Flatpak owns, the managed AppImage writer for what
 * Start placed, and one detached spawn for a launch. Nothing here invents a channel
 * or a second way to write a binary; it is the native side of the seam, and the only
 * module that has to change when Start itself is packaged as a Flatpak.
 */

export interface NativePackageBackendOptions {
  /** The applications root Start writes into. */
  readonly appsRoot: string;
  /** Directories whose children each carry a `suite.app.json`. */
  readonly roots: readonly string[];
  /** Start's own install records. */
  readonly registry: RegistryStore;
  /** The apps the catalogue knows, so Flatpak deployments can be named. */
  readonly catalogue: readonly CatalogueEntry[];
  /** Overrides the download a test uses; `fetch` is its source otherwise. */
  readonly download?: Download;
  /** The fetch an AppImage download uses. Electron's is the one that reads `file:`. */
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  /**
   * The `flatpak` binary. `undefined` discovers it; `null` disables Flatpak, which is
   * what a hermetic test needs on a machine that has one installed.
   */
  readonly flatpak?: string | null;
}

const FLATPAK_CACHE_MS = 30_000;
const STORE_CACHE_MS = 60_000;
const NO_STORE: ReadonlyMap<string, string> = new Map();

/** The variable that tells an app it was started by the hub (D45). */
const MANAGED_BY_ENV = "SUITE_MANAGED_BY";

/** The channel a manifest records, or the contract's default when it says nothing. */
function channelOf(app: DiscoveredApp): PackageChannel {
  return app.manifest.update?.channel ?? "stable";
}

export function nativePackageBackend(options: NativePackageBackendOptions): PackageBackend {
  const { appsRoot, roots, registry, catalogue } = options;

  const binary = (): string | null =>
    options.flatpak !== undefined ? options.flatpak : findFlatpak();

  /**
   * What Flatpak has installed, cached for a moment.
   *
   * `state()` runs on every broadcast, including once per download chunk. The listing
   * changes only when Flatpak does something, so a short cache keeps the window honest
   * without spawning a process per redraw. An operation this backend performs clears
   * it, because then the answer really did change.
   */
  let flatpakCache: { readonly at: number; readonly apps: readonly FlatpakApp[] } | null = null;

  async function flatpakInstalls(): Promise<readonly FlatpakApp[]> {
    const executable = binary();
    if (executable === null) return [];
    const now = Date.now();
    if (flatpakCache !== null && now - flatpakCache.at < FLATPAK_CACHE_MS) {
      return flatpakCache.apps;
    }
    let listed: readonly FlatpakApp[];
    try {
      listed = parseFlatpakList(await runFlatpak(["list", "--app", "--json"], executable));
    } catch {
      // A broken Flatpak must not break the launcher.
      listed = [];
    }
    // `flatpak list` does not carry the commit, and the commit is the only stable way
    // to say "the store has a different build": `remote-info` does not publish the
    // app's version. One extra query per suite app, cached with the listing.
    const apps = await Promise.all(
      listed.map(async (app): Promise<FlatpakApp> => {
        if (!app.applicationId.startsWith(FLATPAK_APP_PREFIX)) return app;
        try {
          const commit = parseCommitOutput(
            await runFlatpak(
              installedCommitArgs({
                application: app.applicationId,
                installation: app.installation,
              }),
              executable,
            ),
          );
          return commit === null ? app : { ...app, commit };
        } catch {
          return app;
        }
      }),
    );
    flatpakCache = { at: now, apps };
    return apps;
  }

  /** What `suite-local` offers, by catalogue app id. Empty when the store is not there. */
  let storeCache: { readonly at: number; readonly commits: ReadonlyMap<string, string> } | null =
    null;

  async function storeCommits(force = false): Promise<ReadonlyMap<string, string>> {
    const executable = binary();
    if (executable === null) return NO_STORE;
    const now = Date.now();
    if (!force && storeCache !== null && now - storeCache.at < STORE_CACHE_MS) {
      return storeCache.commits;
    }

    const remote = storeRemote();
    const commits = new Map<string, string>();
    await Promise.all(
      catalogue.map(async (entry) => {
        try {
          const commit = parseCommitOutput(
            await runFlatpak(storeInfoArgs(remote, flatpakIdFor(entry.id)), executable),
          );
          if (commit !== null) commits.set(entry.id, commit);
        } catch {
          // Not in this store is the ordinary answer for an app nobody published.
        }
      }),
    );
    storeCache = { at: now, commits };
    return commits;
  }

  async function versionsFor(): Promise<ReadonlyMap<string, readonly string[]>> {
    const versions = new Map<string, readonly string[]>();
    await Promise.all(
      catalogue.map(async (entry) => {
        versions.set(entry.id, await installedVersions(appsRoot, entry));
      }),
    );
    return versions;
  }

  async function listing(forceOffers = false): Promise<PackageListing> {
    const [result, installs, offers, versions] = await Promise.all([
      (async () =>
        discoverApps({
          roots,
          records: await registry.list(),
          fileSystem: nodeRegistryFileSystem(),
        }))(),
      flatpakInstalls(),
      storeCommits(forceOffers),
      versionsFor(),
    ]);
    const executable = binary();
    const discovery =
      executable === null ? result : withFlatpakInstalls(result, installs, catalogue, executable);

    return {
      packages: discovery.apps.map((app) => ({
        app,
        ownership: packageSource(app, appsRoot),
        channel: channelOf(app),
      })),
      rejected: discovery.rejected,
      versions,
      offers,
    };
  }

  function findPackage(list: PackageListing, id: string): InstalledPackage | null {
    return list.packages.find((candidate) => candidate.app.manifest.id === id) ?? null;
  }

  /** The version a deployment reports, or null when Flatpak will not say. */
  async function flatpakVersionOf(install: FlatpakInstall): Promise<string | null> {
    try {
      return parseVersionOutput(await runFlatpak(installedInfoArgs(install)));
    } catch {
      return null;
    }
  }

  /**
   * Finish a Flatpak change.
   *
   * The listing and the store are both re-read, because either may have changed: the
   * app now exists, and the commit the store offers is the one that was just installed.
   */
  async function finishFlatpak(install: FlatpakInstall): Promise<string | null> {
    flatpakCache = null;
    const version = await flatpakVersionOf(install);
    await storeCommits(true);
    return version;
  }

  async function installFromStore(id: string): Promise<PackageInstallResult> {
    const install: FlatpakInstall = { application: flatpakIdFor(id), installation: "user" };
    await runFlatpak(storeInstallArgs(storeRemote(), install.application));
    return { id, version: await finishFlatpak(install) };
  }

  async function updateFlatpak(id: string, install: FlatpakInstall): Promise<PackageInstallResult> {
    await runFlatpak(storeUpdateArgs(install));
    return { id, version: await finishFlatpak(install) };
  }

  async function installAppImage(
    request: PackageInstallRequest,
    prune: boolean,
  ): Promise<PackageInstallResult> {
    const { entry, version, artifact, feed } = request;
    if (version === undefined || artifact === undefined || feed === undefined) {
      throw new Error("an AppImage install needs a version, an artifact and a feed");
    }
    const installed = await installApp({
      entry,
      version,
      artifact,
      feed,
      appsRoot,
      registry,
      ...(options.download === undefined ? {} : { download: options.download }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(request.onProgress === undefined ? {} : { onProgress: request.onProgress }),
      ...(options.now === undefined ? {} : { now: options.now }),
      prune,
    });
    return { id: installed.id, version: installed.version, installed };
  }

  async function rollback(entry: CatalogueEntry): Promise<InstalledApp | null> {
    const list = await listing();
    const current = findPackage(list, entry.id)?.app ?? null;
    const target = (list.versions.get(entry.id) ?? []).find(
      (version) => version !== current?.manifest.version,
    );
    if (target === undefined) return null;

    const executable = await executableInVersion(appsRoot, entry, target);
    if (executable === null) {
      console.warn(`[rollback] no executable in ${entry.name} ${target}`);
      return null;
    }

    await registry.add({
      id: entry.id,
      executable,
      manifestPath: join(dirname(executable), APP_MANIFEST_FILENAME),
      installedAt: (options.now ?? (() => new Date()))().toISOString(),
    });
    return {
      id: entry.id,
      version: target,
      executable,
      manifestPath: join(dirname(executable), APP_MANIFEST_FILENAME),
    };
  }

  return {
    list: (listOptions?: PackageListOptions) => listing(listOptions?.refresh === true),

    async install(request) {
      const list = await listing();
      const found = findPackage(list, request.entry.id);
      // Flatpak owns its installs, so when it is the writer Start asks it and waits.
      if (found?.app.flatpak !== undefined)
        return updateFlatpak(request.entry.id, found.app.flatpak);
      // The store is also the install channel for an app it offers, which is what makes
      // a fresh machine's Install button work without an AppImage feed.
      if (found === null && list.offers.has(request.entry.id)) {
        return installFromStore(request.entry.id);
      }
      return installAppImage(request, false);
    },

    async update(request: PackageUpdateRequest) {
      const chosen =
        request.flatpak ?? findPackage(await listing(), request.entry.id)?.app.flatpak ?? null;
      if (chosen !== null) return updateFlatpak(request.entry.id, chosen);
      return installAppImage(request, true);
    },

    async remove(request: PackageRemoveRequest) {
      const owned = request.package?.app.flatpak;
      if (owned !== undefined) {
        // Flatpak owns these files, so Start asks Flatpak to remove them. Nothing under
        // the applications root is touched: there may be an AppImage there that is
        // somebody else's.
        await runFlatpak([
          ...flatpakScopeArgs(owned.installation),
          "uninstall",
          "--noninteractive",
          owned.application,
        ]);
        flatpakCache = null;
        return;
      }
      await rm(join(appsRoot, request.entry.folder), { recursive: true, force: true });
      await registry.remove(request.entry.id);
    },

    command(request: PackageLaunchRequest): PackageCommand {
      return launchCommand(request, request.argv);
    },

    launch(request: PackageLaunchRequest, observer: PackageLaunchObserver = {}) {
      const { command, args } = launchCommand(request, request.argv);
      const appId = request.appId;
      const child = spawn(command, [...args], {
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
        // The app is being started by the thing that also updates it. Only a launch
        // Start performs carries this; a desktop entry or a shell run does not.
        env: appId === undefined ? process.env : { ...process.env, [MANAGED_BY_ENV]: "start" },
      });

      let stderr = "";
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        if (stderr.length < 8192) stderr += chunk;
      });

      const pid = child.pid ?? null;
      observer.started?.(pid);

      let settled = false;
      const settle = (): void => {
        settled = true;
        child.stderr?.removeAllListeners("data");
        child.stderr?.destroy();
        child.unref();
        observer.settled?.();
      };
      setTimeout(settle, 1_500);

      // Always: a window that closes is news even if it opened fine, because the card
      // says "running" and nobody else is going to redraw it.
      child.once("exit", (code) => {
        observer.exited?.(pid);
        if (settled) return;
        settled = true;
        const verdict = launchVerdict({ executable: command, exitCode: code, stderr });

        if (verdict.kind === "retry-without-fuse") {
          console.warn(`[launch] ${command}: ${verdict.reason}; retrying without FUSE 2`);
          spawn(command, [...args], {
            detached: true,
            stdio: "ignore",
            env: {
              ...process.env,
              APPIMAGE_EXTRACT_AND_RUN: "1",
              ...(appId === undefined ? {} : { [MANAGED_BY_ENV]: "start" }),
            },
          }).unref();
          child.unref();
          return;
        }

        child.unref();
        if (appId === undefined || verdict.kind === "ok") return;
        console.warn(`[launch] ${command}: ${verdict.reason}`);
        observer.failed?.(verdict.reason);
      });
    },

    async location(package_: InstalledPackage) {
      if (package_.app.flatpak === undefined) return null;
      return flatpakLocation(package_.app.flatpak);
    },

    async adopt(executable) {
      // A packaged Suite app ships its manifest beside its own executable, so the
      // record that knows the binary knows where to read what it is.
      const manifestPath = join(dirname(executable), APP_MANIFEST_FILENAME);
      let id: string;
      try {
        const parsed: unknown = JSON.parse(await nodeRegistryFileSystem().readText(manifestPath));
        const candidate = (parsed as { id?: unknown }).id;
        if (typeof candidate !== "string" || candidate.length === 0) return false;
        id = candidate;
      } catch {
        return false;
      }
      await registry.add({
        executable,
        id,
        manifestPath,
        installedAt: (options.now ?? (() => new Date()))().toISOString(),
      });
      return true;
    },

    async forget(id) {
      await registry.remove(id);
    },

    async repairable(): Promise<readonly InstallRecord[]> {
      return repairableInstalls(await registry.list(), appsRoot, (path) => existsSync(path));
    },

    rollback,
  };
}
