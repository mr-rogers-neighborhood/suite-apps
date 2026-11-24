import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appDocumentsFolder,
  parseDeepLink,
  SUITE_APPS,
  SUITE_WIDGET_SIZES,
  type SuiteAppEntry,
  type SuiteWidgetSize,
  suiteDocumentsRoot,
  suitePaths,
} from "@suite/contracts";
import { desktopCsp, isTrustedSender, resolveProtocolAsset } from "@suite/desktop";
import {
  createWidgetRegistry,
  defaultStartDashboard,
  START_HOME_SCREEN_ID,
  type WidgetRegistry,
} from "@suite/screens";
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
import { SYNC_APPLICATION } from "./flatpak.js";
import { defaultHost, SELF_FLATPAK_ID, sandboxId } from "./host.js";
import {
  adoptLegacyRegistry,
  dashboardPath,
  type HostPaths,
  hostPaths,
  hubLockPath,
  registryPathFor,
  releaseHubLock,
  removePreReleaseTree,
  takeHubLock,
} from "./hostPaths.js";
import { REGISTRY_FILENAME, type RegistryStore, registryAt } from "./installs.js";
import { stopApproach } from "./launchCommand.js";
import { clearLegacyHubReport, legacyHubReportPath } from "./legacyHubReport.js";
import { type NativePackageBackend, nativePackageBackend } from "./nativePackageBackend.js";
import { defaultRoots, nodeRegistryFileSystem } from "./nodeFileSystem.js";
import type { PackageLaunchObserver, PackageListing } from "./packageBackend.js";
import { RECENT_LIMIT, type RecentsFile, recentsFile } from "./recents.js";
import type { DiscoveredApp } from "./registry.js";
import { describeRouteRejection, routeLaunch } from "./route.js";
import { SCREENS_DIRECTORY, SCREENS_INDEX_FILENAME, ScreenStore } from "./screenStore.js";
import {
  availableScreenWidgets,
  resolveScreenWidgets,
  screenWidgetSizes,
  widgetDefaultSize,
  widgetSettingField,
} from "./screenView.js";
import {
  type AppLocation,
  type InstallProgress,
  type LauncherState,
  type RecentCard,
  type ResolvedTheme,
  type ScreenReplacement,
  type ScreensState,
  type ScreenView,
  START_CHANGED,
  START_INSTALL_PROGRESS,
  START_IPC,
  type SyncState,
} from "./shared.js";
import { isIconOf, shortcutIconPathIn, shortcutPathIn } from "./shortcuts.js";
import { resolveTheme } from "./theme.js";
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
/** What the desktop currently says, which `system` resolves against. */
function desktopPrefersDark(): boolean {
  return nativeTheme.shouldUseDarkColors;
}

/**
 * The default Suite palette, resolved against the desktop.
 *
 * Resolved in main because the page cannot import `@suite/theme` — it is plain ES modules
 * over `start://` with no bundler. Start is not the host, so there is no choice to send.
 */
function resolvedTheme(): ResolvedTheme {
  return resolveTheme(desktopPrefersDark());
}
/**
 * The last Sync operation that failed, so the pane can show it without a card.
 *
 * Cleared by a successful install or open, and never persisted: a failure that
 * outlived the session would describe something nobody just pressed.
 */
let syncFailure: string | null = null;

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
 * The Sync pane's state.
 *
 * Suite Sync is a Flatpak deployment, not a process Start owns: the backend reads it
 * from `flatpak list`, installs it from the Suite store, and opens it with `flatpak
 * run`. The app's tray keeps the relay and shows the address, code and fingerprint, so
 * this pane never repeats them.
 */
async function syncState(): Promise<SyncState> {
  const deployment = await backend.deployment(SYNC_APPLICATION);
  if (deployment.installed) syncFailure = null;
  const problem = deployment.installed ? deployment.problem : (syncFailure ?? deployment.problem);
  return {
    state: problem !== null ? "problem" : deployment.installed ? "installed" : "not-installed",
    version: deployment.version,
    commit: deployment.commit,
    problem,
  };
}

/**
 * Start's Home Screen.
 *
 * The store (`screenStore.ts`) owns the document, its atomic writes and its backups; this
 * is the process that holds one instance and the Screen the window currently shows. Home
 * is a role in a set of Screens, so `openScreenId` is window state and `homeId` is what a
 * launch restores.
 *
 * Nothing here reads app data: the registry knows which descriptors this build can draw,
 * and an id it cannot resolve stays on the Screen as a named placeholder.
 */
let screenStore: ScreenStore;
let openScreenId = START_HOME_SCREEN_ID;
let screensFailure: string | null = null;

interface ScreenAnswer {
  readonly note?: string;
  readonly replacement?: ScreenReplacement | null;
}

/** The app widget registry for this build: every installed manifest's declarations. */
function widgetRegistry(apps: readonly DiscoveredApp[]): WidgetRegistry {
  return createWidgetRegistry(
    apps.map((app) => ({ appId: app.manifest.id, widgets: app.manifest.widgets })),
  );
}

/** What the Home Screen pane and its manager draw. */
async function screensState(
  apps: readonly DiscoveredApp[],
  answer: ScreenAnswer = {},
): Promise<ScreensState> {
  const registry = widgetRegistry(apps);
  const summaries = await screenStore.summaries();
  const homeId = screenStore.homeId;
  if (!summaries.some((screen) => screen.id === openScreenId)) openScreenId = homeId;

  const opened = await screenStore.open(openScreenId);
  // A Screen can disappear between the listing and the read (a person at a file manager).
  // The default Home keeps the pane legible; the file note already says what happened.
  const screen = opened ?? defaultStartDashboard().screen;
  const screenView: ScreenView = {
    id: screen.id,
    name: screen.name,
    home: screen.id === homeId,
    widgets: resolveScreenWidgets(screen, registry),
  };

  return {
    homeId,
    openId: screen.id,
    screens: summaries.map((summary) => ({
      ...summary,
      home: summary.id === homeId,
      open: summary.id === screen.id,
    })),
    screen: screenView,
    available: availableScreenWidgets(screen, registry),
    note: screensFailure ?? screenStore.note,
    managerNote: answer.note ?? null,
    replacement: answer.replacement ?? null,
  };
}

/**
 * Run one Screen action and answer the new state.
 *
 * A refused edit (a move off the end, a size the widget does not offer) changes nothing
 * and still answers, so the controls describe the document that is actually there. A
 * failed write is a sentence in the pane, not a lost edit.
 */
async function withScreen(
  work: (apps: readonly DiscoveredApp[]) => Promise<ScreenAnswer>,
): Promise<ScreensState> {
  const apps = (await discover()).packages.map((entry) => entry.app);
  let answer: ScreenAnswer = {};
  try {
    answer = await work(apps);
    screensFailure = null;
  } catch (error) {
    screensFailure = `Start could not save your Screens: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  return screensState(apps, answer);
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
  // Flatpak is its writer, so the row can ask Flatpak for the newest build. The
  // button appears only when that deployment's own origin publishes another commit.
  const flatpakId = sandboxId();
  const selfUpdateCheck = await backend.checkSelfUpdate();
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
    screens: await screensState(apps),
    sync: await syncState(),
    self:
      self === undefined
        ? null
        : selfCard(self, app.getVersion(), {
            ...(flatpakId === null ? {} : { flatpak: true }),
            ...(selfUpdateCheck.checked ? { checked: true } : {}),
            ...(selfUpdateCheck.available ? { canUpdate: true } : {}),
            updated: selfUpdate.done,
            error: selfUpdate.error ?? selfUpdateCheck.error,
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
   * The Home Screen's inline edits.
   *
   * The page names a registry id, a direction or a size class; main validates it against
   * its own registry and writes its own document. There is no path in either direction, so
   * a renderer cannot point the Screen at a file of its choosing. Every call answers with
   * the new state, which is what the page redraws from.
   */
  onIpc(START_IPC.moveWidget, (_event, id: unknown, direction: unknown) =>
    withScreen(async () => {
      if (typeof id !== "string") return {};
      if (direction !== "earlier" && direction !== "later") return {};
      await screenStore.moveWidget(openScreenId, id, direction);
      return {};
    }),
  );

  onIpc(START_IPC.sizeWidget, (_event, id: unknown, size: unknown) =>
    withScreen(async (apps) => {
      if (typeof id !== "string" || typeof size !== "string") return {};
      if (!(SUITE_WIDGET_SIZES as readonly string[]).includes(size)) return {};
      if (!screenWidgetSizes(id, widgetRegistry(apps)).includes(size as SuiteWidgetSize)) return {};
      await screenStore.resizeWidget(openScreenId, id, size as SuiteWidgetSize);
      return {};
    }),
  );

  onIpc(START_IPC.addWidget, (_event, id: unknown) =>
    withScreen(async (apps) => {
      if (typeof id !== "string") return {};
      const registry = widgetRegistry(apps);
      const size = widgetDefaultSize(id, registry);
      if (size === null) return { note: `Nothing installed provides ${id}.` };
      const added = await screenStore.addWidget(openScreenId, { registryId: id, size });
      return added ? {} : { note: `${id} is already on this Screen.` };
    }),
  );

  onIpc(START_IPC.removeWidget, (_event, id: unknown) =>
    withScreen(async () => {
      if (typeof id !== "string") return {};
      const screen = await screenStore.open(openScreenId);
      // An empty Screen is a blank window with no widget left to remove. The last
      // placement stays, as it did on the dashboard.
      if (screen === null || screen.widgets.length <= 1) return {};
      await screenStore.removeWidget(openScreenId, id);
      return {};
    }),
  );

  onIpc(START_IPC.setWidgetSetting, (_event, id: unknown, field: unknown, value: unknown) =>
    withScreen(async (apps) => {
      if (typeof id !== "string" || typeof field !== "string" || typeof value !== "string") {
        return {};
      }
      if (widgetSettingField(id, field, widgetRegistry(apps)) === null) return {};
      if (value.length > 500) return {};
      await screenStore.setWidgetSetting(openScreenId, id, field, value);
      return {};
    }),
  );

  /**
   * The host-owned Screens manager.
   *
   * Start, not an app, creates, renames, duplicates and deletes a Screen, sets Home and
   * opens one. Deleting Home answers with the question first; the replacement id is the
   * answer to it.
   */
  onIpc(START_IPC.createScreen, (_event, name: unknown) =>
    withScreen(async () => {
      if (typeof name !== "string") return {};
      await screenStore.create(name);
      return {};
    }),
  );

  onIpc(START_IPC.renameScreen, (_event, id: unknown, name: unknown) =>
    withScreen(async () => {
      if (typeof id !== "string" || typeof name !== "string") return {};
      const renamed = await screenStore.rename(id, name);
      return renamed ? {} : { note: "That Screen is no longer here." };
    }),
  );

  onIpc(START_IPC.duplicateScreen, (_event, id: unknown) =>
    withScreen(async () => {
      if (typeof id !== "string") return {};
      const copy = await screenStore.duplicate(id);
      return copy === null ? { note: "That Screen is no longer here." } : {};
    }),
  );

  onIpc(START_IPC.deleteScreen, (_event, id: unknown, replacementId: unknown) =>
    withScreen(async () => {
      if (typeof id !== "string") return {};
      const removal = await screenStore.remove(
        id,
        typeof replacementId === "string" ? replacementId : null,
      );
      if (removal.ok) {
        if (openScreenId === id) openScreenId = removal.homeId;
        return {};
      }
      return {
        note: removal.message,
        replacement:
          removal.reason === "replacement"
            ? {
                forId: id,
                choices: removal.choices.map((screen) => ({ id: screen.id, name: screen.name })),
              }
            : null,
      };
    }),
  );

  onIpc(START_IPC.setHomeScreen, (_event, id: unknown) =>
    withScreen(async () => {
      if (typeof id !== "string") return {};
      const changed = await screenStore.setHome(id);
      return changed ? {} : { note: "That Screen is no longer here." };
    }),
  );

  onIpc(START_IPC.openScreen, (_event, id: unknown) =>
    withScreen(async () => {
      if (typeof id !== "string") return {};
      const screen = await screenStore.open(id);
      if (screen === null) return { note: "That Screen could not be opened." };
      openScreenId = screen.id;
      return {};
    }),
  );

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
   * Install Suite Sync, or open it, through the same backend as an app card.
   *
   * The tray app owns the relay: Start installs the deployment Flatpak manages and
   * starts it, and the app shows its own address, relay code and fingerprint. A
   * failure is a sentence on the pane, never a dead control.
   */
  onIpc(START_IPC.installSync, async () => {
    try {
      await backend.installDeployment(SYNC_APPLICATION);
      syncFailure = null;
    } catch (error) {
      syncFailure = describeInstallFailure(error);
    }
    await broadcast();
    return syncState();
  });

  onIpc(START_IPC.openSync, async () => {
    try {
      await backend.openDeployment(SYNC_APPLICATION, {
        failed: (reason) => {
          syncFailure = reason;
          void broadcast();
        },
      });
      syncFailure = null;
    } catch (error) {
      syncFailure = describeInstallFailure(error);
    }
    await broadcast();
    return syncState();
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

    // A Start that supervised a relay left `hub.json` behind, and Canvas still reads
    // it. This Start owns no relay, so the stale claim is removed before the first
    // window can report Sync state or a restore kit can connect to it.
    const legacyHub = {
      platform: process.platform,
      home: app.getPath("home"),
      xdgDataHome: dataHome(),
    };
    if (!(await clearLegacyHubReport(legacyHub))) {
      console.warn(
        `[sync] could not remove the legacy hub report at ${legacyHubReportPath(legacyHub)}`,
      );
    }

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

    // The Home Screen is Start's own document, under its own data directory. The old
    // dashboard layout is read once and kept beside itself as a dated backup.
    screenStore = ScreenStore.at({
      directory: join(dataDirectory, SCREENS_DIRECTORY),
      indexFile: join(dataDirectory, SCREENS_INDEX_FILENAME),
      dashboardFile: dashboardPath(paths),
    });
    const loadedScreens = await screenStore.load();
    openScreenId = loadedScreens.homeId;
    if (loadedScreens.note !== null) console.warn(`[screens] ${loadedScreens.note}`);

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

    window = createWindow();
    await show();

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
    void releaseHubLock(hubLockPath(hostPathTable()), process.pid).catch(() => undefined);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

export { dataDirectory };
