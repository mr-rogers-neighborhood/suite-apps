import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  appDocumentsFolder,
  hubReportPath,
  parseDeepLink,
  SUITE_APPS,
  type SuiteAppEntry,
  type SuiteHub,
  suiteApplicationsRoot,
  suiteDocumentsRoot,
  suitePaths,
} from "@suite/contracts";
import {
  desktopCsp,
  feedUrlFromAppUpdateYml,
  isTrustedSender,
  resolveProtocolAsset,
} from "@suite/desktop";
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
import { resolveAppIcon } from "./appIconFile.js";
import { appCards, fileCards, selfCard } from "./cards.js";
import {
  CATALOGUE_APPS,
  type CatalogueApp,
  type CatalogueEntry,
  readCatalogue,
  SELF_ID,
  withInstalled,
} from "./catalogue.js";
import { type DocumentsFolder, indexDocuments, isInsideDocuments } from "./fileIndex.js";
import {
  FLATPAK_APP_PREFIX,
  type FlatpakApp,
  findFlatpak,
  flatpakIdFor,
  flatpakLocation,
  flatpakRunArgs,
  flatpakScopeArgs,
  installedCommitArgs,
  installedInfoArgs,
  listFlatpaks,
  parseCommitOutput,
  parseVersionOutput,
  runFlatpak,
  storeInfoArgs,
  storeInstallArgs,
  storeRemote,
  storeUpdateArgs,
  withFlatpakInstalls,
} from "./flatpak.js";
import { writeHubReport } from "./hubReport.js";
import {
  executableInVersion,
  installApp,
  installedVersions,
  repairableInstalls,
} from "./install.js";
import { type RegistryStore, registryStore } from "./installs.js";
import { launchVerdict } from "./launchCheck.js";
import { defaultRoots, nodeRegistryFileSystem } from "./nodeFileSystem.js";
import { RECENT_LIMIT, type RecentsFile, recentsFile } from "./recents.js";
import { type RecoveryLookup, readRecoveryReports, recoveryFor } from "./recovery.js";
import {
  APP_MANIFEST_FILENAME,
  appById,
  type DiscoveredApp,
  discoverApps,
  type FlatpakInstall,
  type InstallRecord,
} from "./registry.js";
import { type ReportedUpdate, readReportedUpdate, type UpdateLookup } from "./reportedUpdate.js";
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
import {
  isIconOf,
  shortcutIconName,
  shortcutIconPath,
  shortcutPath,
  shortcutText,
} from "./shortcuts.js";
import { isAddressInUse, SuiteSyncRelay } from "./syncRelay.js";
import {
  isThemeChoice,
  loadThemeChoice,
  presetFor,
  saveThemeChoice,
  themeOptions,
} from "./theme.js";
import { checkForUpdates } from "./updateCheck.js";
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
 * test installs into a directory it can throw away.
 */
function applicationsRoot(): string {
  return suiteApplicationsRoot(
    process.platform,
    app.getPath("home"),
    process.env.SUITE_START_APPS_ROOT,
  );
}

/**
 * A local feed, in place of the published ones. Empty when not set.
 *
 * A folder is accepted as well as a URL, and turned into one: nothing else in this
 * process can read a path, and the point of the seam is that a person can point it at
 * releases they built on their own machine.
 */
function feedBase(): string | undefined {
  const named = process.env.SUITE_START_FEED_BASE?.trim();
  if (named === undefined || named.length === 0) return undefined;
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(named) ? named : pathToFileURL(resolve(named)).toString();
}

/**
 * The hub's own feed, from the `app-update.yml` electron-builder writes beside a
 * packaged binary. A dev run has no such file, so its row says the build has no feed.
 */
async function selfFeed(): Promise<string | null> {
  if (!app.isPackaged) return null;
  try {
    return feedUrlFromAppUpdateYml(
      await readFile(join(process.resourcesPath, "app-update.yml"), "utf8"),
    );
  } catch {
    return null;
  }
}

/**
 * One request per feed, and none of them may hold the window.
 *
 * `net.fetch` rather than the global: it is the only one that can read a `file:` URL, and
 * a feed in a local folder is how an install is proven before anything is published. A
 * feed that hangs is a launcher that hangs if this had no ceiling; ten seconds is long
 * enough for a slow network and short enough to be a reason rather than a stall.
 */
function fetchFeed(url: string): Promise<Response> {
  return net.fetch(url, { signal: AbortSignal.timeout(10_000) });
}

/** The fetch an install should use, for the same reason as `fetchFeed`. */
const installFetch: typeof globalThis.fetch = (url, init) =>
  net.fetch(typeof url === "string" ? url : url.toString(), init);

/**
 * The apps Start has started and not seen exit, by app id.
 *
 * A pid, not a promise: a window Start did not spawn (from the menu, say) is not in here
 * and cannot be, and pretending otherwise would put a "Running" on a card nobody checked.
 */
const runningPids = new Map<string, number>();

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
    else runningPids.delete(id);
  }
  return live;
}

/** What the catalogue last answered, and what is being installed right now. */
let catalogue: readonly CatalogueApp[] = [];
const installProgress = new Map<string, InstallProgress>();

/**
 * Ask every feed what it offers.
 *
 * This runs when the window opens and when a person presses a button — never on a timer,
 * and it never downloads. A feed it cannot read becomes a sentence on the card rather
 * than a failure of the window.
 */
async function refreshCatalogue(): Promise<void> {
  const { apps } = await discover();
  const [next] = await Promise.all([
    readCatalogue({
      installed: new Map(apps.map((entry) => [entry.manifest.id, entry.manifest.version])),
      feedBase: feedBase(),
      selfFeed: await selfFeed(),
      fetch: fetchFeed,
    }),
    // The store is read on the same occasions as the feeds: when the window opens
    // and when a person asks it to look again. Never on a timer.
    storeCommits(true),
  ]);
  catalogue = next;
}

/** How many versions of each catalogue app are on disk here. One listing each. */
async function versionCounts(): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  const root = applicationsRoot();
  await Promise.all(
    CATALOGUE_APPS.map(async (entry) => {
      counts.set(entry.id, (await installedVersions(root, entry)).length);
    }),
  );
  return counts;
}

/**
 * The version each app could go back to, by app id.
 *
 * Read from the disk rather than remembered: an update keeps exactly one replaced version
 * (§RETAINED_VERSIONS), and a card should offer the button only when that directory is
 * really there. The installed version is the one discovery found, so this cannot disagree
 * with the version the card prints.
 */
async function previousVersions(
  apps: readonly DiscoveredApp[],
): Promise<ReadonlyMap<string, string | null>> {
  const root = applicationsRoot();
  const installed = new Map(apps.map((app) => [app.manifest.id, app.manifest.version]));
  const previous = new Map<string, string | null>();
  await Promise.all(
    CATALOGUE_APPS.map(async (entry) => {
      const here = installed.get(entry.id);
      const versions = await installedVersions(root, entry);
      previous.set(entry.id, versions.find((version) => version !== here) ?? null);
    }),
  );
  return previous;
}

/** Send the progress list, which is the only thing that changes while a bar moves. */
function sendProgress(): void {
  window?.webContents.send(START_INSTALL_PROGRESS, [...installProgress.values()]);
}

function reportProgress(progress: InstallProgress): void {
  installProgress.set(progress.id, progress);
  sendProgress();
}

/**
 * Where each app keeps its machine-local state.
 *
 * The same roots `suitePaths` gives the app itself, so a report is read from the
 * place it was written. The documents override does not apply: an update report is
 * machine state, not a document.
 */
function updateLookup(): UpdateLookup {
  return {
    platform: process.platform,
    home: app.getPath("home"),
    xdgDataHome: process.env.XDG_DATA_HOME,
  };
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
        data: suitePaths(entry.folder, { platform, home, xdgDataHome: process.env.XDG_DATA_HOME })
          .data,
      },
    ];
  });
}

function documentFolders(): readonly DocumentsFolder[] {
  const platform = process.platform;
  const home = app.getPath("home");
  const rootOverride = process.env.SUITE_START_DOCUMENTS;
  return SUITE_APPS.map((entry: SuiteAppEntry) => ({
    app: entry,
    path: appDocumentsFolder(entry, {
      platform,
      home,
      rootOverride,
      xdgDataHome: process.env.XDG_DATA_HOME,
    }),
  }));
}

/**
 * What Flatpak has installed, cached for a moment.
 *
 * `state()` runs on every broadcast, including once per download chunk's
 * screen. The listing changes only when Flatpak does something, so a short
 * cache keeps the window honest without spawning a process per redraw. Start
 * clears it after it has just changed the answer.
 */
const FLATPAK_CACHE_MS = 30_000;

let flatpakCache: { readonly at: number; readonly apps: readonly FlatpakApp[] } | null = null;

async function flatpakInstalls(): Promise<readonly FlatpakApp[]> {
  if (findFlatpak() === null) return [];
  const now = Date.now();
  if (flatpakCache !== null && now - flatpakCache.at < FLATPAK_CACHE_MS) {
    return flatpakCache.apps;
  }
  const listed = await listFlatpaks();
  // `flatpak list` does not carry the commit, and the commit is the only stable
  // way to say "the store has a different build": `remote-info` does not publish
  // the app's version. One extra query per suite app, cached with the listing.
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

const STORE_CACHE_MS = 60_000;
const NO_STORE: ReadonlyMap<string, string> = new Map();

async function storeCommits(force = false): Promise<ReadonlyMap<string, string>> {
  if (findFlatpak() === null) return NO_STORE;
  const now = Date.now();
  if (!force && storeCache !== null && now - storeCache.at < STORE_CACHE_MS) {
    return storeCache.commits;
  }

  const remote = storeRemote();
  const commits = new Map<string, string>();
  await Promise.all(
    CATALOGUE_APPS.map(async (entry) => {
      try {
        const commit = parseCommitOutput(
          await runFlatpak(storeInfoArgs(remote, flatpakIdFor(entry.id))),
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

async function discover(): Promise<{
  apps: readonly DiscoveredApp[];
  refused: readonly { path: string; reason: string }[];
}> {
  const [result, installs] = await Promise.all([
    discoverApps({
      roots: roots(),
      records: await registry.list(),
      fileSystem: nodeRegistryFileSystem(),
    }),
    flatpakInstalls(),
  ]);
  const executable = findFlatpak();
  const merged =
    executable === null
      ? result
      : withFlatpakInstalls(result, installs, CATALOGUE_APPS, executable);
  return { apps: merged.apps, refused: merged.rejected };
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
    xdgDataHome: process.env.XDG_DATA_HOME,
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
  const { apps, refused } = await discover();
  const recent = await recents.list();
  const files = await indexDocuments(
    documentFolders(),
    nodeRegistryFileSystem(),
    new Set(apps.map((entry) => entry.manifest.id)),
  );

  // What each app says about its own updating. Still read, because an app Start did not
  // install updates itself and the card should be able to say what it found.
  const updates = new Map<string, ReportedUpdate>();
  await Promise.all(
    apps.map(async (entry) => {
      updates.set(
        entry.manifest.id,
        await readReportedUpdate(entry.manifest.id, updateLookup(), nodeRegistryFileSystem()),
      );
    }),
  );

  const self = catalogue.find((entry) => entry.id === SELF_ID);
  const cards = appCards({
    apps,
    rejected: refused,
    files,
    recents: recent,
    updates,
    catalogue,
    versions: await versionCounts(),
    previous: await previousVersions(apps),
    running: liveRunning(),
    appsRoot: applicationsRoot(),
    store: storeCache?.commits ?? NO_STORE,
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
    // The hub cannot replace its own running binary, so it says what it is rather than
    // offering a button that would fail.
    self: self === undefined ? null : selfCard(self, app.getVersion()),
    installing: [...installProgress.values()],
    launchErrors: Object.fromEntries(launchFailures),
  };
}

/**
 * The variable that tells an app it was started by the hub.
 *
 * An app launched this way leaves its own updating alone, because Start is the process
 * that downloads, verifies and replaces it (D45). A copy run from a folder gets no such
 * promise and keeps its own updater — which is what the release notes have always said.
 */
const MANAGED_BY_ENV = "SUITE_MANAGED_BY";

/**
 * Launch failures, by app id, since the window opened.
 *
 * A launch is not an install, so this is not `installProgress`: it is a sentence the card
 * shows until the next successful launch. Kept in memory only, because a failure that
 * outlived the session would be a claim about a launch nobody just made.
 */
const launchFailures = new Map<string, string>();

/**
 * Start a process and let go of it — watching the first moment before letting go.
 *
 * Detached, `unref`, and output discarded, so an app outlives the launcher the way a
 * browser tab outlives the window that opened it. The cost of discarding output is that a
 * binary which dies immediately is indistinguishable from one that opened and stayed:
 * the card still says Open and nothing moved. So stderr is kept for the first second and
 * a half, which is long enough to catch a missing library and short enough to stay
 * invisible for an app that started.
 *
 * A failure to mount is retried once with `APPIMAGE_EXTRACT_AND_RUN=1` instead of being
 * reported. The person pressed Open; they did not ask to learn about FUSE.
 */
function spawnExecutable(executable: string, argv: readonly string[], appId?: string): void {
  const child = spawn(executable, [...argv], {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    // The app is being started by the thing that also updates it. Only a launch Start
    // performs carries this; a desktop entry or a shell run does not.
    env: appId === undefined ? process.env : { ...process.env, [MANAGED_BY_ENV]: "start" },
  });

  let stderr = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    if (stderr.length < 8192) stderr += chunk;
  });

  if (appId !== undefined && child.pid !== undefined) runningPids.set(appId, child.pid);

  let settled = false;
  const settle = (): void => {
    settled = true;
    child.stderr?.removeAllListeners("data");
    child.stderr?.destroy();
    child.unref();
    if (appId !== undefined && launchFailures.delete(appId)) void broadcast();
  };
  setTimeout(settle, 1_500);

  // Always: a window that closes is news even if it opened fine, because the card says
  // "running" and nobody else is going to redraw it.
  child.once("exit", () => {
    if (appId !== undefined && runningPids.get(appId) === child.pid) {
      runningPids.delete(appId);
      void broadcast();
    }
  });

  child.once("exit", (code) => {
    if (settled) return;
    settled = true;
    const verdict = launchVerdict({ executable, exitCode: code, stderr });

    if (verdict.kind === "retry-without-fuse") {
      console.warn(`[launch] ${executable}: ${verdict.reason}; retrying without FUSE 2`);
      spawn(executable, [...argv], {
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
    console.warn(`[launch] ${executable}: ${verdict.reason}`);
    launchFailures.set(appId, verdict.reason);
    void broadcast();
  });
}

function spawnApp(app_: DiscoveredApp, argv: readonly string[]): void {
  // A Flatpak is started by the CLI that owns it; everything after `run <id>` is
  // the app's own argument, exactly as an AppImage would receive it.
  const args = app_.flatpak === undefined ? argv : flatpakRunArgs(app_.flatpak.application, argv);
  spawnExecutable(app_.executable, args, app_.manifest.id);
}

/** Resolve one target and start the app that owns it. */
async function open(target: string): Promise<void> {
  const { apps } = await discover();
  const routed = routeLaunch(target, apps);
  if (!routed.ok) {
    const message = describeRouteRejection(routed.reason);
    if (window) {
      await dialog.showMessageBox(window, { type: "warning", title: "Suite Start", message });
    }
    return;
  }
  spawnApp(routed.plan.app, routed.plan.argv);
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

  // A packaged Suite app ships its manifest beside its own executable, so the
  // record that knows the binary knows where to read what it is.
  const manifestPath = join(dirname(executable), "suite.app.json");
  let record: InstallRecord = { executable, id: "", manifestPath };
  try {
    const text = await nodeRegistryFileSystem().readText(manifestPath);
    const parsed: unknown = JSON.parse(text);
    const id = (parsed as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0) throw new Error("no id");
    record = { ...record, id, installedAt: new Date().toISOString() };
  } catch {
    await dialog.showMessageBox(window, {
      type: "error",
      title: "Not a Suite app",
      message:
        "That executable has no suite.app.json beside it, so Start cannot tell what it is. " +
        "Pick an application installed by Suite.",
    });
    return;
  }

  await registry.add(record);
  await broadcast();
}

/** Where a user-scope application entry lives, and where its icon goes. */
function shortcutDirs(): { entry: (id: string) => string; icon: (name: string) => string } {
  const platform = process.platform;
  const home = app.getPath("home");
  return {
    entry: (id) => shortcutPath(platform, home, id),
    icon: (name) => shortcutIconPath(platform, home, name),
  };
}

/**
 * Write (or rewrite) the menu entry for a managed install.
 *
 * The entry names the versioned executable, so an update has to rewrite it — which is why
 * it is one file per app rather than one per version. Failure is a warning, never a failed
 * install: a missing menu entry is a smaller problem than an app that will not install.
 *
 * The icon is the **app's**, looked up by id (`appIconFile.ts`). It used to be the hub's
 * own mark copied under every app's name, which is why three apps shared one menu icon.
 */
async function writeShortcut(entry: CatalogueEntry, executable: string): Promise<void> {
  const dirs = shortcutDirs();
  let iconName: string | null = null;
  try {
    const iconSource = appIcon(entry.id);
    if (iconSource !== null) {
      const bytes = await readFile(iconSource);
      // The name carries the content, so no desktop can serve a cached picture under it
      // (§shortcutIconName). Eight hex characters is a fingerprint, not a security boundary.
      iconName = shortcutIconName(entry.id, iconDigest(bytes));
      const destination = dirs.icon(iconName);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes);
      await pruneIcons(entry.id, iconName);
      await refreshIconCache();
    } else {
      console.warn(`[shortcut] no artwork for ${entry.id}; its entry keeps a generic icon`);
    }
    const path = dirs.entry(entry.id);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      shortcutText({
        id: entry.id,
        name: entry.name,
        executable,
        extensions: [...entry.extensions],
        // Null rather than a name with nothing behind it: an entry pointing at a missing
        // icon draws a generic placeholder, and one with no `Icon=` line at least says why.
        iconName,
      }),
    );
    // Best effort: the cache is a convenience, and a machine without the tool still finds
    // a freshly written file on its next scan.
    const refresh = spawn("update-desktop-database", [dirname(path)], { stdio: "ignore" });
    refresh.on("error", () => undefined);
    refresh.unref();
  } catch (error) {
    console.warn(`[shortcut] could not write the entry for ${entry.id}`, error);
  }
}

/** A short, stable fingerprint of an icon's bytes, for the name it is written under. */
function iconDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

/**
 * Remove the icons earlier builds left for one app.
 *
 * Hashed names are why this exists: every new artwork leaves the old file behind, and a
 * directory of orphans is the same problem as a menu entry pointing at a version that was
 * deleted. Only this app's own names are touched (§isIconOf).
 */
async function pruneIcons(id: string, keep: string): Promise<void> {
  const directory = dirname(shortcutDirs().icon(keep));
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name !== `${keep}.png` && isIconOf(id, name))
      .map((name) => rm(join(directory, name), { force: true }).catch(() => undefined)),
  );
}

/**
 * Tell GTK the hicolor theme changed, and wait for it.
 *
 * `gtk-update-icon-cache` is what makes a freshly written PNG resolvable by *name* on
 * desktops that read the cache. Without it the entry can keep drawing the icon it cached
 * for that name, which for a replaced app is the old artwork.
 *
 * Awaited rather than fire-and-forget, unlike `update-desktop-database` below: this tool
 * writes into the same tree the PNG was just placed in, so a cache built before the file
 * lands is a stale cache. It resolves on `error` too, so a machine without the tool costs
 * one failed spawn and nothing else.
 */
function refreshIconCache(): Promise<void> {
  const themeDir = join(app.getPath("home"), ".local", "share", "icons", "hicolor");
  return new Promise((done) => {
    const refresh = spawn("gtk-update-icon-cache", ["-f", "-t", themeDir], { stdio: "ignore" });
    refresh.on("error", () => done());
    refresh.on("close", () => done());
  });
}

/**
 * Re-write the menu entry and icon of every app this hub installed.
 *
 * Idempotent and cheap — one file and one PNG per app — so it runs at startup rather than
 * behind a button nobody would press. It is what carries a correction to entries written by
 * an older build, which is most of them: an entry is only rewritten when its app is installed
 * or updated, and an app that is already current never is.
 */
async function reconcileShortcuts(): Promise<void> {
  try {
    const records = await registry.list();
    const repairable = repairableInstalls(records, applicationsRoot(), (path) => existsSync(path));
    for (const record of repairable) {
      const entry = CATALOGUE_APPS.find((candidate) => candidate.id === record.id);
      if (entry !== undefined) await writeShortcut(entry, record.executable);
    }
  } catch (error) {
    console.warn("[shortcut] could not reconcile the menu entries", error);
  }
}

/** Remove an app's entry and icon. Best effort, for the same reason as writing them. */
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
 * Ask an app Start started to close, and wait a moment for it.
 *
 * SIGTERM first, because that is a request an app can answer — a document can be flushed.
 * The caller decides what to do if it is still there afterwards; this never escalates on
 * its own.
 */
function stopApp(id: string): void {
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

/** The sentence a failed install shows, which is what the step that failed wrote. */
function describeInstallFailure(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "the install did not finish, and nothing was replaced";
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
 * Finish a Flatpak install or update.
 *
 * The listing and the store are both re-read, because either may have changed:
 * the app now exists, and the commit the store offers is the one that was just
 * installed. The card then has one answer rather than a stale one.
 */
async function finishFlatpak(id: string, install: FlatpakInstall): Promise<void> {
  flatpakCache = null;
  const version = await flatpakVersionOf(install);
  if (version !== null) catalogue = withInstalled(catalogue, id, version);
  await storeCommits(true);
  installProgress.delete(id);
  sendProgress();
  await broadcast();
}

/** Install one app from the store, with the card saying Flatpak is working. */
async function installFromFlatpak(id: string): Promise<void> {
  reportProgress({ id, phase: "installing", received: 0, total: null, reason: null });
  try {
    await runFlatpak(storeInstallArgs(storeRemote(), flatpakIdFor(id)));
    await finishFlatpak(id, { application: flatpakIdFor(id), installation: "user" });
  } catch (error) {
    reportProgress({
      id,
      phase: "failed",
      received: 0,
      total: null,
      reason: describeInstallFailure(error),
    });
  }
}

/**
 * Replace a deployment Flatpak already owns.
 *
 * A running app keeps running the old commit until it restarts; Flatpak swaps the
 * deployment underneath it. That is the writer's rule, and closing the window
 * would be Start doing a job it does not own.
 */
async function replaceWithFlatpak(id: string, install: FlatpakInstall): Promise<void> {
  reportProgress({ id, phase: "installing", received: 0, total: null, reason: null });
  try {
    await runFlatpak(storeUpdateArgs(install));
    await finishFlatpak(id, install);
  } catch (error) {
    reportProgress({
      id,
      phase: "failed",
      received: 0,
      total: null,
      reason: describeInstallFailure(error),
    });
  }
}

/**
 * Install or update one app, and let the card watch it happen.
 *
 * The artifact is downloaded to a staging directory, checked against the fingerprint the
 * verified manifest named, and only then placed. So a download that fails, or a file that
 * is not the one the publisher signed, leaves the previous install exactly as it was.
 */
async function installOne(id: string): Promise<void> {
  const entry = catalogue.find((app) => app.id === id);
  if (entry === undefined) return;

  // Flatpak owns its installs, so when it is the writer Start asks it and waits.
  // The store is also the install channel for an app it offers, which is what
  // makes a fresh machine's Install button work without an AppImage feed.
  const { apps } = await discover();
  const installed = appById(apps, id);
  if (installed?.flatpak !== undefined) {
    await replaceWithFlatpak(entry.id, installed.flatpak);
    return;
  }
  const store = await storeCommits();
  if (installed === null && store.has(id)) {
    await installFromFlatpak(entry.id);
    return;
  }

  if (entry.available === null || entry.artifact === null) {
    reportProgress({
      id,
      phase: "failed",
      received: 0,
      total: null,
      reason: entry.reason ?? "the feed named no file to install",
    });
    return;
  }

  const artifact = entry.artifact;
  const version = entry.available;
  // An update replaces a version this machine already has, and finishes by relaunching it.
  const updating = entry.installed !== null && entry.installed !== version;

  // Replacing the bytes under a live process is legal on Linux and rude in practice: the
  // window a person is using would keep running the old image until they closed it. So an
  // app Start started is closed first, by asking.
  if (runningPids.has(id) && window !== null) {
    const answer = await dialog.showMessageBox(window, {
      type: "question",
      title: "Update",
      message: `Close ${entry.name} and update it to ${version}?`,
      detail: "It will be reopened when the new version is in place.",
      buttons: ["Cancel", "Close and update"],
      defaultId: 1,
      cancelId: 0,
    });
    if (answer.response !== 1) return;

    stopApp(id);
    if (!(await waitForExit(id))) {
      reportProgress({
        id,
        phase: "failed",
        received: 0,
        total: null,
        reason: `${entry.name} did not close, so nothing was replaced`,
      });
      return;
    }
  }
  let emitted = { at: 0, percent: -1 };
  reportProgress({ id, phase: "downloading", received: 0, total: artifact.size, reason: null });

  try {
    const installed = await installApp({
      entry,
      version,
      artifact,
      feed: entry.feed,
      appsRoot: applicationsRoot(),
      registry,
      fetch: installFetch,
      prune: updating,
      onProgress: (received, total) => {
        const percent = total === null || total === 0 ? -1 : Math.floor((received / total) * 100);
        const at = Date.now();
        // A bar does not need every chunk, and the window is not the thing being written.
        if (percent === emitted.percent && at - emitted.at < 500) return;
        emitted = { at, percent };
        reportProgress({ id, phase: "downloading", received, total, reason: null });
      },
    });

    installProgress.delete(id);
    sendProgress();
    await writeShortcut(entry, installed.executable);
    // The feed answer is still the last check's; only what is on disk changed.
    catalogue = withInstalled(catalogue, id, installed.version);
    await broadcast();
    // A replace should finish where it started: the app a person was using is running
    // again, from the version they just agreed to.
    if (updating) spawnExecutable(installed.executable, []);
  } catch (error) {
    reportProgress({
      id,
      phase: "failed",
      received: 0,
      total: null,
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

/** Read the feeds again and redraw, which is what the menu item and the button both do. */
async function refreshAndBroadcast(): Promise<void> {
  for (const [id, progress] of installProgress) {
    if (progress.phase === "failed") installProgress.delete(id);
  }
  await refreshCatalogue().catch((error: unknown) => {
    console.warn("[catalogue] the feeds could not be read", error);
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

/** One app's own artwork, for its menu entry. Never the hub's mark (§appIconFile). */
function appIcon(id: string): string | null {
  return resolveAppIcon({
    id,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: appDir(),
    exists: (path) => existsSync(path),
  });
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
    const { apps } = await discover();
    const target = appById(apps, id);
    if (!target) return;
    spawnApp(target, []);
    await broadcast();
  });

  onIpc(START_IPC.addApp, () => addApp());

  /**
   * Install or update one app, with the card watching.
   *
   * Every step here is the person's: the feed was read because the window opened or
   * because they asked it to look again, and this runs only because they pressed the
   * button the card drew.
   */
  onIpc(START_IPC.installApp, async (_event, id: unknown) => {
    if (typeof id !== "string") return;
    await installOne(id);
  });

  onIpc(START_IPC.removeApp, async (_event, id: unknown) => {
    if (typeof id !== "string") return;
    // A refusal that cannot be launched leaves a record and nothing else to delete.
    await registry.remove(id);
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
    const { apps } = await discover();
    const target = appById(apps, id);
    if (target === null) return;
    // A Flatpak has no file of its own to show. The deployment directory is the
    // closest true answer, and it is the one `flatpak info` already knows.
    if (target.flatpak !== undefined) {
      const location = await flatpakLocation(target.flatpak);
      if (location !== null) await shell.openPath(location);
      return;
    }
    shell.showItemInFolder(target.executable);
  });

  /**
   * Uninstall: remove what Start installed, and forget it.
   *
   * "Remove" that leaves two hundred megabytes behind is a lie by omission, so this is the
   * only removal a card offers for a managed install — with one dialog that names what
   * goes. A copy Start did not place is not Start's to delete, and keeps the forget path.
   */
  onIpc(START_IPC.uninstallApp, async (_event, id: unknown) => {
    if (typeof id !== "string" || window === null) return;
    const entry = CATALOGUE_APPS.find((candidate) => candidate.id === id);
    if (entry === undefined) return;

    const found = appById((await discover()).apps, id);
    if (found?.flatpak !== undefined) {
      // Flatpak owns these files, so Start asks Flatpak to remove them and then
      // stops describing itself as installed. Nothing under ~/Applications is
      // touched: there may be an AppImage there that is somebody else's.
      const confirm = await dialog.showMessageBox(window, {
        type: "warning",
        title: "Uninstall",
        message: `Uninstall ${entry.name} from Flatpak?`,
        detail:
          `This asks Flatpak to remove ${found.flatpak.application} from the ` +
          `${found.flatpak.installation} installation. Documents are not touched.`,
        buttons: ["Cancel", "Uninstall"],
        defaultId: 0,
        cancelId: 0,
      });
      if (confirm.response !== 1) return;

      if (runningPids.has(id)) {
        stopApp(id);
        await waitForExit(id);
        runningPids.delete(id);
      }
      try {
        await runFlatpak([
          ...flatpakScopeArgs(found.flatpak.installation),
          "uninstall",
          "--noninteractive",
          found.flatpak.application,
        ]);
      } catch (error) {
        console.warn(`[flatpak] could not uninstall ${found.flatpak.application}`, error);
        await dialog.showMessageBox(window, {
          type: "error",
          title: "Uninstall",
          message: `${entry.name} was not removed.`,
          detail: "Flatpak refused the request; its own output is in the log.",
        });
        return;
      }
      flatpakCache = null;
      catalogue = withInstalled(catalogue, id, null);
      await broadcast();
      return;
    }

    const versions = await installedVersions(applicationsRoot(), entry);
    const answer = await dialog.showMessageBox(window, {
      type: "warning",
      title: "Uninstall",
      message: `Uninstall ${entry.name}?`,
      detail:
        versions.length === 0
          ? "No files are installed here; this only forgets the app."
          : `This deletes ${versions.length} version${versions.length === 1 ? "" : "s"} ` +
            `from ${applicationsRoot()}/${entry.folder}, its menu entry, and its install ` +
            "record. Documents are not touched.",
      buttons: ["Cancel", "Uninstall"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return;

    if (runningPids.has(id)) {
      stopApp(id);
      await waitForExit(id);
      runningPids.delete(id);
    }
    await rm(join(applicationsRoot(), entry.folder), { recursive: true, force: true });
    catalogue = withInstalled(catalogue, id, null);
    await removeShortcut(id);
    await registry.remove(id);
    await broadcast();
  });

  /**
   * Roll back: point the install at the version it replaced.
   *
   * Deliberately dumb. It writes no new record shape, downloads nothing, and takes no view
   * on which version is good — it moves the one path in `installs.json` to a directory this
   * hub is already holding. The card offers it only because that directory is on disk.
   *
   * The replaced version is kept after a rollback too, so going back is not a one-way door:
   * the version just left becomes the one to return to, and `pruneOtherVersions` reads the
   * disk rather than a history, so it does not care which direction the walk went.
   */
  onIpc(START_IPC.rollbackApp, async (_event, id: unknown) => {
    if (typeof id !== "string") return;
    const entry = CATALOGUE_APPS.find((candidate) => candidate.id === id);
    if (entry === undefined) return;

    const { apps } = await discover();
    const current = appById(apps, id);
    const versions = await installedVersions(applicationsRoot(), entry);
    const target = versions.find((version) => version !== current?.manifest.version);
    if (target === undefined) return;

    const executable = await executableInVersion(applicationsRoot(), entry, target);
    if (executable === null) {
      console.warn(`[rollback] no executable in ${entry.name} ${target}`);
      await broadcast();
      return;
    }

    // A running copy is the version being replaced; it goes the same way an update sends it.
    if (runningPids.has(id)) {
      stopApp(id);
      await waitForExit(id);
      runningPids.delete(id);
    }

    await registry.add({
      id,
      executable,
      manifestPath: join(dirname(executable), APP_MANIFEST_FILENAME),
      installedAt: new Date().toISOString(),
    });
    catalogue = withInstalled(catalogue, id, target);
    await writeShortcut(entry, executable);
    await broadcast();

    // Same courtesy an update pays: finish where it started.
    spawnExecutable(executable, [], id);
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
   * Ask each app's feed whether something newer exists.
   *
   * On demand, one request per app, and nothing is written: the answer is a
   * reading, and installing remains the app's business.
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
    themeChoice = await loadThemeChoice(dataDirectory);
    nativeTheme.themeSource = themeChoice.mode;
    registry = registryStore(dataDirectory);
    recents = recentsFile(dataDirectory);
    app.setAppUserModelId("run.suite.start");

    // The hub owns `suite://`; every other app is reached through it. An
    // installed package declares the scheme in its desktop entry, an AppImage
    // does not, so ask the platform once when packaged.
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

    // After the window, never before it: this is housekeeping, and a person opening the
    // launcher should not wait for three icons.
    void reconcileShortcuts();

    // The window is up before any feed is read, so a slow network delays a card rather
    // than the launcher. What arrives is broadcast, and the cards redraw.
    await refreshCatalogue().catch((error: unknown) => {
      console.warn("[catalogue] the feeds could not be read", error);
    });
    await broadcast();

    // The hub updates itself like any app: its own feed, its own report. A dev run
    // has no feed, so it does not ask.
    void checkForUpdates({
      dataDir: dataDirectory,
      version: app.getVersion(),
      channel: "alpha",
      packaged: app.isPackaged,
    }).then(({ error }) => {
      if (error !== null && app.isPackaged) console.warn(`[update] ${error}`);
    });

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
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

export { dataDirectory };
