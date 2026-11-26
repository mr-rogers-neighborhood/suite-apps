import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { desktopCsp, isTrustedSender, resolveProtocolAsset } from "@suite/desktop";
import { isPublisherKeyTrusted, type PackDocument, SUITE_PUBLISHER_ID } from "@suite/pack";
import { isPackCapability, type PackCapability } from "@suite/pack/capabilities";
import { SCREEN_FILE_EXTENSION, SCREEN_FILE_MAX_BYTES, SUITE_SCREEN_VERSION } from "@suite/screens";
import { DENSITIES } from "@suite/theme";
import {
  app,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  Notification,
  nativeTheme,
  net,
  protocol,
  webContents,
} from "electron";
import {
  type CataloguePack,
  catalogueEntry,
  catalogueRootFor,
  installCataloguePack,
  loadCatalogue,
} from "./catalogue.js";
import { CommandBroker, type HostCommand } from "./commandBroker.js";
import { invokeProvider, registerCommandChannels } from "./commandInvocation.js";
import { CommandRecency, ScopeRowsCache } from "./commandSurface.js";
import {
  CAPABILITY_DENIALS,
  CAPABILITY_REASONS,
  CAPABILITY_TITLES,
  ConsentDeniedError,
  type ConsentPackVersion,
  ConsentRecord,
  type ConsentRequest,
  consentTierFor,
} from "./consent.js";
import { DEFAULT_CONTAINER_ID } from "./container.js";
import { LAUNCHER_CONTEXT, suiteLinkFromArgv } from "./deepLink.js";
import { DocumentMigrations, findDocument } from "./documentMigrations.js";
import { DocumentStore, declaredDocumentSchemaVersion } from "./documents.js";
import { type ExternalDialog, ExternalFilesService } from "./external.js";
import { type FilesScope, filesScope, PackFilesService } from "./files.js";
import { migrateHome } from "./home.js";
import { catalogueIndexUrlFor, loadCatalogueIndex } from "./indexTrust.js";
import {
  checkPackArchive,
  comparePackVersions,
  describePackInstall,
  InstalledPackError,
  type InstalledPackInfo,
  type InstalledVersion,
  installPackArchive,
  loadInstalledPacks,
  MAX_ARCHIVE_BYTES,
  type PackInstallSummary,
  type PackTrustOptions,
  packInstallSummary,
  uninstallPackVersion,
} from "./installedPacks.js";
import { type LibraryScope, LibraryWatch, revealDocument } from "./library.js";
import { planUninstall } from "./lifecycle.js";
import { completeOnboarding, isFirstRun } from "./onboarding.js";
import { documentScopeLabel, documentsRootFor } from "./packIdentity.js";
import {
  type DeviceKey,
  derivePackKey,
  openDeviceKey,
  packIdentityView,
  signPackRecord,
} from "./packIdentityKey.js";
import { devPacksEnabled, mergePackSources, shouldOpenAfterInstall } from "./packRegistry.js";
import {
  importRevocationAdvisory,
  openRevocations,
  type RevocationAdvisory,
} from "./packRevocation.js";
import {
  discoverPacks,
  externalLinkFor,
  HOST_CAPABILITIES,
  HOST_CONTRACT_VERSION,
  HOST_VERSION,
  hostRingsFor,
  type PackInfo,
  packAllows,
  packOrigin,
  packsRootFor,
} from "./packs.js";
import { checkPublisherRotation, parseRotationStatement } from "./publisherRotation.js";
import {
  addTrustedPublisher,
  applyPublisherRotation,
  openPublisherTrust,
  type PublisherTrustStore,
  preinstalledTrustStore,
  trustRootFor,
} from "./publisherTrust.js";
import { type RecentsScope, RecentsStore } from "./recents.js";
import { RelayBroker, type RelayScope as RelayBrokerScope } from "./relayAdapter.js";
import { openPinnedRelaySocket } from "./relaySocket.js";
import { RelaySupervisor, type RelaySupervisorStatus } from "./relaySupervisor.js";
import { createReminderDelivery, type ReminderPlatform } from "./reminderDelivery.js";
import { RendererProjectionRunner, registerProjectionChannels } from "./reminderProjections.js";
import {
  type ProjectedReminder,
  parseProjectedReminders,
  type ReminderClock,
  type ReminderPermission,
  ReminderQueue,
  ReminderScheduler,
} from "./reminders.js";
import { SCREENS_INDEX_FILENAME, ScreenSet, writeScreenFile } from "./screens.js";
import { type PackSender, packSender, packSenderForPack } from "./senders.js";
import {
  type CatalogueEntry,
  CHROME_HOST,
  CHROME_IPC,
  CHROME_ORIGIN,
  CHROME_SCHEME,
  type DocumentSummary,
  type FileReadOptions,
  type FileRemoveOptions,
  type FileWriteOptions,
  type FirstRunInstallResult,
  type InstalledVersionView,
  PACK_EVENT,
  PACK_IPC,
  PACK_SCHEME,
  type PackConsentView,
  type PackInfoView,
  type PackLaunchContext,
  type RelayLifecycle,
  type RelayView,
  type ThemeView,
} from "./shared.js";
import { SpaceStore } from "./spaces.js";
import {
  DEFAULT_THEME_CHOICE,
  type HostThemeChoice,
  isHostThemeChoice,
  loadThemeChoice,
  presetFor,
  resolveThemeView,
  saveThemeChoice,
  themeOptions,
} from "./theme.js";
import { ShellWindow } from "./window.js";

/**
 * Suite.
 *
 * The host is deliberately small: it owns windows, tabs, the space document,
 * pack installation and the capability broker. It never imports a pack, parses an
 * app document or reads a sync key. Everything a pack may do crosses one of the
 * handlers below, and every handler scopes the request to the sender.
 */
app.setName("Suite Desk");

/**
 * The product name in the About panel is Suite Desk, and `setName` also decides
 * the data directory. The Desk rename is a fresh start: the old `Suite`/`shell`
 * root is not read or migrated.
 */
app.setAboutPanelOptions({ applicationName: "Suite Desk" });

const userDataOverride = process.env.SUITE_DESK_USER_DATA?.trim();
if (userDataOverride !== undefined && userDataOverride.length > 0) {
  app.setPath("userData", userDataOverride);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: CHROME_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  {
    scheme: PACK_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let window: ShellWindow | null = null;
let spaceStore: SpaceStore | null = null;
let screenStore: ScreenSet | null = null;
/**
 * The Command Surface (#225). Discovery reads the loaded packs; the broker owns
 * consent and the scoped channel. Recency and display-row cache are in-memory
 * host session state, never telemetry and never written to a profile.
 */
let commandBroker: CommandBroker | null = null;
let commandRecency: CommandRecency | null = null;
/**
 * The host's theme choice. Loaded from the profile before the first window and written back
 * whenever the View menu changes it, so every pack opened later starts in the same theme.
 */
let themeChoice: HostThemeChoice = DEFAULT_THEME_CHOICE;
/** The first-run wizard replaces the chrome until this data root records completion. */
let firstRun = true;
/**
 * One document store per publisher. The first-party publisher keeps the
 * `documents/<container>/<pack>` layout; any other publisher has its own root,
 * so the same pack id cannot read the previous owner's documents (S2.2).
 */
const documentStores = new Map<string, DocumentStore>();
let files: PackFilesService | null = null;
let externalFiles: ExternalFilesService | null = null;
/**
 * The host's device key (S2.6). It is the derivation root for `identity.pack`
 * and never crosses the bridge. A malformed file leaves it null and identity
 * calls refuse; the host does not mint a new key over one it could not read.
 */
let deviceKey: DeviceKey | null = null;
let trustStore: PublisherTrustStore | null = null;
/** The one consent record (S4.2, S4.3), beside the publisher trust store. */
let consentRecord: ConsentRecord | null = null;
/** Advisories that refuse a new install. They never disable an installed pack. */
let revocations: readonly RevocationAdvisory[] = [];
let packs: readonly PackInfo[] = [];
let catalogue: readonly CataloguePack[] = [];
/** The sentence the catalogue shows about where its entries came from. */
let catalogueSource = "The local catalogue directory is in use.";
let installedVersions: readonly InstalledVersion[] = [];
let pendingDeepLink: string | null = null;
/** The host-owned reminder queue. A pack's rows outlive the pack being closed. */
let reminderQueue: ReminderQueue | null = null;
let reminderScheduler: ReminderScheduler | null = null;
/** The host's recent list and the seen fingerprints its document watch compares. */
let recentsStore: RecentsStore | null = null;
let libraryWatch: LibraryWatch | null = null;
/** The supervised relay worker and the pack-facing broker over its socket. */
let relaySupervisor: RelaySupervisor | null = null;
let relayBroker: RelayBroker | null = null;
/** The quit hook prevents the first `before-quit`, stops the relay, then quits again. */
let shuttingDown = false;

/** The compressed archive cap this host opens from the picker. The reader enforces its own entry limits too. */
const MAX_INSTALL_BYTES = MAX_ARCHIVE_BYTES;
/** A rotation statement or a revocation advisory is a small JSON file. */
const MAX_ADVISORY_BYTES = 64 * 1024;
/** One host-mediated pack signature. Keep in sync with the preload's guard. */
const MAX_IDENTITY_BYTES = 16 * 1024 * 1024;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  registerSuiteProtocol();

  // A second launch is how Linux and Windows deliver a `suite://` link. The lock
  // keeps one host; this event focuses it and routes the argument it arrived with.
  app.on("second-instance", (_event, argv) => {
    window?.focus();
    const link = suiteLinkFromArgv(argv);
    if (link !== null) handleDeepLink(link);
  });

  // macOS delivers a link as an event rather than an argument. It can arrive
  // before the window exists, so the handler stores it and bootstrap drains it.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error("Suite failed to start", error);
      app.quit();
    });

  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (window === null) {
      openWindow();
      const link = pendingDeepLink;
      pendingDeepLink = null;
      if (link !== null) handleDeepLink(link);
    } else {
      window.focus();
    }
  });
  app.on("before-quit", (event) => {
    // The relay runs in this process as a worker thread, so stop accepting sync
    // work and let it close its store before this process exits. The first quit
    // is held, the second one (after the await below) is the real one.
    if (shuttingDown) return;
    shuttingDown = true;
    event.preventDefault();
    reminderScheduler?.stop();
    relayBroker?.closeAll();
    void (async () => {
      await relaySupervisor?.stop().catch((error: unknown) => {
        console.warn("[desk] the relay worker could not be stopped", error);
      });
      await spaceStore?.flush().catch((error: unknown) => {
        console.warn("[desk] space document flush failed", error);
      });
      await screenStore?.flush().catch((error: unknown) => {
        console.warn("[desk] screen document flush failed", error);
      });
      app.quit();
    })();
  });
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId("run.suite.desk");

  const dataRoot = dataRootFor();
  await mkdir(dataRoot, { recursive: true });
  // The theme is profile state, like the device key: one answer for every pack this host
  // opens, including a pack installed after the choice was made.
  themeChoice = await loadThemeChoice(dataRoot);
  firstRun = await isFirstRun(dataRoot);
  nativeTheme.themeSource = themeChoice.mode;
  installApplicationMenu();
  // The device key is host data, not pack data. A missing file is a first run
  // and gets a fresh key; a malformed one is reported and leaves identity
  // calls refused rather than silently changing every pack's identity.
  deviceKey = await openDeviceKey(join(dataRoot, "identity")).catch((error: unknown) => {
    console.warn("[desk] the device key could not be opened", error);
    return null;
  });
  // The trust store is read before any pack: a pack is verified against it, so a
  // failure here must fall back to the preinstalled key, never to "trust all".
  trustStore = await openPublisherTrust(trustRootFor(dataRoot, process.env)).catch(
    (error: unknown) => {
      console.warn("[desk] the publisher trust store could not be opened", error);
      return preinstalledTrustStore();
    },
  );
  // One consent record for every capability, beside the publisher trust store
  // (S4.3). A malformed file starts empty, so each capability is asked again.
  consentRecord = await ConsentRecord.open(
    join(trustRootFor(dataRoot, process.env), "consent.json"),
  );
  // A malformed advisory file is reported and treated as empty; it is host
  // state, not a trust root, so it does not fail the launch.
  revocations = await openRevocations(trustRootFor(dataRoot, process.env))
    .then((store) => store.revocations)
    .catch((error: unknown) => {
      console.warn("[desk] the revocation advisories could not be opened", error);
      return [];
    });
  // The reminder queue is host state under the profile, not pack data. Opening it
  // before the pack scan lets a removed pack's rows be pruned in the same pass.
  reminderQueue = await ReminderQueue.open(join(dataRoot, "reminders.json"));
  // The recent list and the seen fingerprints are host state too. Both are
  // opened before the pack scan so a pack that is gone leaves no live watch.
  recentsStore = await RecentsStore.open(join(dataRoot, "recents.json"));
  libraryWatch = await LibraryWatch.open(join(dataRoot, "library.json"));
  // The catalogue is a drop directory. Creating it is a convenience; an absent
  // or overridden path still scans as an empty catalogue.
  await mkdir(catalogueRootFor(dataRoot, process.env), { recursive: true }).catch(
    (error: unknown) => {
      console.warn("[desk] could not create the catalogue directory", error);
    },
  );

  await refreshCatalogue();
  await refreshPacks();
  await migrateLegacyConsentRecords();
  spaceStore = await SpaceStore.open(join(dataRoot, "spaces.loro"));
  // The host's own Screens. Home is a role, so launch does not force a Home tab: a restored
  // session keeps the tabs it saved, and a fresh data root shows the first-run wizard instead.
  // Opening Home is the Suite mark, the picker, or the wizard's last step.
  screenStore = await ScreenSet.open({
    directory: join(dataRoot, "screens"),
    indexFile: join(dataRoot, SCREENS_INDEX_FILENAME),
  });
  await migrateHome(screenStore);
  // One store per (container, pack) under the publisher's root. This is host
  // data, deliberately separate from the pack's code root.
  const fileService = new PackFilesService(join(dataRoot, "files"));
  files = fileService;
  // The dialogs are host chrome; the absolute path a person picks stays here.
  // `external.ts` turns it into an opaque, tab-scoped token for the pack.
  externalFiles = new ExternalFilesService(externalDialog(), fileService);

  // The relay is a supervised worker, not a module in this process and not a
  // second copy of the Electron binary. It gets its own store and nothing else:
  // no document root, no pack root, no device key.
  relaySupervisor = new RelaySupervisor({
    worker: relayWorkerUrl(),
    store: join(dataRoot, "relay"),
    baseEnv: process.env,
    logger: (line) => console.info(`[desk] ${line}`),
    onStatus: (status) => window?.setRelayStatus(relayView(status)),
  });
  // The pack-facing side opens the socket and forwards bytes. It refuses any
  // address or pin other than the relay this host supervises.
  relayBroker = new RelayBroker({
    runtime: () => ({
      ready: relaySupervisor?.ready ?? false,
      address: relaySupervisor?.status.address ?? null,
      fingerprint: relaySupervisor?.status.fingerprint ?? null,
    }),
    openSocket: openPinnedRelaySocket,
    sink: {
      frame: (webContentsId, token, frame) => {
        const contents = webContents.fromId(webContentsId);
        if (contents !== undefined && !contents.isDestroyed()) {
          contents.send(PACK_EVENT.relayFrame, token, frame);
        }
      },
      close: (webContentsId, token, reason) => {
        const contents = webContents.fromId(webContentsId);
        if (contents !== undefined && !contents.isDestroyed()) {
          contents.send(PACK_EVENT.relayClosed, token, reason);
        }
      },
    },
  });

  serveProtocols();
  registerIpc();
  nativeTheme.on("updated", () => {
    // Only "follow the system" changes without a menu click. An explicit choice paints the
    // same answer no matter what the desktop does.
    if (themeChoice.mode !== "system") return;
    window?.setTheme(themeView());
  });
  openWindow();
  startReminderScheduler();

  const startupLink = pendingDeepLink ?? suiteLinkFromArgv(process.argv);
  pendingDeepLink = null;
  if (startupLink !== null) handleDeepLink(startupLink);
}

function dataRootFor(): string {
  const override = process.env.SUITE_DESK_DATA?.trim();
  if (override !== undefined && override.length > 0) return override;
  return join(app.getPath("userData"), "desk");
}

/**
 * The relay's worker entry, compiled beside this module.
 *
 * A checkout and a packaged build resolve the same file: `tsc` writes
 * `dist/relayWorker.js`, electron-builder puts `dist/` in the asar, and the
 * thread's imports of `@suite/sync-server` come from the app's own
 * `node_modules`. `SUITE_DESK_RELAY_WORKER` names a different file for a test.
 *
 * It must not be the host's executable. Under Flatpak that binary is
 * zypak-wrapped, and a child started with `ELECTRON_RUN_AS_NODE=1` aborts in
 * zypak when the whitelisted environment has no session bus; the packaged host
 * also fuses `runAsNode` off. A worker thread is Node code in this process.
 */
function relayWorkerUrl(): URL {
  const override = process.env.SUITE_DESK_RELAY_WORKER?.trim();
  if (override !== undefined && override.length > 0) return pathToFileURL(override);
  return new URL("./relayWorker.js", import.meta.url);
}

function relayLifecycle(state: RelaySupervisorStatus["state"]): RelayLifecycle {
  if (state === "stopped") return "off";
  if (state === "ready") return "on";
  return state;
}

/** The relay state the chrome draws. No frame, no document and no pack data. */
function relayView(status: RelaySupervisorStatus): RelayView {
  return {
    state: relayLifecycle(status.state),
    on: status.state === "ready",
    address: status.address,
    fingerprint: status.fingerprint,
    code: status.code,
    consoleUrl: status.consoleUrl,
    restartCount: status.restartCount,
    lastError: status.lastError,
  };
}

function currentRelayView(): RelayView {
  if (relaySupervisor !== null) return relayView(relaySupervisor.status);
  return {
    state: "off",
    on: false,
    address: null,
    fingerprint: null,
    code: null,
    consoleUrl: null,
    restartCount: 0,
    lastError: null,
  };
}

function relayScopeFor(sender: PackSender): RelayBrokerScope {
  return {
    webContentsId: sender.webContentsId,
    tabId: sender.tabId,
    packId: sender.packId,
    allowed: packAllows(sender.pack, "relay"),
  };
}

/**
 * Claim `suite://` for this host.
 *
 * A packaged app registers itself. A checkout runs through the Electron binary,
 * so the executable and the app path are passed explicitly; without them the
 * handler would start Electron with no app to run.
 */
function registerSuiteProtocol(): void {
  if (process.defaultApp) {
    const appPath = process.argv[1];
    if (appPath !== undefined) {
      app.setAsDefaultProtocolClient("suite", process.execPath, [appPath]);
    }
    return;
  }
  app.setAsDefaultProtocolClient("suite");
}

/** Route one link, or hold it until the window exists. */
function handleDeepLink(url: string): void {
  if (window === null) {
    pendingDeepLink = url;
    return;
  }
  void window.openDeepLink(url).catch((error: unknown) => {
    console.warn("[desk] could not open a Suite link", error);
    window?.setNotice("That Suite link could not be opened.");
  });
}

function packTrustOptions(): PackTrustOptions {
  return {
    publishers: trustStore?.publishers ?? [],
    hostContractVersion: HOST_CONTRACT_VERSION,
    hostVersion: HOST_VERSION,
    hostCapabilities: HOST_CAPABILITIES,
    rings: hostRingsFor(process.env.SUITE_DESK_RINGS),
    revocations,
  };
}

/** Re-read the advisories after one is imported, without trusting a bad file. */
async function reloadRevocations(): Promise<void> {
  try {
    revocations = (await openRevocations(trustRootFor(dataRootFor()))).revocations;
  } catch (error) {
    console.warn("[desk] the revocation advisories could not be read", error);
  }
}

/**
 * A sender's derived pack key, or a rejection.
 *
 * The capability is checked at the call, the same way `filesFor` answers: a pack
 * that did not declare `identity.pack` gets a refused call, not an empty key.
 * The tuple is `(publisher id, pack id)`; both come from the host's mapping, so
 * a renderer cannot name either.
 */
function identityFor(sender: PackSender) {
  if (!packAllows(sender.pack, "identity.pack")) {
    throw new Error("the identity.pack capability is not enabled for this pack");
  }
  if (deviceKey === null) throw new Error("the host device key is not ready");
  const publisherId = sender.pack.publisher?.id ?? SUITE_PUBLISHER_ID;
  return derivePackKey(deviceKey, publisherId, sender.packId);
}

/** The document store for a sender's publisher, created on first use. */
function documentsForPublisher(publisherId: string): DocumentStore {
  let store = documentStores.get(publisherId);
  if (store === undefined) {
    const root = documentsRootFor(dataRootFor(), publisherId);
    store = new DocumentStore(root, publisherId, documentScopeLabel(publisherId));
    documentStores.set(publisherId, store);
  }
  return store;
}

function documentsFor(sender: PackSender): DocumentStore {
  return documentsForPublisher(sender.pack.publisher?.id ?? SUITE_PUBLISHER_ID);
}

function recentsService(): RecentsStore {
  if (recentsStore === null) throw new Error("the recent list is not ready");
  return recentsStore;
}

function consentService(): ConsentRecord {
  if (consentRecord === null) throw new Error("the consent record is not ready");
  return consentRecord;
}

/**
 * Move the two hand-rolled answers into the one record, once.
 *
 * The old recents answer carries a publisher and pack; it is attached to the
 * version installed today and marked `recents-v1`. The old notification answer
 * was host-wide and names no pack, so it is not copied: notifications are asked
 * per pack at the token tier, and this log says why a person sees that question
 * again. Both legacy files are rewritten only after the record has been written.
 */
async function migrateLegacyConsentRecords(): Promise<void> {
  const record = consentRecord;
  const recents = recentsStore;
  const reminders = reminderQueue;
  if (record === null || recents === null || reminders === null) return;

  const installed: ConsentPackVersion[] = packs.map((pack) => ({
    publisherId: pack.publisher?.id ?? SUITE_PUBLISHER_ID,
    packId: pack.id,
    version: pack.version,
  }));

  try {
    const result = await record.migrateLegacy({
      recents: recents.legacyPermissions(),
      notifications: reminders.legacyPermission(),
      installed,
    });
    await recents.discardLegacyPermissions();
    await reminders.discardLegacyPermission();
    if (result.notifications === "reasked") {
      console.info(
        "[desk] the old notification permission named no pack; each pack is asked at its next reminder",
      );
    }
  } catch (error) {
    console.warn("[desk] the legacy consent answers could not be migrated", error);
  }
}

function consentRequestFor(pack: PackInfo, capability: PackCapability): ConsentRequest {
  return {
    publisherId: pack.publisher?.id ?? SUITE_PUBLISHER_ID,
    packId: pack.id,
    version: pack.version,
    capability,
    reason: CAPABILITY_REASONS[capability] ?? capability,
  };
}

/** Only this pack's answers, for its card. No other pack's entry is read here. */
function consentViewsFor(pack: PackInfo): readonly PackConsentView[] {
  if (consentRecord === null) return [];
  return consentRecord.viewsFor({
    publisherId: pack.publisher?.id ?? SUITE_PUBLISHER_ID,
    packId: pack.id,
    version: pack.version,
  });
}

/** The pack list the chrome paints, with each pack's own answers attached. */
function packViews(): readonly PackInfo[] {
  return packs.map((pack) => ({ ...pack, consent: consentViewsFor(pack) }));
}

/**
 * The one consent surface (S4.2).
 *
 * Every capability asks here, in the moment, at the tier the spec names for it.
 * The dialog names the pack, the capability, the tier and the pack's stated
 * reason; `ConsentRecord` remembers the answer and stops a remembered denial
 * from opening this dialog again.
 */
async function askConsent(pack: PackInfo, capability: PackCapability): Promise<boolean> {
  if (window === null) return false;
  const tier = consentTierFor(capability);
  const reason = CAPABILITY_REASONS[capability] ?? capability;
  const answer = await dialog.showMessageBox(window.window, {
    type: "question",
    title: CAPABILITY_TITLES[capability] ?? `Allow ${capability}?`,
    message: `${pack.name} wants to ${reason}.`,
    detail: consentDetail(tier),
    buttons: ["Don't allow", "Allow"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return answer.response === 1;
}

function consentDetail(tier: ReturnType<typeof consentTierFor>): string {
  if (tier === "install") return "This was shown when the app was installed.";
  if (tier === "every-use") return "Suite Desk asks every time this is used.";
  if (tier === "token") {
    return "Suite Desk asks once; this grant expires after thirty days and is asked again then.";
  }
  return "Suite Desk asks once for this version and remembers your answer, including a refusal.";
}

async function ensurePackConsent(pack: PackInfo, capability: PackCapability): Promise<boolean> {
  const request = consentRequestFor(pack, capability);
  return consentService().ensure(request, () => askConsent(pack, capability));
}

function libraryService(): LibraryWatch {
  if (libraryWatch === null) throw new Error("the document library is not ready");
  return libraryWatch;
}

function recentsScopeFor(sender: PackSender): RecentsScope {
  return {
    containerId: sender.containerId,
    publisherId: sender.pack.publisher?.id ?? SUITE_PUBLISHER_ID,
    packId: sender.packId,
  };
}

function libraryScopeFor(sender: PackSender): LibraryScope {
  return recentsScopeFor(sender);
}

/**
 * Record a document the pack opened.
 *
 * The recent row is host state and the seen fingerprint keeps the watch honest,
 * so neither is allowed to fail the open itself: a person losing a list is not a
 * reason to lose the document.
 */
async function rememberOpened(
  sender: PackSender,
  document: Pick<DocumentSummary, "id" | "size" | "updatedAt">,
): Promise<void> {
  try {
    await libraryService().markSeen(documentsFor(sender), libraryScopeFor(sender), [document]);
    await recentsService().record(recentsScopeFor(sender), document.id, Date.now());
  } catch (error) {
    console.warn("[desk] the recent list could not be updated", error);
  }
}

/** A save by the pack is not an external change, so it is marked seen. */
async function markSeen(
  sender: PackSender,
  document: Pick<DocumentSummary, "id" | "size" | "updatedAt">,
): Promise<void> {
  try {
    await libraryService().markSeen(documentsFor(sender), libraryScopeFor(sender), [document]);
  } catch (error) {
    console.warn("[desk] the document watch could not be updated", error);
  }
}

async function forgetDocument(sender: PackSender, id: string): Promise<void> {
  await Promise.all([
    libraryService()
      .forget(libraryScopeFor(sender), id)
      .catch((error: unknown) => {
        console.warn("[desk] the document watch could not forget a document", error);
      }),
    recentsService()
      .forget(recentsScopeFor(sender), id)
      .catch((error: unknown) => {
        console.warn("[desk] the recent list could not forget a document", error);
      }),
  ]);
}

/**
 * Rebuild the catalogue from the published index, or from the local directory
 * when the index is unavailable.
 *
 * The local directory is a first-class source (S12.1): a person may install a
 * file with no catalogue and no network. The chrome says which source is in use
 * instead of falling back silently, and a refused index still leaves the local
 * directory usable.
 */
async function refreshCatalogue(): Promise<void> {
  const root = catalogueRootFor(dataRootFor(), process.env);
  const url = catalogueIndexUrlFor(process.env);
  if (url === null) {
    catalogue = await loadCatalogue(root, packTrustOptions(), null);
    catalogueSource = "The local catalogue directory is in use; no catalogue index is configured.";
    return;
  }

  const loaded = await loadCatalogueIndex({
    url,
    headRoot: trustRootFor(dataRootFor(), process.env),
    fetch: (input, init) => net.fetch(input, init),
  });
  if (loaded.ok) {
    catalogue = await loadCatalogue(root, packTrustOptions(), loaded.index);
    catalogueSource = `The published catalogue index is in use (sequence ${loaded.sequence}).`;
    console.info(
      `[desk] catalogue index sequence ${loaded.sequence} verified; ${loaded.index.packs.length} entry(ies)`,
    );
    return;
  }

  catalogue = await loadCatalogue(root, packTrustOptions(), null);
  catalogueSource =
    loaded.reason === "refused"
      ? `The local catalogue directory is in use; the published index was refused. ${loaded.message}`
      : `The local catalogue directory is in use. ${loaded.message}`;
  console.warn(`[desk] ${loaded.message}`);
}

/**
 * Rebuild the host's pack list.
 *
 * Verified installs under the data root are the load path. An unsigned directory
 * beside the checkout is added only when the dev switch opened; its issues are
 * logged, not shown, because a development directory is not a user install.
 */
async function refreshPacks(): Promise<void> {
  const scan = await loadInstalledPacks(join(dataRootFor(), "packs"), packTrustOptions());
  for (const issue of scan.issues) {
    const label = [issue.id ?? "unknown", issue.version ?? ""].join(" ").trim();
    console.warn(`[desk] refused pack ${label}: ${issue.message}`);
  }

  const development = devPacksEnabled({ isPackaged: app.isPackaged, env: process.env })
    ? discoverPacks(packsRootFor(app.getAppPath()), {
        rings: hostRingsFor(process.env.SUITE_DESK_RINGS),
      })
    : [];

  packs = mergePackSources({ installed: scan.packs, development });
  installedVersions = scan.versions;
  await pruneReminders();
  console.info(
    `[desk] ${packs.length} pack(s) available; ${catalogue.length} catalogue archive(s)`,
  );
}

/** What the chrome sees: no archive paths and no refusal codes. */
function catalogueView(): readonly CatalogueEntry[] {
  const active = new Map(packs.map((pack) => [pack.id, pack.version]));
  return catalogue.map((pack) => catalogueEntry(pack, active.get(pack.id) ?? null));
}

/** Every valid version with the loader's current choice marked. */
function installedVersionViews(): readonly InstalledVersionView[] {
  const current = new Map(packs.map((pack) => [pack.id, pack.version]));
  return installedVersions.map((entry) => ({
    id: entry.id,
    version: entry.version,
    current: current.get(entry.id) === entry.version,
  }));
}

/** Replace the window's pack data from the module's last scan. */
function publishPackData(): void {
  window?.setPackData(packViews(), catalogueView(), installedVersionViews(), catalogueSource);
}

function themeView(): ThemeView {
  return resolveThemeView(themeChoice, nativeTheme.shouldUseDarkColors);
}

/**
 * The View menu: the one place a person looks for how the host draws.
 *
 * Brightness is `nativeTheme.themeSource`, so choosing Light, Dark or Follow the system also
 * tells every renderer what `prefers-color-scheme` answers — the same signal a pack's own CSS
 * already understands. The theme list is the package's list, first entry first, so the menu
 * cannot drift from `PRESETS`.
 */
function installApplicationMenu(): void {
  const modeItem = (mode: HostThemeChoice["mode"], label: string): MenuItemConstructorOptions => ({
    label,
    type: "radio",
    checked: themeChoice.mode === mode,
    click: () => void chooseTheme({ mode }),
  });
  const presetItems: MenuItemConstructorOptions[] = themeOptions().map((theme) => ({
    label: theme.name,
    type: "radio",
    checked: themeChoice.preset === theme.id,
    click: () => void chooseTheme({ preset: theme.id }),
  }));
  const densityLabels: Record<HostThemeChoice["density"], string> = {
    compact: "Compact",
    cozy: "Cozy",
    comfortable: "Comfortable",
  };
  const densityItems: MenuItemConstructorOptions[] = DENSITIES.map((density) => ({
    label: densityLabels[density],
    type: "radio",
    checked: themeChoice.density === density,
    click: () => void chooseTheme({ density }),
  }));

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        modeItem("light", "Light"),
        modeItem("dark", "Dark"),
        modeItem("system", "Follow the system"),
        { type: "separator" },
        { label: "Theme", submenu: presetItems },
        { label: "Density", submenu: densityItems },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Apply one menu choice: repaint every open view now and remember it for the next launch. */
async function chooseTheme(next: Partial<HostThemeChoice>): Promise<void> {
  const choice: HostThemeChoice = {
    preset: presetFor(next.preset ?? themeChoice.preset),
    mode: next.mode ?? themeChoice.mode,
    density: next.density ?? themeChoice.density,
  };
  if (
    choice.preset === themeChoice.preset &&
    choice.mode === themeChoice.mode &&
    choice.density === themeChoice.density
  ) {
    return;
  }
  themeChoice = choice;
  nativeTheme.themeSource = choice.mode;
  installApplicationMenu();
  window?.setTheme(themeView());
  try {
    await saveThemeChoice(dataRootFor(), choice);
  } catch (error) {
    console.warn("[desk] the theme choice could not be saved", error);
  }
}

function openWindow(): void {
  if (spaceStore === null || screenStore === null) {
    throw new Error("the host is not ready");
  }
  let created: ShellWindow | null = null;
  created = new ShellWindow({
    packs: packViews(),
    catalogue: catalogueView(),
    catalogueSource,
    installedVersions: installedVersionViews(),
    spaces: spaceStore,
    screens: screenStore,
    theme: themeView(),
    firstRun,
    relay: currentRelayView(),
    listDocuments: async (packId) => {
      const pack = packViews().find((candidate) => candidate.id === packId);
      if (pack === undefined) return [];
      const store = documentsForPublisher(pack.publisher?.id ?? SUITE_PUBLISHER_ID);
      return (await store.list(DEFAULT_CONTAINER_ID, packId)).map((document) => ({
        id: document.id,
        name: document.name,
      }));
    },
    recentRows: () =>
      recentsService()
        .rows()
        .filter((row) => row.containerId === DEFAULT_CONTAINER_ID)
        .map((row) => ({
          packId: row.packId,
          documentId: row.documentId,
          openedAt: row.openedAt,
        })),
    onViewClosed: (tabId) => {
      files?.releaseOwner(tabId);
      externalFiles?.releaseOwner(tabId);
      libraryWatch?.unsubscribe(tabId);
      relayBroker?.releaseOwner(tabId);
    },
    onClosed: () => {
      if (window === created) window = null;
    },
  });
  window = created;
}

function serveProtocols(): void {
  protocol.handle(CHROME_SCHEME, async (request) => {
    const resolved = resolveProtocolAsset(request.url, join(app.getAppPath(), "dist", "renderer"), {
      scheme: CHROME_SCHEME,
      hosts: [CHROME_HOST],
    });
    if (!resolved.ok) return new Response("not found", { status: 404 });

    const response = await net.fetch(pathToFileURL(resolved.file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", desktopCsp({ wasm: false }));
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  });
}

/**
 * The host's own commands. They are listed beside installed packs' commands and
 * run in the main process; no pack is called.
 */
function hostCommands(): readonly HostCommand[] {
  return [
    {
      id: "desk.open-home",
      title: "Open Home",
      subtitle: "Suite Desk",
      keywords: ["home", "launcher", "screens"],
      run: async () => {
        if (window === null) return { ok: false, message: "Suite Desk is not ready." };
        await window.openHome();
        return { ok: true, message: "Opened Home." };
      },
    },
    {
      id: "desk.new-tab",
      title: "New tab",
      subtitle: "Suite Desk",
      keywords: ["new", "tab", "document", "pack"],
      run: async () => {
        if (window === null) return { ok: false, message: "Suite Desk is not ready." };
        await window.newTab();
        return { ok: true, message: "Opened the new-tab picker." };
      },
    },
    {
      id: "desk.install-pack",
      title: "Install a pack",
      subtitle: "Suite Desk",
      keywords: ["install", "add", "pack", "suitepack"],
      run: async () => {
        await installPackFromFile();
        return { ok: true, message: "The install dialog closed." };
      },
    },
  ];
}

/**
 * The Command Surface broker, created once the host can answer.
 *
 * Consent is the same `ensurePackConsent` every other capability uses, so a
 * denial is remembered on the pack card and the surface refuses with a sentence.
 * The channel is the separate command IPC, never the document or file bridge.
 */
function commandService(): CommandBroker {
  if (commandBroker === null) {
    commandRecency ??= new CommandRecency();
    const recency = commandRecency;
    commandBroker = new CommandBroker({
      packs: () => packs,
      hostCommands: hostCommands(),
      findSender: (packId) => packSenderForPack(packId),
      ensureConsent: async (pack) => {
        if (!packAllows(pack, "commands")) return false;
        const allowed = await ensurePackConsent(pack, "commands");
        publishPackData();
        return allowed;
      },
      channel: {
        invoke: async (sender, entry, request) => {
          const live = packSenderForPack(sender.packId);
          if (live === null || live.webContentsId !== sender.webContentsId) {
            throw new Error(`${sender.packId} closed before the command could run`);
          }
          return invokeProvider(live, entry, request);
        },
      },
      recency,
      cache: new ScopeRowsCache(),
    });
  }
  return commandBroker;
}

/** Route a `suite://` link a provider answered with. The broker already validated it. */
async function openCommandLink(link: string | undefined): Promise<void> {
  if (link === undefined || window === null) return;
  await window.openDeepLink(link);
}

function registerIpc(): void {
  registerProjectionChannels();
  registerCommandChannels();
  onChrome(CHROME_IPC.state, () => window?.state());
  onChrome(CHROME_IPC.openPack, async (packId) => {
    if (typeof packId !== "string") return;
    await window?.openPack(packId);
  });
  onChrome(CHROME_IPC.activateTab, async (tabId) => {
    if (tabId !== null && typeof tabId !== "string") return;
    await window?.activateTab(tabId);
  });
  onChrome(CHROME_IPC.closeTab, async (tabId) => {
    if (typeof tabId !== "string") return;
    await window?.closeTab(tabId);
  });
  onChrome(CHROME_IPC.newTab, async () => {
    await window?.newTab();
  });
  onChrome(CHROME_IPC.home, async () => {
    await window?.openHome();
  });
  onChrome(CHROME_IPC.picker, async () => window?.picker());
  onChrome(CHROME_IPC.openDocument, async (packId, documentId) => {
    if (typeof packId !== "string" || typeof documentId !== "string") return;
    await window?.openDocument(packId, documentId);
  });
  onChrome(CHROME_IPC.newDocument, async (packId) => {
    if (typeof packId !== "string") return;
    await window?.newDocument(packId);
  });
  onChrome(CHROME_IPC.reloadTab, (tabId) => {
    if (typeof tabId !== "string") return;
    window?.reloadTab(tabId);
  });
  onChrome(CHROME_IPC.openExternal, (url) => {
    if (typeof url === "string") window?.openExternal(url);
  });
  onChrome(CHROME_IPC.installPack, async () => {
    await installPackFromFile();
  });
  onChrome(CHROME_IPC.installCataloguePack, async (id, version) => {
    if (typeof id !== "string" || typeof version !== "string") return;
    await installPackFromCatalogue(id, version);
  });
  onChrome(CHROME_IPC.setTheme, async (choice) => {
    if (!isHostThemeChoice(choice)) return;
    await chooseTheme(choice);
  });
  onChrome(CHROME_IPC.installFirstRunPack, async (id) => {
    if (typeof id !== "string") return { ok: false, detail: "No app was named." };
    return installFirstRunPack(id);
  });
  onChrome(CHROME_IPC.completeFirstRun, async () => {
    await completeFirstRun();
  });
  onChrome(CHROME_IPC.reaskConsent, async (id, capability) => {
    if (typeof id !== "string" || !isPackCapability(capability)) return;
    const pack = packs.find((candidate) => candidate.id === id);
    if (pack === undefined) return;
    // The person cleared the answer by choosing this on the card, so the next
    // `ensure` asks. A pack has no path to this call.
    await consentService().forget(consentRequestFor(pack, capability));
    await ensurePackConsent(pack, capability);
    publishPackData();
    await reminderScheduler?.refresh();
    return window?.state();
  });
  onChrome(CHROME_IPC.importRevocation, async () => {
    await importRevocationFromFile();
  });
  onChrome(CHROME_IPC.rotatePublisher, async () => {
    await rotatePublisherFromFile();
  });
  onChrome(CHROME_IPC.uninstallPack, async (id, version) => {
    if (typeof id !== "string" || typeof version !== "string") return;
    await uninstallPackVersionFrom(id, version);
  });
  onChrome(CHROME_IPC.addWidget, async (registryId) => {
    if (typeof registryId !== "string") return undefined;
    await window?.addScreenWidget(registryId);
    return window?.state();
  });
  onChrome(CHROME_IPC.removeWidget, async (registryId) => {
    if (typeof registryId !== "string") return undefined;
    await window?.removeScreenWidget(registryId);
    return window?.state();
  });
  onChrome(CHROME_IPC.moveWidget, async (registryId, direction) => {
    if (typeof registryId !== "string" || typeof direction !== "string") return undefined;
    await window?.moveScreenWidget(registryId, direction);
    return window?.state();
  });
  onChrome(CHROME_IPC.resizeWidget, async (registryId, size) => {
    if (typeof registryId !== "string" || typeof size !== "string") return undefined;
    await window?.resizeScreenWidget(registryId, size);
    return window?.state();
  });
  onChrome(CHROME_IPC.createScreen, async (name) => {
    if (typeof name !== "string") return undefined;
    await window?.createScreen(name);
    return window?.state();
  });
  onChrome(CHROME_IPC.renameScreen, async (screenId, name) => {
    if (typeof screenId !== "string" || typeof name !== "string") return undefined;
    await window?.renameScreen(screenId, name);
    return window?.state();
  });
  onChrome(CHROME_IPC.duplicateScreen, async (screenId) => {
    if (typeof screenId !== "string") return undefined;
    await window?.duplicateScreen(screenId);
    return window?.state();
  });
  onChrome(CHROME_IPC.deleteScreen, async (screenId, replacementId) => {
    if (typeof screenId !== "string") return undefined;
    if (replacementId !== null && typeof replacementId !== "string") return undefined;
    await window?.deleteScreen(screenId, replacementId);
    return window?.state();
  });
  onChrome(CHROME_IPC.setHomeScreen, async (screenId) => {
    if (typeof screenId !== "string") return undefined;
    await window?.setHomeScreen(screenId);
    return window?.state();
  });
  onChrome(CHROME_IPC.openScreen, async (screenId) => {
    if (typeof screenId !== "string") return;
    await window?.openScreen(screenId);
  });
  onChrome(CHROME_IPC.exportScreen, async (screenId) => {
    if (typeof screenId !== "string") return undefined;
    await exportScreenToFile(screenId);
    return window?.state();
  });
  onChrome(CHROME_IPC.importScreen, async () => {
    await importScreenFromFile();
    return window?.state();
  });
  onChrome(CHROME_IPC.relayStart, () => {
    if (relaySupervisor === null) return undefined;
    relaySupervisor.start();
    return relayView(relaySupervisor.status);
  });
  onChrome(CHROME_IPC.relayStop, async () => {
    if (relaySupervisor === null) return undefined;
    return relayView(await relaySupervisor.stop());
  });

  onChrome(CHROME_IPC.commandList, (query) => {
    if (typeof query !== "string") return undefined;
    return commandService().listing(query);
  });
  onChrome(CHROME_IPC.commandInvoke, async (commandId, scope, args) => {
    if (typeof commandId !== "string") return undefined;
    if (typeof scope !== "string") return undefined;
    const outcome = await commandService().invoke(commandId, scope, args);
    await openCommandLink(outcome.open);
    return outcome;
  });
  onChrome(CHROME_IPC.commandScopes, (packId) => {
    if (typeof packId !== "string") return undefined;
    return commandService().scopes(packId);
  });
  onChrome(CHROME_IPC.commandItems, (packId, scopeId, limit) => {
    if (typeof packId !== "string" || typeof scopeId !== "string") return undefined;
    const bounded = typeof limit === "number" ? Math.min(50, Math.max(1, limit)) : 20;
    return commandService().items(packId, scopeId, bounded);
  });
  onChrome(CHROME_IPC.commandCapture, async (packId, scopeId, values) => {
    if (typeof packId !== "string" || typeof scopeId !== "string") return undefined;
    const outcome = await commandService().capture(packId, scopeId, values);
    await openCommandLink(outcome.open);
    return outcome;
  });
  onChrome(CHROME_IPC.commandOpen, async (packId, scopeId, itemId) => {
    if (typeof packId !== "string" || typeof scopeId !== "string") return undefined;
    if (itemId !== undefined && typeof itemId !== "string") return undefined;
    const outcome = await commandService().open(packId, scopeId, itemId);
    await openCommandLink(outcome.open);
    return outcome;
  });
  onChrome(CHROME_IPC.commandSearch, (query, scope) => {
    if (typeof query !== "string") return undefined;
    return commandService().search(query, typeof scope === "string" ? scope : "global");
  });
  onChrome(CHROME_IPC.commandOpenLink, async (link) => {
    if (typeof link !== "string" || !link.startsWith("suite://")) return;
    await window?.openDeepLink(link);
  });
  onChrome(CHROME_IPC.commandClearRecents, () => {
    commandService().clearRecents();
    return commandService().listing("");
  });

  onPack(PACK_IPC.launch, (sender): PackLaunchContext => {
    return window?.launchFor(sender.tabId) ?? LAUNCHER_CONTEXT;
  });
  onPack(PACK_IPC.info, (sender): PackInfoView => {
    return {
      id: sender.pack.id,
      name: sender.pack.name,
      containerId: sender.containerId,
      capabilities: sender.pack.capabilities,
    };
  });
  onPack(PACK_IPC.identityPack, async (sender) => packIdentityView(identityFor(sender)));
  onPack(PACK_IPC.signPackData, (sender, bytes) => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_IDENTITY_BYTES) {
      throw new Error("invalid identity payload");
    }
    // Only the pack's own data reaches this call. A relay frame, a role record
    // or a membership change would be refused by `signPackRecord` itself.
    return signPackRecord("pack-data", bytes, identityFor(sender).secretKey);
  });

  // The narrow sync transport. The host opens the pinned socket to the relay it
  // supervises; the pack sends and receives opaque frames. No frame is parsed
  // here and no document id, handle or path is in the request.
  onPack(PACK_IPC.relayConnect, async (sender, options) => {
    if (!packAllows(sender.pack, "relay")) {
      throw new Error("the relay capability is not enabled for this pack");
    }
    if (relayBroker === null) throw new Error("the relay service is not ready");
    await ensurePackConsent(sender.pack, "relay");
    return relayBroker.connect(relayScopeFor(sender), options);
  });
  onPack(PACK_IPC.relaySend, (sender, token, frame) => {
    if (!packAllows(sender.pack, "relay")) {
      throw new Error("the relay capability is not enabled for this pack");
    }
    if (relayBroker === null) throw new Error("the relay service is not ready");
    relayBroker.send(relayScopeFor(sender), token, frame);
  });
  onPack(PACK_IPC.relayClose, (sender, token) => {
    if (!packAllows(sender.pack, "relay")) return;
    relayBroker?.close(relayScopeFor(sender), token);
  });
  onPack(PACK_IPC.listDocuments, (sender) => {
    // An empty list is a kinder fail-closed answer than `undefined` for the one
    // method whose contract is a list.
    if (!packAllows(sender.pack, "documents")) return [];
    return documentsFor(sender).list(sender.containerId, sender.packId);
  });
  onPack(PACK_IPC.createDocument, async (sender, name) => {
    if (!packAllows(sender.pack, "documents") || typeof name !== "string") return undefined;
    const created = await documentsFor(sender).create(sender.containerId, sender.packId, name, {
      schemaVersion: declaredDocumentSchemaVersion(sender.pack.documents, name),
    });
    await rememberOpened(sender, created);
    return created;
  });
  onPack(PACK_IPC.openDocument, async (sender, id) => {
    if (!packAllows(sender.pack, "documents") || typeof id !== "string") return undefined;
    const opened = await documentsFor(sender).open(sender.containerId, sender.packId, id, {
      schemaVersion: declaredDocumentSchemaVersion(sender.pack.documents, id),
    });
    if (opened !== null) {
      await rememberOpened(sender, opened);
      await refreshPackReminders(sender, id);
    }
    return opened;
  });
  onPack(PACK_IPC.saveDocument, async (sender, id, bytes) => {
    if (!packAllows(sender.pack, "documents")) return undefined;
    if (typeof id !== "string" || !(bytes instanceof Uint8Array)) return undefined;
    const saved = await documentsFor(sender).save(sender.containerId, sender.packId, id, bytes, {
      schemaVersion: declaredDocumentSchemaVersion(sender.pack.documents, id),
    });
    await markSeen(sender, saved);
    await refreshPackReminders(sender, id);
    return saved;
  });
  onPack(PACK_IPC.removeDocument, async (sender, id) => {
    if (!packAllows(sender.pack, "documents") || typeof id !== "string") return undefined;
    await documentsFor(sender).remove(sender.containerId, sender.packId, id);
    await forgetDocument(sender, id);
  });

  // The four halves of the person's file and library surface. Each answers with
  // ids or relative paths; the absolute path of a document stays in this process.
  onPack(PACK_IPC.revealDocument, async (sender, id) => {
    if (!packAllows(sender.pack, "documents") || typeof id !== "string") return undefined;
    return revealDocument(
      documentsFor(sender),
      { containerId: sender.containerId, packId: sender.packId },
      id,
      (path) => window?.revealFile(path),
    );
  });
  onPack(PACK_IPC.pendingDocumentChanges, async (sender) => {
    if (!packAllows(sender.pack, "documents")) return [];
    return libraryService().pending(documentsFor(sender), libraryScopeFor(sender));
  });
  onPack(PACK_IPC.watchDocuments, async (sender, watching) => {
    if (!packAllows(sender.pack, "documents")) return;
    if (watching === true) {
      await libraryService().subscribe(
        documentsFor(sender),
        libraryScopeFor(sender),
        sender.tabId,
        (documentIds) => {
          if (!sender.webContents.isDestroyed()) {
            sender.webContents.send(PACK_EVENT.documentsChanged, [...documentIds]);
          }
        },
      );
    } else {
      libraryService().unsubscribe(sender.tabId);
    }
  });
  onPack(PACK_IPC.listRecents, async (sender) => {
    if (!packAllows(sender.pack, "recents")) {
      throw new Error("the recents capability is not enabled for this pack");
    }
    const allowed = await ensurePackConsent(sender.pack, "recents");
    publishPackData();
    if (!allowed) {
      throw new ConsentDeniedError(CAPABILITY_DENIALS.recents ?? "Recent documents are off.");
    }
    return recentsService().list(recentsScopeFor(sender));
  });
  onPack(PACK_IPC.forgetRecent, async (sender, id) => {
    if (!packAllows(sender.pack, "recents") || typeof id !== "string") return;
    await recentsService().forget(recentsScopeFor(sender), id);
  });

  onPack(PACK_IPC.listFiles, (sender, path) => {
    const { scope, service } = filesFor(sender);
    if (path !== undefined && typeof path !== "string") {
      throw new Error("invalid path");
    }
    return service.list(scope, path ?? "");
  });
  onPack(PACK_IPC.statFile, (sender, path) => {
    const { scope, service } = filesFor(sender);
    return service.stat(scope, requirePath(path));
  });
  onPack(PACK_IPC.makeFileDirectory, async (sender, path) => {
    const { scope, service } = filesFor(sender);
    await service.mkdir(scope, requirePath(path));
  });
  onPack(PACK_IPC.readFile, (sender, path, options) => {
    const { scope, service } = filesFor(sender);
    return service.read(scope, requirePath(path), readOptions(options));
  });
  onPack(PACK_IPC.writeFile, (sender, path, bytes, options) => {
    const { scope, service } = filesFor(sender);
    return service.write(scope, requirePath(path), requireBytes(bytes), writeOptions(options));
  });
  onPack(PACK_IPC.renameFile, async (sender, from, to) => {
    const { scope, service } = filesFor(sender);
    await service.rename(scope, requirePath(from), requirePath(to));
  });
  onPack(PACK_IPC.removeFile, async (sender, path, options) => {
    const { scope, service } = filesFor(sender);
    await service.remove(scope, requirePath(path), removeOptions(options));
  });
  onPack(PACK_IPC.backupFile, (sender, path) => {
    const { scope, service } = filesFor(sender);
    return service.backup(scope, requirePath(path));
  });
  onPack(PACK_IPC.lockFile, async (sender, path) => {
    const { scope, service } = filesFor(sender);
    const issued = await service.lock(scope, requirePath(path));
    return issued.token;
  });
  onPack(PACK_IPC.unlockFile, async (sender, token) => {
    const { scope, service } = filesFor(sender);
    if (typeof token !== "string") throw new Error("invalid lock token");
    await service.unlock(scope, token);
  });

  onPack(PACK_IPC.pickExternalFile, (sender, filters) => {
    return externalService().pickOpen(sender, filters);
  });
  onPack(PACK_IPC.pickExternalSave, (sender, suggestedName) => {
    return externalService().pickSave(sender, suggestedName);
  });
  onPack(PACK_IPC.readExternalFile, (sender, token) => {
    return externalService().read(sender, token);
  });
  onPack(PACK_IPC.writeExternalFile, (sender, token, bytes) => {
    return externalService().write(sender, token, bytes);
  });
  onPack(PACK_IPC.closeExternalFile, (sender, token) => {
    return externalService().close(sender, token);
  });
  onPack(PACK_IPC.importExternalFile, (sender, token, name) => {
    return externalService().importFile(sender, token, name);
  });
  onPack(PACK_IPC.importExternalFolder, (sender, destination) => {
    return externalService().importFolder(sender, destination);
  });

  onPack(PACK_IPC.openExternal, (sender, url) => {
    if (typeof url !== "string") return;
    // The OS browser is outside the pack's session and CSP, so it is egress
    // under the same capability. A pack without `network` gets no browser open.
    const link = externalLinkFor(sender.pack, url);
    if (link !== null) window?.openExternal(link);
  });

  ipcMain.on(PACK_IPC.setTitle, (event, title) => {
    const sender = packSender(event.sender.id);
    if (sender === undefined) return;
    if (!isTrustedSender(event.senderFrame?.url, [packOrigin(sender.packId, sender.containerId)])) {
      return;
    }
    if (typeof title !== "string") return;
    void window?.setTabTitle(sender.tabId, title).catch((error: unknown) => {
      console.warn("[desk] could not persist a tab title", error);
    });
  });
}

/**
 * The platform pickers the external file surface uses.
 *
 * The dialog is parented to the host window and returns an absolute path to the
 * main process only. `external.ts` immediately turns that into a token; a pack
 * never sees this value or the picker itself.
 */
function externalDialog(): ExternalDialog {
  return {
    async pickOpen(filters) {
      if (window === null) return null;
      const selection = await dialog.showOpenDialog(window.window, {
        title: "Open a file",
        buttonLabel: "Open",
        properties: ["openFile"],
        filters: filters.map((filter) => ({
          name: filter.name,
          extensions: [...filter.extensions],
        })),
      });
      if (selection.canceled) return null;
      return selection.filePaths[0] ?? null;
    },
    async pickSave(suggestedName) {
      if (window === null) return null;
      const selection = await dialog.showSaveDialog(window.window, {
        title: "Save a file",
        buttonLabel: "Save",
        defaultPath: suggestedName,
        properties: ["createDirectory", "showOverwriteConfirmation"],
      });
      if (selection.canceled) return null;
      return selection.filePath ?? null;
    },
    async pickFolder() {
      if (window === null) return null;
      const selection = await dialog.showOpenDialog(window.window, {
        title: "Import a folder",
        buttonLabel: "Import",
        properties: ["openDirectory"],
      });
      if (selection.canceled) return null;
      return selection.filePaths[0] ?? null;
    },
  };
}

/**
 * Ask for a destination and write one portable `.screen` file.
 *
 * The picker and the path stay in the main process. The file is the person's copy;
 * the host keeps its own document and its backups exactly as they were.
 */
async function exportScreenToFile(screenId: string): Promise<void> {
  if (window === null || screenStore === null) return;
  const current = window;
  const bytes = screenStore.exportScreen(screenId);
  if (bytes === null) {
    current.setNotice("That Screen is no longer here.");
    return;
  }

  const selection = await dialog.showSaveDialog(current.window, {
    title: "Export a Screen",
    buttonLabel: "Export",
    defaultPath: `${screenId}${SCREEN_FILE_EXTENSION}`,
    properties: ["createDirectory", "showOverwriteConfirmation"],
    filters: [{ name: "Suite screen", extensions: [SCREEN_FILE_EXTENSION.slice(1)] }],
  });
  if (selection.canceled) return;
  const chosen = selection.filePath;
  if (chosen === undefined) return;
  const file = chosen.endsWith(SCREEN_FILE_EXTENSION)
    ? chosen
    : `${chosen}${SCREEN_FILE_EXTENSION}`;

  try {
    await writeScreenFile(file, bytes);
    current.setNotice(`Exported ${screenId} as a .screen file.`);
  } catch (error) {
    console.warn("[desk] the screen file could not be written", error);
    current.setNotice("The Screen could not be written there.");
  }
}

/**
 * Ask for one portable `.screen` file and import it as a new Screen.
 *
 * The file is validated before the store is touched. A refusal is the sentence the
 * package produced and leaves every Screen and the Home choice alone. A success opens
 * the imported Screen, or Home when the file was the writer's Home.
 */
async function importScreenFromFile(): Promise<void> {
  if (window === null || screenStore === null) return;
  const current = window;

  const selection = await dialog.showOpenDialog(current.window, {
    title: "Import a Screen",
    buttonLabel: "Import",
    properties: ["openFile"],
    filters: [{ name: "Suite screen", extensions: [SCREEN_FILE_EXTENSION.slice(1)] }],
  });
  if (selection.canceled) return;
  const file = selection.filePaths[0];
  if (file === undefined) return;

  let bytes: Uint8Array;
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > SCREEN_FILE_MAX_BYTES) {
      current.setNotice("That file is too large to be a Suite screen file.");
      return;
    }
    bytes = new Uint8Array(await readFile(file));
  } catch {
    current.setNotice("The screen file could not be read.");
    return;
  }

  const imported = await screenStore.importScreen(bytes);
  if (!imported.ok) {
    current.setNotice(imported.message);
    return;
  }

  current.setNotice(
    imported.fromVersion < SUITE_SCREEN_VERSION
      ? `Imported ${imported.name} from Screen version ${imported.fromVersion} and updated it to this version.`
      : null,
  );
  await current.openScreen(imported.id);
}

/**
 * Ask for one archive, verify it, install it, and redraw the launcher.
 *
 * The picker is host chrome. A pack never gets a path, and this IPC is not in the
 * pack preload or `PACK_IPC`. The dialog keeps the absolute path; only the bytes
 * cross into `installPackArchive`, and a refusal is a short notice.
 *
 * An archive is checked before anything is written, so an unknown publisher can
 * be shown with its fingerprint and added by the person who chose the file
 * (S2.1). A trusted archive is then shown with its publisher, id, version and
 * capabilities before the installer runs (S2.5).
 */
async function installPackFromFile(): Promise<void> {
  if (window === null) return;

  const selection = await dialog.showOpenDialog(window.window, {
    title: "Install a pack",
    buttonLabel: "Install",
    properties: ["openFile"],
    filters: [{ name: "Suite pack", extensions: ["suitepack"] }],
  });
  if (selection.canceled) return;
  const file = selection.filePaths[0];
  if (file === undefined) return;

  let bytes: Uint8Array;
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_INSTALL_BYTES) {
      window.setNotice("That file is too large to be a Suite pack.");
      return;
    }
    bytes = await readFile(file);
  } catch {
    window.setNotice("The pack file could not be read.");
    return;
  }
  if (bytes.byteLength > MAX_INSTALL_BYTES) {
    window.setNotice("That file is too large to be a Suite pack.");
    return;
  }

  const current = window;
  let check = await checkPackArchive(bytes, packTrustOptions());
  if (!check.ok && check.error.reason === "publisher" && check.manifest !== null) {
    const manifest = check.manifest;
    const key = manifest.publisher?.key;
    const fingerprint = check.error.fingerprint;
    if (key !== undefined && fingerprint !== null && !isKeyTrusted(key)) {
      const added = await offerUnknownPublisher(current, manifest, fingerprint);
      if (!added) {
        current.setNotice(installRefusal(check.error));
        return;
      }
      check = await checkPackArchive(bytes, packTrustOptions());
    }
  }
  if (!check.ok) {
    current.setNotice(installRefusal(check.error));
    return;
  }

  const summary = packInstallSummary(check.value.manifest, check.value.publisher);
  const updating = packs.some((pack) => pack.id === summary.id);
  if (!(await confirmInstall(current, summary, updating ? "update" : "install"))) {
    current.setNotice("The install was cancelled.");
    return;
  }

  const before = packs;
  try {
    const installed = await installPackArchive(
      bytes,
      join(dataRootFor(), "packs"),
      packTrustOptions(),
    );
    const previous = before.find((pack) => pack.id === installed.id) ?? null;
    await recordInstallConsent(installed);
    await refreshPacks();
    publishPackData();
    const opened = shouldOpenAfterInstall(current.state().tabs, installed.id);
    if (opened) {
      await current.openPack(installed.id).catch((error: unknown) => {
        console.warn(`[desk] could not open ${installed.id} after install`, error);
      });
    }
    current.setNotice(
      installedNotice(installed, previous, opened, updating ? "update" : "install"),
    );
  } catch (error) {
    current.setNotice(installRefusal(error));
  }
}

/**
 * Record the install-time capabilities after a verified install.
 *
 * The confirmation showed the publisher, id, version and capability list, so an
 * `install`-tier capability is answered. First-use and token capabilities are
 * deliberately left unanswered; they are asked where they are used.
 */
async function recordInstallConsent(pack: InstalledPackInfo): Promise<void> {
  if (consentRecord === null) return;
  try {
    await consentRecord.recordInstall({
      pack: { publisherId: pack.publisher.id, packId: pack.id, version: pack.version },
      capabilities: pack.capabilities,
    });
  } catch (error) {
    console.warn("[desk] the install consent could not be recorded", error);
  }
}

/** Open a small JSON trust file the person chose. Nothing is fetched. */
async function readPickedJson(
  current: ShellWindow,
  title: string,
  button: string,
): Promise<Uint8Array | null> {
  const selection = await dialog.showOpenDialog(current.window, {
    title,
    buttonLabel: button,
    properties: ["openFile"],
    filters: [{ name: "Suite trust file", extensions: ["json"] }],
  });
  if (selection.canceled) return null;
  const file = selection.filePaths[0];
  if (file === undefined) return null;

  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_ADVISORY_BYTES) {
      current.setNotice("That file is too large to be a Suite trust file.");
      return null;
    }
    return await readFile(file);
  } catch {
    current.setNotice("That file could not be read.");
    return null;
  }
}

/**
 * Rotate a publisher's key from a statement the person chose (S2.3).
 *
 * The statement is verified first and the new fingerprint is shown before
 * anything is written. Only the confirmation that follows that display applies
 * it. Installed versions are verified by the retired key, so they keep running;
 * the next update must be signed by the new key.
 */
async function rotatePublisherFromFile(): Promise<void> {
  if (window === null) return;
  const current = window;
  const bytes = await readPickedJson(current, "Rotate a publisher key", "Open statement");
  if (bytes === null) return;

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    current.setNotice("That file is not a rotation statement.");
    return;
  }
  const statement = parseRotationStatement(raw);
  if (statement === null || trustStore === null) {
    current.setNotice("That file is not a rotation statement.");
    return;
  }

  const check = await checkPublisherRotation(statement, trustStore.publishers);
  if (!check.ok) {
    current.setNotice(`The rotation was refused: ${check.message}`);
    return;
  }

  const answer = await dialog.showMessageBox(current.window, {
    type: "warning",
    title: "Rotate this publisher key?",
    message: `Publisher ${check.preview.publisherId} would move to a new key.`,
    detail: `New key fingerprint: ${check.preview.newFingerprint}\nCurrent key fingerprint: ${check.preview.previousFingerprint}\nSequence: ${check.preview.sequence}\n\nOnly confirm if this is the fingerprint the publisher gave you. Installed packs keep running.`,
    buttons: ["Cancel", "Rotate this key"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (answer.response !== 1) {
    current.setNotice("The rotation was cancelled.");
    return;
  }

  const applied = await applyPublisherRotation(trustRootFor(dataRootFor()), {
    statement,
    fingerprint: check.preview.newFingerprint,
  });
  if (!applied.ok) {
    current.setNotice(`The rotation was refused: ${applied.message}`);
    return;
  }

  trustStore = await openPublisherTrust(trustRootFor(dataRootFor())).catch(() => trustStore);
  await refreshPacks();
  publishPackData();
  current.setNotice(
    `Publisher ${applied.publisher.id} now trusts key fingerprint ${applied.publisher.fingerprint}. Installed packs keep running; the next update must use the new key.`,
  );
}

/**
 * Record a signed revocation advisory from a file (S2.4).
 *
 * The file is checked against the trust store before it is written. A recorded
 * advisory refuses a new install; it never closes a running pack.
 */
async function importRevocationFromFile(): Promise<void> {
  if (window === null) return;
  const current = window;
  const bytes = await readPickedJson(current, "Add a revocation advisory", "Open advisory");
  if (bytes === null) return;

  const result = await importRevocationAdvisory(trustRootFor(dataRootFor()), bytes, {
    publishers: trustStore?.publishers ?? [],
    allowPersonIssuer: true,
  });
  if (!result.ok) {
    current.setNotice(`The advisory was refused: ${result.message}`);
    return;
  }

  await reloadRevocations();
  await refreshPacks();
  publishPackData();
  current.setNotice(
    `Recorded a revocation for ${result.advisory.publisher} ${result.advisory.pack}. New installs are blocked; an installed copy keeps running.`,
  );
}

function isKeyTrusted(key: string): boolean {
  return trustStore !== null && isPublisherKeyTrusted(trustStore.publishers, key);
}

/**
 * Show the key a pack names and offer to add it.
 *
 * The person sees the fingerprint before the key exists in the store; only the
 * response that follows that display adds it. The manifest's claimed id is the
 * id the key gets, so a pack that claims the first-party id is refused by the
 * store rather than silently aliased to it.
 */
async function offerUnknownPublisher(
  current: ShellWindow,
  manifest: {
    readonly name: string;
    readonly version: string;
    readonly publisher?: { readonly id?: string; readonly key: string } | undefined;
  },
  fingerprint: string,
): Promise<boolean> {
  const key = manifest.publisher?.key;
  if (key === undefined || window === null) return false;
  const answer = await dialog.showMessageBox(current.window, {
    type: "warning",
    title: "Unknown publisher",
    message: `${manifest.name} ${manifest.version} is signed by a publisher this host does not trust.`,
    detail: `Publisher id: ${manifest.publisher?.id ?? "(none named)"}\nKey fingerprint: ${fingerprint}\n\nOnly add this key if you know who owns it.`,
    buttons: ["Cancel", "Trust this publisher"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (answer.response !== 1) return false;

  const requested = manifest.publisher?.id;
  const result = await addTrustedPublisher(trustRootFor(dataRootFor()), {
    key,
    fingerprint,
    ...(requested === undefined ? {} : { id: requested }),
  }).catch((error: unknown) => {
    console.warn("[desk] the publisher key could not be added", error);
    return null;
  });
  if (result === null || !result.ok) {
    current.setNotice(
      result === null
        ? "The publisher key could not be added."
        : `The publisher was not added: ${result.message}`,
    );
    return false;
  }
  trustStore = await openPublisherTrust(trustRootFor(dataRootFor())).catch(() => trustStore);
  return true;
}

/** What the chrome asked the installer to do. */
type InstallAction = "install" | "update" | "reinstall";

/** The four facts S2.5 requires, before the installer writes anything. */
async function confirmInstall(
  current: ShellWindow,
  summary: PackInstallSummary,
  action: InstallAction,
): Promise<boolean> {
  const answer = await dialog.showMessageBox(current.window, {
    type: "info",
    title: `${action === "install" ? "Install" : action === "update" ? "Update" : "Reinstall"} this pack?`,
    message: describePackInstall(summary, action),
    detail: `Publisher id: ${summary.publisher.id}\nKey fingerprint: ${summary.publisher.fingerprint}\nPack id: ${summary.id}\nVersion: ${summary.version}\nCapabilities: ${summary.capabilities.length === 0 ? "none" : summary.capabilities.join(", ")}`,
    buttons: [
      "Cancel",
      action === "install" ? "Install" : action === "update" ? "Update" : "Reinstall",
    ],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  });
  return answer.response === 1;
}

/** The sentence after an install, update or reinstall, with the same four facts. */
function installedNotice(
  installed: InstalledPackInfo,
  previous: PackInfo | null,
  opened: boolean,
  action: InstallAction,
): string {
  const summary: PackInstallSummary = {
    id: installed.id,
    name: installed.name,
    version: installed.version,
    capabilities: installed.capabilities,
    publisher: installed.publisher,
  };
  const keptOlder =
    action === "update" &&
    previous !== null &&
    comparePackVersions(installed.version, previous.version) > 0
      ? ` Version ${previous.version} is still on disk; remove it from the launcher when you are ready.`
      : "";
  const next = opened
    ? "The app is open now."
    : "Restart Suite Desk to run the new version of the already-open app.";
  const kept = action === "reinstall" ? " Its documents and files were kept." : "";
  return `${describePackInstall(summary, action)} ${next}${kept}${keptOlder}`;
}

function installRefusal(error: unknown): string {
  if (error instanceof InstalledPackError) return `The pack was refused: ${error.message}`;
  console.warn("[desk] pack install failed", error);
  return "The pack could not be installed.";
}

/**
 * Install one trusted archive the catalogue listed.
 *
 * The entry is looked up again by id and version, and `installCataloguePack`
 * re-reads and re-verifies the bytes. A stale or swapped file is refused by the
 * same rules as the file picker. An update is just a newer version directory;
 * the older one stays until the person removes it from the launcher. The card
 * already showed the publisher fingerprint and capabilities; the confirmation
 * repeats them at the moment of install (S2.5).
 */
async function installPackFromCatalogue(id: string, version: string): Promise<void> {
  if (window === null) return;

  const entry = catalogue.find(
    (candidate) => candidate.id === id && candidate.version === version && candidate.trusted,
  );
  if (entry === undefined) {
    window.setNotice(`No trusted ${id} ${version} is in the catalogue.`);
    return;
  }
  if (entry.publisher === null) {
    window.setNotice(`No publisher was resolved for ${id} ${version}.`);
    return;
  }

  const current = window;
  const summary: PackInstallSummary = {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    capabilities: entry.capabilities,
    publisher: entry.publisher,
  };
  const previous = packs.find((pack) => pack.id === id) ?? null;
  const action = catalogueActionFor(id, version, previous);
  if (!(await confirmInstall(current, summary, action))) {
    current.setNotice("The install was cancelled.");
    return;
  }

  try {
    const installed = await installCataloguePack(
      entry,
      join(dataRootFor(), "packs"),
      packTrustOptions(),
      { replace: action === "reinstall" },
    );
    await recordInstallConsent(installed);
    await refreshPacks();
    publishPackData();

    const opened = shouldOpenAfterInstall(current.state().tabs, installed.id);
    if (opened) {
      await current.openPack(installed.id).catch((error: unknown) => {
        console.warn(`[desk] could not open ${installed.id} after install`, error);
      });
    }
    current.setNotice(installedNotice(installed, previous, opened, action));
  } catch (error) {
    current.setNotice(installRefusal(error));
  }
}

/**
 * Install one catalogue app from the first-run wizard.
 *
 * The wizard's explicit selection is the consent: the person saw the catalogue cards and chose
 * the app, so the host verifies and installs without a second per-app dialog. The archive is
 * still re-read and re-verified by the installer, and only a trusted catalogue entry is named.
 */
async function installFirstRunPack(id: string): Promise<FirstRunInstallResult> {
  const entry = catalogue.find((candidate) => candidate.id === id && candidate.trusted);
  if (entry === undefined) {
    return { ok: false, detail: `No trusted ${id} is in the catalogue.` };
  }
  const previous = packs.find((pack) => pack.id === id) ?? null;
  const action = catalogueActionFor(id, entry.version, previous);
  try {
    const installed = await installCataloguePack(
      entry,
      join(dataRootFor(), "packs"),
      packTrustOptions(),
      { replace: action === "reinstall" },
    );
    await recordInstallConsent(installed);
    await refreshPacks();
    publishPackData();
    return { ok: true, detail: "Installed" };
  } catch (error) {
    return { ok: false, detail: installRefusal(error) };
  }
}

/** Record that the person finished the first-run wizard and show the chrome. */
async function completeFirstRun(): Promise<void> {
  await completeOnboarding(dataRootFor());
  // The wizard covers the chrome, so Home can be opened behind it; the completion paint
  // then reveals an empty Home instead of the launcher in the same frame.
  await window?.openHome().catch(() => undefined);
  window?.setFirstRun(false);
  firstRun = false;
}

/**
 * Decide what a catalogue install means for the current installs.
 *
 * A version already on disk is a reinstall and replaces it. A newer version
 * beside the active one is an update; an older or absent one is an install.
 * Document and file roots are untouched by every one of them.
 */
function catalogueActionFor(id: string, version: string, active: PackInfo | null): InstallAction {
  if (installedVersions.some((entry) => entry.id === id && entry.version === version)) {
    return "reinstall";
  }
  if (active === null) return "install";
  try {
    return comparePackVersions(version, active.version) > 0 ? "update" : "install";
  } catch {
    return "install";
  }
}

/**
 * Remove one installed version.
 *
 * If the removed version is the one open tabs are running, those tabs close
 * first; the notice says how many. An older version left behind by an update is
 * removed without touching the tabs running the new one. Documents and files
 * live outside the pack root and are never part of this operation.
 */
async function uninstallPackVersionFrom(id: string, version: string): Promise<void> {
  if (window === null) return;

  const plan = planUninstall(window.state().tabs, id);
  if (plan.closeTabs.length > 0) {
    await window.closeTabs(plan.closeTabs);
  }

  try {
    await uninstallPackVersion(join(dataRootFor(), "packs"), id, version);
  } catch (error) {
    window.setNotice(
      error instanceof InstalledPackError
        ? `The pack version was not removed: ${error.message}`
        : "The pack version could not be removed.",
    );
    // A failed removal may still have changed the disk; re-read rather than keep
    // a stale list. The tabs are already closed, which is safe either way.
    await refreshPacks();
    publishPackData();
    return;
  }

  await refreshPacks();
  // A pack id with no version left is removed, so its consent goes too. An
  // older version kept after an update still holds the record it was granted.
  if (!installedVersions.some((entry) => entry.id === id)) {
    await consentService()
      .clearForPack(id)
      .catch((error: unknown) => {
        console.warn("[desk] the consent record could not be cleared for a removed pack", error);
      });
  }
  publishPackData();
  const closed =
    plan.closeTabs.length > 0
      ? ` ${plan.closeTabs.length} open tab${plan.closeTabs.length === 1 ? "" : "s"} closed first.`
      : "";
  window.setNotice(
    `${id} ${version} was removed. Its documents and files were left in place.${closed}`,
  );
}

/** The wall clock. The scheduler is tested with a fake one in `reminders.test.ts`. */
const reminderClock: ReminderClock = {
  now: () => Date.now(),
  setTimer: (at, fire) => {
    const timer = setTimeout(fire, Math.max(0, at - Date.now()));
    return { cancel: () => clearTimeout(timer) };
  },
};

/**
 * The notification token's remembered answer, without opening a dialog.
 *
 * `prompt` means unanswered or past the token's thirty days; the scheduler asks
 * through the one consent surface. A denial is returned and shown, never
 * re-asked by the pack.
 */
function reminderPermissionFor(packId: string): ReminderPermission {
  if (!Notification.isSupported()) return "unsupported";
  const pack = packs.find((candidate) => candidate.id === packId);
  if (pack === undefined) return "denied";
  const state = consentService().state(consentRequestFor(pack, "notifications"));
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "prompt";
}

async function ensureReminderConsent(packId: string): Promise<ReminderPermission> {
  if (!Notification.isSupported()) return "unsupported";
  const pack = packs.find((candidate) => candidate.id === packId);
  if (pack === undefined) return "denied";
  return (await ensurePackConsent(pack, "notifications")) ? "granted" : "denied";
}

/**
 * Start the host scheduler.
 *
 * It reads only the queue. A denied or unsupported permission is a sentence on
 * Home and a refusal on the pack's card, not a silently lost reminder; the rows
 * stay queued until the person asks again from that card.
 */
function startReminderScheduler(): void {
  const queue = reminderQueue;
  if (queue === null) return;

  const delivery = createReminderDelivery(reminderPlatform(), {
    onRoute: (row) => {
      window?.focus();
      handleDeepLink(row.deepLink);
    },
    onFailed: (row, message) => {
      console.warn(`[desk] the reminder “${row.title}” could not be shown: ${message}`);
      window?.setReminderStatus(`“${row.title}” could not be shown.`);
    },
  });

  reminderScheduler = new ReminderScheduler({
    queue,
    clock: reminderClock,
    delivery,
    consent: {
      state: reminderPermissionFor,
      ensure: ensureReminderConsent,
    },
    onPermission: (permission) => {
      window?.setReminderStatus(reminderSentence(permission));
      publishPackData();
    },
    onFailed: (row, error) => {
      console.warn(`[desk] the reminder “${row.title}” failed`, error);
      window?.setReminderStatus(`“${row.title}” could not be shown.`);
    },
  });

  void reminderScheduler.start().catch((error: unknown) => {
    console.warn("[desk] the reminder scheduler did not start", error);
  });
}

/**
 * The Electron platform.
 *
 * Electron's main-process `Notification` has no permission probe. The consent
 * question lives in the scheduler's surface, not here; this half only creates
 * and shows a row. A system with no notification channel answers `unsupported`.
 */
function reminderPlatform(): ReminderPlatform {
  return {
    isSupported: () => Notification.isSupported(),
    create: (row) => {
      const notification = new Notification({
        title: row.title,
        ...(row.body.length > 0 ? { body: row.body } : {}),
        urgency: "normal",
      });
      return {
        onClick: (listener) => {
          notification.on("click", listener);
        },
        onFailed: (listener) => {
          notification.on("failed", (_event, error) => listener(error));
        },
        show: () => notification.show(),
      };
    },
  };
}

function reminderSentence(permission: ReminderPermission): string | null {
  if (permission === "denied") {
    return "Reminders are off: Suite is not allowed to show notifications.";
  }
  if (permission === "unsupported") {
    return "Reminders are not available on this system.";
  }
  return null;
}

/**
 * Refresh one pack's rows from its declared projection.
 *
 * Called on save and on open, and nowhere else: a background refresh would be
 * the pack running by another name. A transport failure keeps the last good
 * rows; a projection that returns an invalid row removes them, because the host
 * will not schedule a row it cannot trust.
 */
async function refreshPackReminders(sender: PackSender, documentId: string): Promise<void> {
  const queue = reminderQueue;
  if (queue === null || !packAllows(sender.pack, "notifications")) return;

  let declaration: PackDocument | null = null;
  try {
    declaration = findDocument(sender.pack.documents ?? [], documentId);
  } catch {
    return;
  }
  if (declaration.projection === undefined) return;

  let projected: Uint8Array;
  try {
    projected = await new DocumentMigrations(documentsFor(sender)).project(
      { containerId: sender.containerId, packId: sender.packId },
      sender.pack.documents ?? [],
      documentId,
      new RendererProjectionRunner(sender),
    );
  } catch (error) {
    console.warn(`[desk] ${sender.packId} did not project its reminders`, error);
    return;
  }

  let rows: readonly ProjectedReminder[];
  try {
    rows = parseProjectedReminders(decodeProjection(projected), sender.packId);
  } catch (error) {
    console.warn(`[desk] ${sender.packId} projected an invalid reminder row`, error);
    await queue.removePack(sender.packId);
    await reminderScheduler?.refresh();
    return;
  }

  await queue.replacePack(sender.packId, rows, Date.now());
  await reminderScheduler?.refresh();
}

/** Drop rows for packs that are gone, or that no longer declare notifications. */
async function pruneReminders(): Promise<void> {
  const queue = reminderQueue;
  if (queue === null) return;
  const allowed = new Set(
    packs.filter((pack) => pack.capabilities.includes("notifications")).map((pack) => pack.id),
  );
  await queue.prune(allowed);
  await reminderScheduler?.refresh();
}

function decodeProjection(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("the projection did not return JSON");
  }
}

function onChrome<T>(channel: string, handler: (...args: unknown[]) => T): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event.senderFrame?.url, [CHROME_ORIGIN])) return undefined;
    return handler(...args);
  });
}

function onPack<T>(channel: string, handler: (sender: PackSender, ...args: unknown[]) => T): void {
  ipcMain.handle(channel, (event, ...args) => {
    const sender = packSender(event.sender.id);
    if (sender === undefined) return undefined;
    if (!isTrustedSender(event.senderFrame?.url, [packOrigin(sender.packId, sender.containerId)])) {
      return undefined;
    }
    return handler(sender, ...args);
  });
}

/**
 * The store and scope for a sender that declared `files`.
 *
 * Throwing here is the capability answer: a pack without the capability gets a
 * rejected call, not a silent empty result that looks like a real file.
 */
function filesFor(sender: PackSender): { scope: FilesScope; service: PackFilesService } {
  const scope = filesScope(sender);
  if (scope === null) throw new Error("the files capability is not enabled for this pack");
  if (files === null) throw new Error("the files service is not ready");
  return { scope, service: files };
}

function externalService(): ExternalFilesService {
  if (externalFiles === null) throw new Error("the external files service is not ready");
  return externalFiles;
}

function requirePath(value: unknown): string {
  if (typeof value !== "string") throw new Error("invalid path");
  return value;
}

function requireBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("file contents must be bytes");
  return value;
}

function readOptions(value: unknown): FileReadOptions {
  if (typeof value !== "object" || value === null) return {};
  const maxBytes = (value as { maxBytes?: unknown }).maxBytes;
  if (maxBytes === undefined) return {};
  if (typeof maxBytes !== "number" || !Number.isFinite(maxBytes) || maxBytes < 0) {
    throw new Error("invalid read options");
  }
  return { maxBytes };
}

function writeOptions(value: unknown): FileWriteOptions {
  const options: { atomic?: boolean; expectedMtimeMs?: number } = {};
  if (typeof value !== "object" || value === null) return options;

  const record = value as { atomic?: unknown; expectedMtimeMs?: unknown };
  if (record.atomic !== undefined) {
    if (typeof record.atomic !== "boolean") throw new Error("invalid write options");
    options.atomic = record.atomic;
  }
  if (record.expectedMtimeMs !== undefined) {
    if (typeof record.expectedMtimeMs !== "number" || !Number.isFinite(record.expectedMtimeMs)) {
      throw new Error("invalid write options");
    }
    options.expectedMtimeMs = record.expectedMtimeMs;
  }
  return options;
}

function removeOptions(value: unknown): FileRemoveOptions {
  const options: { recursive?: boolean } = {};
  if (typeof value !== "object" || value === null) return options;

  const recursive = (value as { recursive?: unknown }).recursive;
  if (recursive !== undefined) {
    if (typeof recursive !== "boolean") throw new Error("invalid remove options");
    options.recursive = recursive;
  }
  return options;
}
