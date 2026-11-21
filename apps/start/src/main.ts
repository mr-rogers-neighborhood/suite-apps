import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appDocumentsFolder,
  hubReportPath,
  parseDeepLink,
  SUITE_APPS,
  type SuiteAppEntry,
  type SuiteHub,
  suiteDocumentsRoot,
  suitePaths,
} from "@suite/contracts";
import { desktopCsp, isTrustedSender, resolveProtocolAsset } from "@suite/desktop";
import { cssVariables, defaultTheme, presetById } from "@suite/theme";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  shell,
} from "electron";
import { appCards, fileCards, selfCard } from "./cards.js";
import {
  ALL_CATALOGUE_APPS,
  type CatalogueApp,
  readCatalogue,
  SELF_ID,
  withInstalled,
} from "./catalogue.js";
import {
  isPreReleaseDataPath,
  isPreReleaseId,
  isPreReleaseTier,
  type PreReleaseTier,
  preReleaseDataDirectory,
  preReleaseRemovalCopy,
  tierForInstall,
} from "./channels.js";
import { type DocumentsFolder, indexDocuments, isInsideDocuments } from "./fileIndex.js";

import { defaultHost, SELF_FLATPAK_ID, sandboxId } from "./host.js";
import {
  adoptLegacyRegistry,
  type HostPaths,
  hostPaths,
  hubLockPath,
  registryPathFor,
  releaseHubLock,
  removePreReleaseTree,
  takeHubLock,
} from "./hostPaths.js";
import { writeHubReport } from "./hubReport.js";
import { REGISTRY_FILENAME, type RegistryStore, registryAt } from "./installs.js";
import { stopApproach } from "./launchCommand.js";
import { type NativePackageBackend, nativePackageBackend } from "./nativePackageBackend.js";
import { defaultRoots, nodeRegistryFileSystem } from "./nodeFileSystem.js";
import type { PackageLaunchObserver, PackageListing } from "./packageBackend.js";
import { RECENT_LIMIT, type RecentsFile, recentsFile } from "./recents.js";
import { type RecoveryLookup, readRecoveryReports, recoveryFor } from "./recovery.js";
import type { DiscoveredApp } from "./registry.js";
import { describeRouteRejection, routeLaunch } from "./route.js";
import {
  type AppLocation,
  type InstallProgress,
  type LauncherState,
  type RecentCard,
  type ResolvedTheme,
  START_CHANGED,
  START_INSTALL_PROGRESS,
  START_IPC,
  type SyncState,
  type ThemeChoice,
} from "./shared.js";
import { isIconOf, shortcutIconPathIn, shortcutPathIn } from "./shortcuts.js";
import { relayCode } from "./syncCode.js";
import { isAddressInUse, SuiteSyncRelay } from "./syncRelay.js";
import {
  isThemeChoice,
  loadThemeChoice,
  presetFor,
  saveThemeChoice,
  themeOptions,
} from "./theme.js";
import { resolveWindowIcon } from "./windowIcon.js";

/**
 * Suite Start.
 *
 * The suite's home: it discovers apps, starts one, remembers what was opened,
 * and reports what it knows. It holds no document, proxies no bytes, and never
 * runs an app's code — which is what keeps one app's bad update from taking the
 * other two down with it.
 */

/**
 * Where this application lives.
 *
 * `app.getAppPath()` rather than the working directory: a launcher started from
 * a desktop entry, a shell or another process inherits whatever directory that
 * process had, and the bundle is not there.
 */
// Before anything reads a path. `userData` is derived from the application name,
// and without this it is the scoped package name, `@suite/start`.
app.setName("Suite Start");

// A second profile needs its own Chromium directory: the single-instance lock
// lives in `userData`, so two hubs in one folder would close each other. This is
// also what lets a test run a hub without touching the real one.
const userDataOverride = process.env.SUITE_START_USER_DATA?.trim();
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath("userData", userDataOverride);
}

/**
 * Where processes run, and the host paths Start shares with the rest of the suite.
 *
 * One seam for the whole process: the backend, the icon cache and a planned launch
 * all use it, so a sandboxed Start cannot reach the host one way and the sandbox
 * another. `hostPaths` answers from the host home rather than from Electron's
 * re-rooted XDG directories, because the manifest grants those host paths.
 */
const host = defaultHost();

function hostPathTable(): HostPaths {
  return hostPaths({
    platform: process.platform,
    home: app.getPath("home"),
    appsRootOverride: process.env.SUITE_START_APPS_ROOT,
  });
}

/** The suite's data home on the host, which a sandboxed XDG value must not displace. */
function dataHome(): string | undefined {
  if (sandboxId() === null) return process.env.XDG_DATA_HOME;
  return dirname(hostPathTable().suiteData);
}

function appDir(): string {
  return app.getAppPath();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "start",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/**
 * The hub never runs WebAssembly, so it does not need the directive the apps
 * need. The rest of the policy is the one every Suite page ships.
 */
const CSP = desktopCsp({ wasm: false });

/** The only origin the hub's renderer is loaded from. */
const PAGE_ORIGIN = "start://launcher";

let window: BrowserWindow | null = null;
let registry: RegistryStore;
let recents: RecentsFile;
let dataDirectory = "";
/**
 * Which preset and mode the window draws.
 *
 * Held in memory and resolved on every read, because "follow the desktop" is a choice whose
 * answer changes while the hub is open — a laptop that dims at dusk should repaint without
 * anyone touching the picker.
 */
let themeChoice: ThemeChoice = { preset: presetFor(null), mode: "system" };

/** What the desktop currently says, which `system` resolves against. */
function desktopPrefersDark(): boolean {
  return nativeTheme.shouldUseDarkColors;
}

/**
 * The choice, resolved: the preset, the list for the picker, and every role as a variable.
 *
 * Resolved in main because the page cannot import `@suite/theme` — it is plain ES modules
 * over `start://` with no bundler — and because one process deciding is what keeps the
 * title bar, the scrollbars and the content from disagreeing.
 */
function resolvedTheme(): ResolvedTheme {
  const preset = presetById(themeChoice.preset) ?? defaultTheme();
  const mode =
    themeChoice.mode === "system" ? (desktopPrefersDark() ? "dark" : "light") : themeChoice.mode;
  return {
    choice: themeChoice,
    options: themeOptions(),
    mode,
    values: cssVariables(preset, mode),
  };
}
let syncRelay: SuiteSyncRelay | null = null;
/** The report already on disk, so a restart is visible as a new `startedAt` rather than a new one. */
let previousHub: SuiteHub | null = null;

/** Files and links handed over before the window exists. */
const pendingTargets: string[] = [];

function roots(): readonly string[] {
  return defaultRoots(app.getPath("home"), process.platform);
}

/** The documents root, unless `SUITE_START_DOCUMENTS` replaces it for a test. */
function documentsRoot(): string {
  return suiteDocumentsRoot(
    process.platform,
    app.getPath("home"),
    process.env.SUITE_START_DOCUMENTS,
  );
}

/**
 * Where this hub puts an app it installs.
 *
 * `~/Applications/Suite` unless `SUITE_START_APPS_ROOT` says otherwise, which is how a
 * test installs into a directory it can throw away. The host path table owns the answer
 * in both forms, because a Flatpak re-roots its own XDG roots but is granted this one.
 */
function applicationsRoot(): string {
  return hostPathTable().appsRoot;
}

/**
 * What the last self-update did, for the row that asked for it.
 *
 * In memory only: it describes a request made in this session, and a restart is the
 * moment a new build starts, so the sentence has done its work by then.
 */
let selfUpdate: { readonly done: boolean; readonly error: string | null } = {
  done: false,
  error: null,
};

/**
 * The apps Start has started and not seen exit, by app id.
 *
 * A pid, not a promise: a window Start did not spawn (from the menu, say) is not in here
 * and cannot be, and pretending otherwise would put a "Running" on a card nobody checked.
 */
const runningPids = new Map<string, number>();

/**
 * The Flatpak application id behind a running app, when Start launched one.
 *
 * Inside a Flatpak the pid above belongs to `flatpak-spawn`; the application id is
 * what `flatpak kill` can address on the host.
 */
const runningFlatpak = new Map<string, string>();

function forgetRunning(id: string): void {
  runningPids.delete(id);
  runningFlatpak.delete(id);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function liveRunning(): ReadonlySet<string> {
  const live = new Set<string>();
  for (const [id, pid] of runningPids) {
    if (isAlive(pid)) live.add(id);
    else forgetRunning(id);
  }
  return live;
}

/** What the catalogue last answered, and what is being installed right now. */
let catalogue: readonly CatalogueApp[] = [];
const installProgress = new Map<string, InstallProgress>();

/**
 * Read what the store offers.
 *
 * This runs when the window opens, when a person presses Check for updates, and
 * after a store change — never on a timer. Nothing is downloaded here.
 */
async function refreshCatalogue(): Promise<void> {
  // The listing carries what is installed and what the store offers; asking the
  // backend to refresh re-reads both on the same occasions: when the window opens
  // and when a person asks it to look again.
  const listing = await discover({ refresh: true });
  catalogue = await readCatalogue({
    installed: new Map(
      listing.packages.map((entry) => [entry.app.manifest.id, entry.app.manifest.version]),
    ),
  });
}

/** Send the progress list, which is the only thing that changes while an operation moves. */
function sendProgress(): void {
  window?.webContents.send(START_INSTALL_PROGRESS, [...installProgress.values()]);
}

function reportProgress(progress: InstallProgress): void {
  installProgress.set(progress.id, progress);
  sendProgress();
}

/**
 * Where each app Start can see keeps its binary, its state and its files.
 *
 * Read from the same discovery the cards use, so a path here and the path in an install
 * record cannot disagree. A refused install is left out: it has no version to report, and
 * its "where" is the sentence its card already shows.
 */
function appLocations(apps: readonly DiscoveredApp[]): readonly AppLocation[] {
  const platform = process.platform;
  const home = app.getPath("home");
  const rootOverride = process.env.SUITE_START_DOCUMENTS;
  // The folder is the convention's name, not the app's: a manifest calls itself
  // "Suite Canvas", and a folder called that is a folder no app writes to.
  return apps.flatMap((installed): AppLocation[] => {
    const entry = SUITE_APPS.find((candidate) => candidate.id === installed.manifest.id);
    if (entry === undefined) return [];
    return [
      {
        id: entry.id,
        name: installed.manifest.name,
        version: installed.manifest.version,
        executable: installed.executable,
        documents: appDocumentsFolder(entry, { platform, home, rootOverride }),
        data: suitePaths(entry.folder, { platform, home, xdgDataHome: dataHome() }).data,
      },
    ];
  });
}

function documentFolders(): readonly DocumentsFolder[] {
  const platform = process.platform;
  const home = app.getPath("home");
  const rootOverride = process.env.SUITE_START_DOCUMENTS;
  return SUITE_APPS.flatMap((entry: SuiteAppEntry) =>
    entry.extension === null
      ? []
      : [
          {
            app: entry,
            path: appDocumentsFolder(entry, {
              platform,
              home,
              rootOverride,
              xdgDataHome: dataHome(),
            }),
          },
        ],
  );
}

/**
 * The one way Start touches an installed package.
 *
 * Discovery and Flatpak live behind `PackageBackend` (§packageBackend). Main asks for
 * a listing, an install or a launch and never picks a binary or a process itself, so a
 * Start packaged as a Flatpak reaches the host through the seam without the window
 * learning a second way.
 */
let backend: NativePackageBackend;

async function discover(options: { readonly refresh?: boolean } = {}): Promise<PackageListing> {
  return backend.list(options);
}

/** The app with this id, as the listing reports it. */
function installedApp(listing: PackageListing, id: string): DiscoveredApp | null {
  return listing.packages.find((entry) => entry.app.manifest.id === id)?.app ?? null;
}

/**
 * The port the relay listens on.
 *
 * 8787 unless something says otherwise: a test needs a free port, and two relays on one
 * machine would otherwise take turns failing to bind.
 */
function syncPort(): number {
  const raw = process.env.SUITE_START_SYNC_PORT?.trim();
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 8787;
}

/** The relay Start supervises, created once the data directory is known. */
function relay(port = syncPort()): SuiteSyncRelay {
  syncRelay ??= new SuiteSyncRelay({
    dataDir: dataDirectory,
    port,
    onExit: () => void broadcast(),
  });
  return syncRelay;
}

/**
 * The sync pane's state, with the one thing the relay cannot know.
 *
 * The relay carries frames and knows who may write; whether anybody kept a way back in is
 * a fact about the apps on this machine, so it is read from their own reports and folded
 * in here rather than pretended to by the mailbox.
 */
async function syncState(): Promise<SyncState> {
  const current = syncRelay === null ? null : await syncRelay.snapshot();
  const reports = await readRecoveryReports(recoveryLookup(), nodeRegistryFileSystem());
  return {
    installed: current?.installed ?? false,
    running: current?.running ?? false,
    scope: current?.scope ?? "loopback",
    address: current?.address ?? null,
    port: current?.port ?? syncPort(),
    store: current?.store ?? join(dataDirectory, "sync"),
    binary: current?.binary ?? null,
    fingerprint: current?.fingerprint ?? null,
    consoleUrl: current?.consoleUrl ?? null,
    qr: relayCode(current?.address ?? null, current?.fingerprint ?? null),
    problem: current?.problem ?? null,
    workspaces: (current?.workspaces ?? []).map((workspace) => ({
      ...workspace,
      recovery: recoveryFor(reports, workspace.workspaceId),
    })),
  };
}

function recoveryLookup(): RecoveryLookup {
  return {
    platform: process.platform,
    home: app.getPath("home"),
    xdgDataHome: dataHome(),
  };
}

/**
 * Tell the other apps where this machine listens, in the one place they can read it.
 *
 * Written whenever the relay changes, because a stale address is worse than none: an app
 * that prefilled a share field from a relay that has since stopped would hand out a link
 * to nothing.
 */
async function reportHub(): Promise<void> {
  const current = syncRelay === null ? null : await syncRelay.snapshot();
  const now = new Date().toISOString();
  const port = current !== null && current.port > 0 ? current.port : syncPort() || 8787;
  const report: SuiteHub = {
    format: "suite.hub",
    running: current?.running ?? false,
    scope: current?.scope ?? "loopback",
    port,
    address: current?.address ?? null,
    startedAt: current?.running
      ? previousHub?.running === true
        ? (previousHub.startedAt ?? now)
        : now
      : null,
    updatedAt: now,
  };
  previousHub = report;
  await writeHubReport(hubReportPath(recoveryLookup()), report);
}

async function state(): Promise<LauncherState> {
  const listing = await discover();
  const apps = listing.packages.map((entry) => entry.app);
  const recent = await recents.list();
  const files = await indexDocuments(
    documentFolders(),
    nodeRegistryFileSystem(),
    new Set(apps.map((entry) => entry.manifest.id)),
  );

  const self = catalogue.find((entry) => entry.id === SELF_ID) ?? undefined;
  const cards = appCards({
    apps,
    rejected: listing.rejected,
    files,
    recents: recent,
    catalogue,
    running: liveRunning(),
    store: listing.offers,
    storeChannels: listing.channels,
  });

  const recentCards: RecentCard[] = recent
    .flatMap((row): RecentCard[] => {
      const owner = apps.find((entry) => entry.manifest.id === row.appId);
      if (!owner) return [];
      return [
        {
          path: row.path,
          name: row.path.split(/[\\/]/u).at(-1) ?? row.path,
          appId: row.appId,
          appName: owner.manifest.name,
          openedAt: row.openedAt,
        },
      ];
    })
    .slice(0, RECENT_LIMIT);

  // The hub cannot replace its own running binary, so it says what it is rather than
  // offering a button that would fail. A Flatpak deployment is the one exception:
  // Flatpak is its writer, so the row can ask Flatpak for the newest build.
  const flatpakId = sandboxId();
  return {
    apps: cards,
    recents: recentCards,
    files: fileCards(files),
    settings: {
      dataDirectory,
      documentsRoot: documentsRoot(),
      installRoots: [...new Set([...roots(), applicationsRoot()])],
      locations: appLocations(apps),
      theme: resolvedTheme(),
    },
    version: app.getVersion(),
    sync: await syncState(),
    self:
      self === undefined
        ? null
        : selfCard(self, app.getVersion(), {
            ...(flatpakId === null ? {} : { flatpak: true }),
            ...(flatpakId === SELF_FLATPAK_ID ? { canUpdate: true } : {}),
            updated: selfUpdate.done,
            error: selfUpdate.error,
          }),
    installing: [...installProgress.values()],
    launchErrors: Object.fromEntries(launchFailures),
  };
}

/**
 * Launch failures, by app id, since the window opened.
 *
 * A launch is not an install, so this is not `installProgress`: it is a sentence the card
 * shows until the next successful launch. Kept in memory only, because a failure that
 * outlived the session would be a claim about a launch nobody just made.
 */
const launchFailures = new Map<string, string>();

/**
 * What the backend's launch lifecycle does to the window.
 *
 * The backend owns the child and the first moment of its life (§launchVerdict); this is
 * the launcher's bookkeeping: a running dot while the pid lives, and the sentence a card
 * shows when it did not open.
 */
function launchObserver(appId: string): PackageLaunchObserver {
  return {
    started(pid) {
      if (pid !== null) runningPids.set(appId, pid);
    },
    settled() {
      if (launchFailures.delete(appId)) void broadcast();
    },
    exited(pid) {
      if (pid !== null && runningPids.get(appId) === pid) {
        forgetRunning(appId);
        void broadcast();
      }
    },
    failed(reason) {
      launchFailures.set(appId, reason);
      void broadcast();
    },
  };
}

/** Start one installed app through the one backend that knows how. */
function launchApp(app_: DiscoveredApp, argv: readonly string[]): void {
  if (app_.flatpak === undefined) {
    runningFlatpak.delete(app_.manifest.id);
  } else {
    runningFlatpak.set(app_.manifest.id, app_.flatpak.application);
  }
  backend.launch(
    {
      executable: app_.executable,
      argv,
      ...(app_.flatpak === undefined ? {} : { flatpak: app_.flatpak }),
      appId: app_.manifest.id,
    },
    launchObserver(app_.manifest.id),
  );
}

/** Resolve one target and start the app that owns it. */
async function open(target: string): Promise<void> {
  const listing = await discover();
  const routed = routeLaunch(
    target,
    listing.packages.map((entry) => entry.app),
  );
  if (!routed.ok) {
    const message = describeRouteRejection(routed.reason);
    if (window) {
      await dialog.showMessageBox(window, { type: "warning", title: "Suite Start", message });
    }
    return;
  }
  launchApp(routed.plan.app, routed.plan.argv);
  if (routed.plan.why === "file") {
    await recents.remember({ path: target.trim(), appId: routed.plan.app.manifest.id });
  }
  await broadcast();
}

async function broadcast(): Promise<void> {
  if (!window) return;
  window.webContents.send(START_CHANGED, await state());
}

/** Register an app from an executable the user picked. */
async function addApp(): Promise<void> {
  if (!window) return;
  const picked = await dialog.showOpenDialog(window, {
    title: "Add a Suite app",
    properties: ["openFile"],
  });
  const executable = picked.filePaths[0];
  if (picked.canceled || !executable) return;

  // The backend reads the manifest beside the binary and writes the record; main only
  // decides what to say when it is not a Suite app.
  const adopted = await backend.adopt(executable);
  if (!adopted) {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "Not a Suite app",
      message:
        "That executable has no suite.app.json beside it, so Start cannot tell what it is. " +
        "Pick an application installed by Suite.",
    });
    return;
  }
  await broadcast();
}

/**
 * Where a user-scope application entry lives, and where its icon goes.
 *
 * The host path table rather than Electron's XDG view: a Flatpak's
 * `~/.local/share` is its own private directory, and a menu entry written there
 * would be one no desktop reads.
 */
function shortcutDirs(): { entry: (id: string) => string; icon: (name: string) => string } {
  const paths = hostPathTable();
  return {
    entry: (id) => shortcutPathIn(paths.applications, id, process.platform),
    icon: (name) => shortcutIconPathIn(paths.icons, name, 256, process.platform),
  };
}

/**
 * Remove an app's entry and icon left by an older AppImage install.
 *
 * Start no longer writes these: Flatpak exports its own desktop entry. A build
 * that predates the Flatpak-only tree may still have left one, so forgetting an
 * app cleans it up. Best effort, like every menu-entry operation.
 */
async function removeShortcut(id: string): Promise<void> {
  const dirs = shortcutDirs();
  await rm(dirs.entry(id), { force: true }).catch(() => undefined);
  // Every icon this app ever wrote, not one guessed name: the names are content-addressed
  // and an uninstall that leaves three PNGs behind is the same lie by omission as before.
  const directory = dirname(dirs.icon("unused"));
  await readdir(directory)
    .then((names) =>
      Promise.all(
        names
          .filter((name) => isIconOf(id, name))
          .map((name) => rm(join(directory, name), { force: true }).catch(() => undefined)),
      ),
    )
    .catch(() => undefined);
}

/**
 * Signal the process Start can see on the host.
 *
 * SIGTERM first, because that is a request an app can answer — a document can be flushed.
 * This is the direct host path.
 */
function signalApp(id: string): void {
  const pid = runningPids.get(id);
  if (pid === undefined) return;
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone: the map is stale, which the next `liveRunning` clears.
  }
}

/** Wait until a pid is gone, or give up. Returns whether it went. */
async function waitForExit(id: string, timeoutMs = 5_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pid = runningPids.get(id);
    if (pid === undefined || !isAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

/**
 * Ask a person to close an app Start cannot signal from inside the sandbox.
 *
 * The loop is the retry: Continue waits for the pid Start does have (the helper's)
 * to go away, and asks again if it is still there. Cancel leaves the app running,
 * so the caller must not replace or remove its files.
 */
async function waitForPersonToClose(id: string, name: string, reason: string): Promise<boolean> {
  // The window may have closed while Start was deciding; never ask about a gone app.
  if (await waitForExit(id, 500)) return true;
  if (window === null) return false;
  for (;;) {
    const answer = await dialog.showMessageBox(window, {
      type: "question",
      title: `Close ${name}`,
      message: `Close ${name} to continue.`,
      detail: `${reason} Start will wait until it has exited.`,
      buttons: ["Cancel", "Continue"],
      defaultId: 1,
      cancelId: 0,
    });
    if (answer.response !== 1) return false;
    if (await waitForExit(id, 15_000)) return true;
  }
}

/**
 * Close a running app before Start replaces or removes it.
 *
 * The host form is exactly what it was: SIGTERM the pid Start knows, then wait. In
 * a Flatpak sandbox that pid belongs to `flatpak-spawn`, so a Flatpak is closed by
 * application id on the host and an AppImage is handed to the person. `requireExit`
 * keeps the removal flows' existing host behaviour, where the timeout did not stop
 * the removal; an update has always refused to write under a live process.
 */
async function closeRunning(
  id: string,
  name: string,
  options: { readonly requireExit: boolean },
): Promise<boolean> {
  if (!runningPids.has(id)) return true;
  const approach = stopApproach({
    sandboxed: sandboxId() !== null,
    flatpak: runningFlatpak.has(id),
  });

  if (approach === "signal") {
    signalApp(id);
    const gone = await waitForExit(id);
    return options.requireExit ? gone : true;
  }

  if (approach === "flatpak-kill") {
    const application = runningFlatpak.get(id);
    if (application === undefined) {
      return waitForPersonToClose(id, name, "Start cannot name this Flatpak.");
    }
    try {
      // The seam runs `flatpak kill <id>` on the host; no pid is signalled here.
      await backend.stopFlatpak(application);
    } catch (error) {
      // A race can make `flatpak kill` report "not running" for an app that has
      // already gone, which is the state Start wanted; only ask a person otherwise.
      if (await waitForExit(id, 1_000)) return true;
      console.warn(`[flatpak] could not close ${application}`, error);
      return waitForPersonToClose(id, name, `Flatpak could not close ${application}.`);
    }
    if (await waitForExit(id, 15_000)) return true;
    return waitForPersonToClose(id, name, "Flatpak did not close it.");
  }

  // A sandboxed AppImage: the pid is the helper's, and there is no safe host-wide
  // signal that identifies this app. Never fall back to pkill.
  return waitForPersonToClose(
    id,
    name,
    "Start is inside a Flatpak, so it cannot close this AppImage for you.",
  );
}

/**
 * Delete a pre-release channel's data, after the person explicitly chose that.
 *
 * The confirmation is the only caller, and the path is checked against the
 * pre-release tree first: a stable document folder is never inside it, so this
 * cannot become "uninstall stable and take the documents with it".
 */
async function removeChannelData(path: string): Promise<void> {
  // The host form keeps its direct deletion and its documents-root guard.
  if (sandboxId() === null) {
    if (!isPreReleaseDataPath(documentsRoot(), path)) {
      console.warn(`[uninstall] refused to delete a path outside the pre-release tree: ${path}`);
      return;
    }
    await rm(path, { recursive: true, force: true });
    return;
  }

  // Documents are granted read-only to the Flatpak, so only the host can delete
  // this folder. The helper resolves the path and proves it sits under
  // `<home>/Documents/Suite Slop/` before running `rm` through the seam.
  const removed = await removePreReleaseTree({
    home: app.getPath("home"),
    path,
    host,
  });
  if (!removed) {
    console.warn(`[uninstall] refused to delete a path outside Documents/Suite Slop: ${path}`);
  }
}

/** The sentence a failed install shows, which is what the step that failed wrote. */
function describeInstallFailure(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "the install did not finish, and nothing was replaced";
}
/**
 * Finish a package change that Flatpak made.
 *
 * The backend re-reads the deployment's version and the store before it returns; main only
 * records the answer on the card. A running app keeps running the old commit until it
 * restarts: Flatpak swaps the deployment underneath it, and closing the window would be
 * Start doing a job it does not own.
 */
async function finishPackage(id: string, version: string | null): Promise<void> {
  if (version !== null) catalogue = withInstalled(catalogue, id, version);
  installProgress.delete(id);
  sendProgress();
  await broadcast();
}

/**
 * Install or update one app through Flatpak, and let the card watch it happen.
 *
 * There is no download here any more. Flatpak owns every deployment: an install
 * asks the store, an update asks Flatpak to replace the deployment, and a copy in
 * a folder is not Start's to replace.
 */
async function installOne(id: string, channel?: unknown): Promise<void> {
  // The hub's own row is the one package Start may update through a writer that is
  // not itself. Flatpak owns the deployment, so asking it is the whole operation;
  // the new build appears at the next launch because a running process keeps the
  // code it started with.
  if (id === SELF_ID && sandboxId() === SELF_FLATPAK_ID) {
    try {
      await backend.updateSelf();
      selfUpdate = { done: true, error: null };
    } catch (error) {
      selfUpdate = { done: false, error: describeInstallFailure(error) };
    }
    await broadcast();
    return;
  }
  // Any other id under Flatpak has no deployment this hub may name, so the row
  // offers no action; a stray request is not a second way in.
  if (id === SELF_ID && sandboxId() !== null) return;

  const entry = catalogue.find((app) => app.id === id);
  if (entry === undefined) return;
  // Only a pre-release has a branch to choose; a stable card's button names none.
  const target: PreReleaseTier | undefined =
    isPreReleaseId(id) && isPreReleaseTier(channel) ? channel : undefined;

  const listing = await discover();
  const found = listing.packages.find((candidate) => candidate.app.manifest.id === id) ?? null;
  const installed = found?.app ?? null;

  reportProgress({ id, phase: "installing", reason: null });
  try {
    if (installed !== null && installed.flatpak === undefined) {
      throw new Error(
        "this app is a copy in a folder, not a Flatpak deployment: Start opens and forgets it, but replaces neither",
      );
    }
    const result =
      installed?.flatpak !== undefined
        ? await backend.update({
            entry,
            flatpak: installed.flatpak,
            ...(target === undefined ? {} : { channel: target }),
          })
        : await backend.install({
            entry,
            ...(target === undefined ? {} : { channel: target }),
          });
    await finishPackage(id, result.version);
  } catch (error) {
    reportProgress({
      id,
      phase: "failed",
      reason: describeInstallFailure(error),
    });
  }
}

/**
 * Bring the sync relay up, off the startup path, and say so if it cannot.
 *
 * The port is the interesting part: only one process can hold 8787, so a second relay
 * would otherwise make this one fail. A later port is as good as the first, because the
 * address is written into the hub's report and apps read it from there rather than
 * assuming. Only a real collision is retried; a missing binary or a broken one is a
 * sentence for the pane, not ten failed processes.
 */
const SYNC_PORT_ATTEMPTS = 10;

async function startRefreshRelay(): Promise<void> {
  const configured = syncPort();
  const attempts = configured === 0 ? 1 : SYNC_PORT_ATTEMPTS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = new SuiteSyncRelay({
      dataDir: dataDirectory,
      port: configured + attempt,
      onExit: () => void broadcast(),
    });
    syncRelay = candidate;
    const started = await candidate.start();
    if (
      started.running ||
      !started.installed ||
      !isAddressInUse(started.problem) ||
      attempt === attempts - 1
    ) {
      break;
    }
  }

  const state = syncRelay === null ? null : await syncRelay.snapshot();
  if (state !== null && !state.running && state.installed) {
    console.warn(`[sync] the relay is not running: ${state.problem ?? "no reason given"}`);
  }

  // An app that reads this at launch should find today's answer.
  await reportHub().catch((error: unknown) => {
    console.warn("[sync] could not report the hub's address", error);
  });
  await broadcast();
}

/** Read the store again and redraw, which is what the menu item and the button both do. */
async function refreshAndBroadcast(): Promise<void> {
  for (const [id, progress] of installProgress) {
    if (progress.phase === "failed") installProgress.delete(id);
  }
  await refreshCatalogue().catch((error: unknown) => {
    console.warn("[catalogue] the store could not be read", error);
  });
  sendProgress();
  await broadcast();
}

/** Open one of Start's own folders, rather than a path a page asked for. */
async function openFolder(path: string): Promise<void> {
  const problem = await shell.openPath(path);
  if (problem.length > 0 && window !== null) {
    await dialog.showMessageBox(window, {
      type: "warning",
      title: "Suite Start",
      message: `That folder could not be opened: ${problem}`,
    });
  }
}

/** The window's own icon: a different source from the desktop entry's (§windowIcon). */
function windowIcon(): string | null {
  const icon = resolveWindowIcon({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: appDir(),
    exists: (path) => existsSync(path),
  });
  if (icon === null) console.warn("[start] no window icon to load");
  else if (icon.reason !== null) console.warn(`[start] ${icon.reason}; using ${icon.path}`);
  return icon?.path ?? null;
}

function createWindow(): BrowserWindow {
  const icon = windowIcon();
  const created = new BrowserWindow({
    width: 880,
    height: 620,
    minWidth: 560,
    minHeight: 420,
    show: false,
    backgroundColor: "#ffffff",
    ...(icon === null ? {} : { icon }),
    webPreferences: {
      preload: join(appDir(), "dist", "preload", "index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  created.once("ready-to-show", () => created.show());
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  created.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("start://launcher/")) event.preventDefault();
  });
  created.on("closed", () => {
    window = null;
  });
  return created;
}

async function show(): Promise<void> {
  if (!window) return;
  await window.loadURL("start://launcher/index.html");
  await broadcast();
}

/**
 * Register a channel, but only answer the page this app loaded.
 *
 * A sandboxed renderer with a strict policy is already a narrow door; this is
 * the check Electron's checklist asks for, and it costs one comparison.
 */
function onIpc(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event.senderFrame?.url, [PAGE_ORIGIN])) return undefined;
    return handler(event, ...args);
  });
}

function registerIpc(): void {
  onIpc(START_IPC.listApps, () => state());

  onIpc(START_IPC.launch, async (_event, id: unknown) => {
    if (typeof id !== "string") return;
    const target = installedApp(await discover(), id);
    if (!target) return;
    launchApp(target, []);
    await broadcast();
  });

  onIpc(START_IPC.addApp, () => addApp());

  /**
   * Install or update one app, with the card watching.
   *
   * Every step here is the person's: the store was read because the window opened or
   * because they asked it to look again, and this runs only because they pressed the
   * button the card drew.
   */
  onIpc(START_IPC.installApp, async (_event, id: unknown, channel: unknown) => {
    if (typeof id !== "string") return;
    await installOne(id, channel);
  });

  onIpc(START_IPC.removeApp, async (_event, id: unknown) => {
    if (typeof id !== "string") return;
    // A refusal that cannot be launched leaves a record and nothing else to delete.
    await backend.forget(id);
    await removeShortcut(id);
    await broadcast();
  });

  /**
   * Show a copy Start did not install, where it lives.
   *
   * The page names an app, never a path: main looks the executable up in its own records,
   * which is the only place an executable path exists for a launch or a reveal.
   */
  onIpc(START_IPC.revealApp, async (_event, id: unknown) => {
    if (typeof id !== "string") return;
    const found =
      (await discover()).packages.find((candidate) => candidate.app.manifest.id === id) ?? null;
    if (found === null) return;
    // A Flatpak has no file of its own to show. The deployment directory is the
    // closest true answer, and it is the one the backend asks `flatpak info` for.
    if (found.app.flatpak !== undefined) {
      const location = await backend.location(found);
      if (location === null) return;
      // The deployment is outside the hub's sandbox. A Flatpak Start asks the
      // host's file manager, which is the only process that can see it.
      if (host.sandboxed) {
        try {
          await host.run({ file: "xdg-open", args: [location] });
        } catch {
          // No file manager, or no handler for a directory: there is nothing
          // else honest to do, and the card stays as it was.
        }
      } else {
        await shell.openPath(location);
      }
      return;
    }
    shell.showItemInFolder(found.app.executable);
  });

  /**
   * Uninstall a Flatpak deployment.
   *
   * Flatpak owns these files, so Start asks Flatpak to remove them and then stops
   * describing itself as installed. A copy in a folder is not Start's to delete;
   * that card offers Forget instead.
   */
  onIpc(START_IPC.uninstallApp, async (_event, id: unknown) => {
    if (typeof id !== "string" || window === null) return;
    const entry =
      catalogue.find((candidate) => candidate.id === id) ??
      ALL_CATALOGUE_APPS.find((candidate) => candidate.id === id);
    if (entry === undefined) return;

    const listing = await discover();
    const found = listing.packages.find((candidate) => candidate.app.manifest.id === id) ?? null;
    const flatpak = found?.app.flatpak;
    if (found === null || flatpak === undefined) return;

    const preRelease = isPreReleaseId(id);
    const tier = tierForInstall({
      id,
      branch: flatpak.branch,
      channel: found.app.channel ?? found.app.manifest.update?.channel,
    });
    const channelData = preRelease ? preReleaseDataDirectory(documentsRoot(), entry.folder) : null;

    const copy = preRelease
      ? preReleaseRemovalCopy({
          name: entry.name,
          tier,
          dataDirectory: channelData ?? "",
          flatpak,
        })
      : {
          message: `Uninstall ${entry.name} from Flatpak?`,
          detail:
            `This asks Flatpak to remove ${flatpak.application} from the ` +
            `${flatpak.installation} installation. Documents are not touched.`,
          buttons: ["Cancel", "Uninstall"],
        };
    const confirm = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Uninstall",
      message: copy.message,
      detail: copy.detail,
      buttons: [...copy.buttons],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirm.response === 0) return;

    if (runningPids.has(id)) {
      // A sandboxed Flatpak is closed by id; a running copy keeps the files in use.
      if (!(await closeRunning(id, entry.name, { requireExit: false }))) return;
      forgetRunning(id);
    }
    try {
      await backend.remove({ entry, package: found });
    } catch (error) {
      console.warn(`[flatpak] could not uninstall ${flatpak.application}`, error);
      await dialog.showMessageBox(window, {
        type: "error",
        title: "Uninstall",
        message: `${entry.name} was not removed.`,
        detail: "Flatpak refused the request; its own output is in the log.",
      });
      return;
    }
    if (preRelease && confirm.response === 2 && channelData !== null) {
      await removeChannelData(channelData);
    }
    catalogue = withInstalled(catalogue, id, null);
    await broadcast();
  });

  /**
   * Remember which palette to draw.
   *
   * Applied through `nativeTheme` rather than a class on the page: one assignment changes
   * what every window reports for `prefers-color-scheme`, so the stylesheet keeps one set of
   * rules and the title bar cannot disagree with the content.
   */
  onIpc(START_IPC.setTheme, async (_event, choice: unknown) => {
    if (!isThemeChoice(choice)) return;
    const next: ThemeChoice = { preset: presetFor(choice.preset), mode: choice.mode };
    if (next.preset === themeChoice.preset && next.mode === themeChoice.mode) return;
    themeChoice = next;
    // Electron owns the window frame and the scrollbars, so it is told as well; the page gets
    // the values through state, because it cannot read the package.
    nativeTheme.themeSource = next.mode;
    try {
      await saveThemeChoice(dataDirectory, next);
    } catch (error) {
      console.warn("[theme] could not save the choice", error);
    }
    await broadcast();
  });

  onIpc(START_IPC.recents, async () => (await state()).recents);

  onIpc(START_IPC.forgetRecent, async (_event, path: unknown) => {
    if (typeof path !== "string") return;
    await recents.forget(path);
    await broadcast();
  });

  // The one channel that takes a path, and it takes it only to hand back
  // something the index already listed: containment is checked in main.
  onIpc(START_IPC.openFile, async (_event, path: unknown) => {
    if (typeof path !== "string") return;
    const folders = documentFolders().map((folder) => folder.path);
    if (!isInsideDocuments(path, folders)) return;
    await open(path);
  });

  /**
   * Re-read the store, on demand: the answer is a reading, and installing remains
   * the person's decision.
   */
  onIpc(START_IPC.startSync, async () => {
    await relay().start();
    await reportHub().catch((error: unknown) => {
      console.warn("[sync] could not report the hub's address", error);
    });
    await broadcast();
    return syncState();
  });

  onIpc(START_IPC.stopSync, async () => {
    await syncRelay?.stop();
    await reportHub().catch((error: unknown) => {
      console.warn("[sync] could not report the hub's address", error);
    });
    await broadcast();
    return syncState();
  });

  onIpc(START_IPC.setSyncScope, async (_event, scope: unknown) => {
    if (scope !== "loopback" && scope !== "network") return syncState();
    await relay().setScope(scope);
    await reportHub().catch((error: unknown) => {
      console.warn("[sync] could not report the hub's address", error);
    });
    await broadcast();
    return syncState();
  });

  // The console's token is in the URL Start already holds. The renderer names no
  // URL, so this remains a capability over the relay's own loopback page rather
  // than a browser launcher for anything a page asks for.
  onIpc(START_IPC.openSyncConsole, async () => {
    const current = syncRelay === null ? null : await syncRelay.snapshot();
    if (current?.consoleUrl === null || current?.consoleUrl === undefined) return false;
    // The line came from a child process. Open it only if it is the loopback HTTP
    // console this feature is for, never an arbitrary URL a relay printed.
    let consoleUrl: URL;
    try {
      consoleUrl = new URL(current.consoleUrl);
    } catch {
      return false;
    }
    if (consoleUrl.protocol !== "http:" || consoleUrl.hostname !== "127.0.0.1") return false;
    await shell.openExternal(consoleUrl.href);
    return true;
  });

  onIpc(START_IPC.checkUpdates, () => refreshAndBroadcast());

  onIpc(START_IPC.info, () => ({
    host: "start",
    version: app.getVersion(),
    platform: process.platform,
  }));
}

/** A target from argv, whether it is a file or a `suite://` link. */
function targetFromArgv(argv: readonly string[]): string | null {
  for (const argument of argv.slice(1)) {
    if (argument.startsWith("-")) continue;
    if (argument.startsWith("suite://") || argument.startsWith("suite-start://")) return argument;
    if (/[\\/]/u.test(argument) && /\.[A-Za-z0-9]+$/u.test(argument)) return argument;
  }
  return null;
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
    const target = targetFromArgv(argv);
    if (target) void open(target);
  });

  // Both are delivered before `ready`, so they are registered before it.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    if (app.isReady() && window) {
      void open(path);
      return;
    }
    pendingTargets.push(path);
  });

  app.on("open-url", (event, url) => {
    event.preventDefault();
    const parsed = parseDeepLink(url, { apps: ["start", "canvas", "planner", "budget"] });
    // A link to Start itself only brings the window forward; anything else is a
    // routing request, which is the whole reason Start owns the scheme.
    if (parsed.ok && parsed.value.app === "start") {
      if (window) {
        window.show();
        window.focus();
      }
      return;
    }
    if (app.isReady() && window) {
      void open(url);
      return;
    }
    pendingTargets.push(url);
  });

  void app.whenReady().then(async () => {
    dataDirectory = process.env.SUITE_START_DATA?.trim() || join(app.getPath("userData"));

    // The cross-form lock in the suite config directory. Electron's own lock lives in
    // `userData`, which differs between a dev run and a Flatpak, so without this each
    // form could open beside the other. A live holder wins; a stale pid is taken over.
    const launched = await takeHubLock(hubLockPath(hostPathTable()), process.pid, isAlive).catch(
      (error: unknown) => {
        console.warn("[start] the cross-form lock could not be read", error);
        return { kind: "free" as const };
      },
    );
    if (launched.kind === "held") {
      console.warn(
        `[start] another Start is already running (pid ${launched.holder.pid}); this one will exit`,
      );
      app.quit();
      return;
    }

    themeChoice = await loadThemeChoice(dataDirectory);
    nativeTheme.themeSource = themeChoice.mode;
    const paths = hostPathTable();
    const registryPath = registryPathFor(paths);
    const registryOverride = process.env.SUITE_START_REGISTRY?.trim();
    // A build from before the shared config directory kept its records in the data
    // directory — Electron's `userData`, unless `SUITE_START_DATA` named another one.
    // Copy them once, and only when nothing has written the new file.
    if (registryOverride === undefined || registryOverride.length === 0) {
      const adoption = await adoptLegacyRegistry({
        legacy: join(dataDirectory, REGISTRY_FILENAME),
        next: registryPath,
      });
      if (adoption.adopted) {
        console.log(`[registry] adopted ${adoption.source} at ${adoption.destination}`);
      }
    }
    registry = registryAt(registryPath);
    recents = recentsFile(dataDirectory);
    backend = nativePackageBackend({
      roots: roots(),
      registry,
      catalogue: ALL_CATALOGUE_APPS,
      host,
    });
    app.setAppUserModelId("run.suite.start");

    // The hub owns `suite://`; every other app is reached through it. The Flatpak
    // exports the scheme in its desktop entry, and a packaged dev build registers it
    // with the platform once.
    if (app.isPackaged) {
      try {
        app.setAsDefaultProtocolClient("suite");
      } catch {
        // No desktop integration available; the file manager path still works.
      }
    }

    protocol.handle("start", async (request) => {
      const root = join(appDir(), "dist", "renderer");
      // The shared resolver reads the raw URL and refuses a climb before the
      // URL parser can normalise it away.
      const resolved = resolveProtocolAsset(request.url, root, {
        scheme: "start",
        hosts: ["launcher"],
      });
      if (!resolved.ok) return new Response("not found", { status: 404 });
      // `net.fetch`, not the global: only this one can read a file URL.
      const response = await net.fetch(pathToFileURL(resolved.file).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", CSP);
      headers.set("X-Content-Type-Options", "nosniff");
      return new Response(response.body, { status: response.status, headers });
    });

    registerIpc();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        // A launcher's menu carries the launcher's verbs; the standard roles stay because
        // a window without Edit is a window people notice.
        {
          label: app.name,
          submenu: [
            { label: "Check for Updates", click: () => void refreshAndBroadcast() },
            { label: "Add App…", click: () => void addApp() },
            { type: "separator" },
            { label: "Open Applications Folder", click: () => void openFolder(applicationsRoot()) },
            { label: "Open Data Folder", click: () => void openFolder(dataDirectory) },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        { role: "viewMenu" },
        { role: "windowMenu" },
      ]),
    );

    // Locate the relay before the first state is drawn, so "not installed" is a fact
    // rather than the empty gap before a search.
    relay();

    // The window first, the relay second. A relay that cannot start — a missing binary,
    // or a port already taken — used to stop startup dead: no window, no error, just a
    // launcher that never appeared.
    window = createWindow();
    await show();

    void startRefreshRelay();

    // The window is up before the store is read, so a slow remote delays a card rather
    // than the launcher. What arrives is broadcast, and the cards redraw.
    await refreshCatalogue().catch((error: unknown) => {
      console.warn("[catalogue] the store could not be read", error);
    });
    await broadcast();

    const coldStart = targetFromArgv(process.argv);
    if (coldStart) pendingTargets.push(coldStart);
    const first = pendingTargets.shift();
    if (first) await open(first);

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        window = createWindow();
        void show();
      }
    });
  });

  app.on("before-quit", () => {
    // Best effort: a report that says the relay is still up would be a lie a reader acts on.
    void syncRelay
      ?.stop()
      .then(() => reportHub())
      .catch(() => undefined);
    void releaseHubLock(hubLockPath(hostPathTable()), process.pid).catch(() => undefined);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

export { dataDirectory };
