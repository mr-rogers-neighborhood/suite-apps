import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { desktopCsp, isTrustedSender, resolveProtocolAsset } from "@suite/desktop";
import { isPublisherKeyTrusted, type PackDocument, SUITE_PUBLISHER_ID } from "@suite/pack";
import { cssVariables, defaultTheme } from "@suite/theme";
import { app, dialog, ipcMain, Notification, nativeTheme, net, protocol } from "electron";
import {
  type CataloguePack,
  catalogueEntry,
  catalogueRootFor,
  installCataloguePack,
  loadCatalogue,
} from "./catalogue.js";
import { LAUNCHER_CONTEXT, suiteLinkFromArgv } from "./deepLink.js";
import { DocumentMigrations, findDocument } from "./documentMigrations.js";
import { DocumentStore, declaredDocumentSchemaVersion } from "./documents.js";
import { type ExternalDialog, ExternalFilesService } from "./external.js";
import { type FilesScope, filesScope, PackFilesService } from "./files.js";
import { openHomeScreen } from "./home.js";
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
import { SCREENS_INDEX_FILENAME, ScreenSet } from "./screens.js";
import { type PackSender, packSender } from "./senders.js";
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
  type InstalledVersionView,
  PACK_EVENT,
  PACK_IPC,
  PACK_SCHEME,
  type PackInfoView,
  type PackLaunchContext,
  type ThemeView,
} from "./shared.js";
import { SpaceStore } from "./spaces.js";
import { ShellWindow } from "./window.js";

/**
 * Suite.
 *
 * The host is deliberately small: it owns windows, tabs, the space document,
 * pack installation and the capability broker. It never imports a pack, parses an
 * app document or reads a sync key. Everything a pack may do crosses one of the
 * handlers below, and every handler scopes the request to the sender.
 */
app.setName("Suite");

/**
 * The product name in the About panel is Suite Desk. `setName("Suite")` stays
 * because it also decides the data directory, which is not part of the rename.
 */
app.setAboutPanelOptions({ applicationName: "Suite Desk" });

const userDataOverride = process.env.SUITE_SHELL_USER_DATA?.trim();
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
  app.on("before-quit", () => {
    reminderScheduler?.stop();
    void spaceStore?.flush().catch((error: unknown) => {
      console.warn("[shell] space document flush failed", error);
    });
    void screenStore?.flush().catch((error: unknown) => {
      console.warn("[shell] screen document flush failed", error);
    });
  });
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId("run.suite.shell");

  const dataRoot = dataRootFor();
  await mkdir(dataRoot, { recursive: true });
  // The device key is host data, not pack data. A missing file is a first run
  // and gets a fresh key; a malformed one is reported and leaves identity
  // calls refused rather than silently changing every pack's identity.
  deviceKey = await openDeviceKey(join(dataRoot, "identity")).catch((error: unknown) => {
    console.warn("[shell] the device key could not be opened", error);
    return null;
  });
  // The trust store is read before any pack: a pack is verified against it, so a
  // failure here must fall back to the preinstalled key, never to "trust all".
  trustStore = await openPublisherTrust(trustRootFor(dataRoot, process.env)).catch(
    (error: unknown) => {
      console.warn("[shell] the publisher trust store could not be opened", error);
      return preinstalledTrustStore();
    },
  );
  // A malformed advisory file is reported and treated as empty; it is host
  // state, not a trust root, so it does not fail the launch.
  revocations = await openRevocations(trustRootFor(dataRoot, process.env))
    .then((store) => store.revocations)
    .catch((error: unknown) => {
      console.warn("[shell] the revocation advisories could not be opened", error);
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
      console.warn("[shell] could not create the catalogue directory", error);
    },
  );

  await refreshCatalogue();
  await refreshPacks();
  spaceStore = await SpaceStore.open(join(dataRoot, "spaces.loro"));
  // The host's own Screens. Home is created here and opened before any pack view
  // exists, so the first window a person sees is the shell's composition rather
  // than an empty launcher.
  screenStore = await ScreenSet.open({
    directory: join(dataRoot, "screens"),
    indexFile: join(dataRoot, SCREENS_INDEX_FILENAME),
  });
  await openHomeScreen(screenStore, spaceStore);
  // One store per (container, pack) under the publisher's root. This is host
  // data, deliberately separate from the pack's code root.
  const fileService = new PackFilesService(join(dataRoot, "files"));
  files = fileService;
  // The dialogs are host chrome; the absolute path a person picks stays here.
  // `external.ts` turns it into an opaque, tab-scoped token for the pack.
  externalFiles = new ExternalFilesService(externalDialog(), fileService);

  serveProtocols();
  registerIpc();
  nativeTheme.on("updated", () => window?.setTheme(themeView()));
  openWindow();
  startReminderScheduler();

  const startupLink = pendingDeepLink ?? suiteLinkFromArgv(process.argv);
  pendingDeepLink = null;
  if (startupLink !== null) handleDeepLink(startupLink);
}

function dataRootFor(): string {
  const override = process.env.SUITE_SHELL_DATA?.trim();
  if (override !== undefined && override.length > 0) return override;
  return join(app.getPath("userData"), "shell");
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
    console.warn("[shell] could not open a Suite link", error);
    window?.setNotice("That Suite link could not be opened.");
  });
}

function packTrustOptions(): PackTrustOptions {
  return {
    publishers: trustStore?.publishers ?? [],
    hostContractVersion: HOST_CONTRACT_VERSION,
    hostVersion: HOST_VERSION,
    hostCapabilities: HOST_CAPABILITIES,
    revocations,
  };
}

/** Re-read the advisories after one is imported, without trusting a bad file. */
async function reloadRevocations(): Promise<void> {
  try {
    revocations = (await openRevocations(trustRootFor(dataRootFor()))).revocations;
  } catch (error) {
    console.warn("[shell] the revocation advisories could not be read", error);
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
function documentsFor(sender: PackSender): DocumentStore {
  const publisherId = sender.pack.publisher?.id ?? SUITE_PUBLISHER_ID;
  let store = documentStores.get(publisherId);
  if (store === undefined) {
    const root = documentsRootFor(dataRootFor(), publisherId);
    store = new DocumentStore(root, publisherId, documentScopeLabel(publisherId));
    documentStores.set(publisherId, store);
  }
  return store;
}

function recentsService(): RecentsStore {
  if (recentsStore === null) throw new Error("the recent list is not ready");
  return recentsStore;
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
    console.warn("[shell] the recent list could not be updated", error);
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
    console.warn("[shell] the document watch could not be updated", error);
  }
}

async function forgetDocument(sender: PackSender, id: string): Promise<void> {
  await Promise.all([
    libraryService()
      .forget(libraryScopeFor(sender), id)
      .catch((error: unknown) => {
        console.warn("[shell] the document watch could not forget a document", error);
      }),
    recentsService()
      .forget(recentsScopeFor(sender), id)
      .catch((error: unknown) => {
        console.warn("[shell] the recent list could not forget a document", error);
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
      `[shell] catalogue index sequence ${loaded.sequence} verified; ${loaded.index.packs.length} entry(ies)`,
    );
    return;
  }

  catalogue = await loadCatalogue(root, packTrustOptions(), null);
  catalogueSource =
    loaded.reason === "refused"
      ? `The local catalogue directory is in use; the published index was refused. ${loaded.message}`
      : `The local catalogue directory is in use. ${loaded.message}`;
  console.warn(`[shell] ${loaded.message}`);
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
    console.warn(`[shell] refused pack ${label}: ${issue.message}`);
  }

  const development = devPacksEnabled({ isPackaged: app.isPackaged, env: process.env })
    ? discoverPacks(packsRootFor(app.getAppPath()))
    : [];

  packs = mergePackSources({ installed: scan.packs, development });
  installedVersions = scan.versions;
  await pruneReminders();
  console.info(
    `[shell] ${packs.length} pack(s) available; ${catalogue.length} catalogue archive(s)`,
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
  window?.setPackData(packs, catalogueView(), installedVersionViews(), catalogueSource);
}

function themeView(): ThemeView {
  const mode = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return { mode, values: { ...cssVariables(defaultTheme(), mode) } };
}

function openWindow(): void {
  if (spaceStore === null || screenStore === null) {
    throw new Error("the shell is not ready");
  }
  let created: ShellWindow | null = null;
  created = new ShellWindow({
    packs,
    catalogue: catalogueView(),
    catalogueSource,
    installedVersions: installedVersionViews(),
    spaces: spaceStore,
    screens: screenStore,
    theme: themeView(),
    onViewClosed: (tabId) => {
      files?.releaseOwner(tabId);
      externalFiles?.releaseOwner(tabId);
      libraryWatch?.unsubscribe(tabId);
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

function registerIpc(): void {
  registerProjectionChannels();
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
  onPack(PACK_IPC.listRecents, (sender) => {
    if (!packAllows(sender.pack, "recents")) {
      throw new Error("the recents capability is not enabled for this pack");
    }
    return recentsService().list(recentsScopeFor(sender), () => askRecentsPermission(sender));
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
      console.warn("[shell] could not persist a tab title", error);
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
 * Ask once for the recent list, and remember the answer with the list.
 *
 * This is the same first-use question the reminder permission asks (S4.2): the
 * host asks on behalf of one pack, records the answer and never asks again. The
 * shell has no general consent record (S4.3), so the answer lives beside the
 * rows it gates rather than in a shared grant file.
 */
async function askRecentsPermission(sender: PackSender): Promise<boolean> {
  if (window === null) return false;
  const answer = await dialog.showMessageBox(window.window, {
    type: "question",
    title: "Allow recent files?",
    message: `${sender.pack.name} wants to read the host's recent-files list.`,
    detail:
      "Suite records which document was opened and when, never its contents. The app sees names for its own documents; another app's row shows only the app and time.",
    buttons: ["Don't allow", "Allow"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return answer.response === 1;
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
    await refreshPacks();
    publishPackData();
    const opened = shouldOpenAfterInstall(current.state().tabs, installed.id);
    if (opened) {
      await current.openPack(installed.id).catch((error: unknown) => {
        console.warn(`[shell] could not open ${installed.id} after install`, error);
      });
    }
    current.setNotice(
      installedNotice(installed, previous, opened, updating ? "update" : "install"),
    );
  } catch (error) {
    current.setNotice(installRefusal(error));
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
    console.warn("[shell] the publisher key could not be added", error);
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
    : "Restart Suite to run the new version of the already-open app.";
  const kept = action === "reinstall" ? " Its documents and files were kept." : "";
  return `${describePackInstall(summary, action)} ${next}${kept}${keptOlder}`;
}

function installRefusal(error: unknown): string {
  if (error instanceof InstalledPackError) return `The pack was refused: ${error.message}`;
  console.warn("[shell] pack install failed", error);
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
    await refreshPacks();
    publishPackData();

    const opened = shouldOpenAfterInstall(current.state().tabs, installed.id);
    if (opened) {
      await current.openPack(installed.id).catch((error: unknown) => {
        console.warn(`[shell] could not open ${installed.id} after install`, error);
      });
    }
    current.setNotice(installedNotice(installed, previous, opened, action));
  } catch (error) {
    current.setNotice(installRefusal(error));
  }
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
 * Start the host scheduler.
 *
 * It reads only the queue. A denied or unsupported permission is a sentence on
 * Home, not a silently lost reminder; the rows stay queued until a later grant.
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
      console.warn(`[shell] the reminder “${row.title}” could not be shown: ${message}`);
      window?.setReminderStatus(`“${row.title}” could not be shown.`);
    },
  });

  reminderScheduler = new ReminderScheduler({
    queue,
    clock: reminderClock,
    delivery,
    onPermission: (permission) => {
      window?.setReminderStatus(reminderSentence(permission));
    },
    onFailed: (row, error) => {
      console.warn(`[shell] the reminder “${row.title}” failed`, error);
      window?.setReminderStatus(`“${row.title}” could not be shown.`);
    },
  });

  void reminderScheduler.start().catch((error: unknown) => {
    console.warn("[shell] the reminder scheduler did not start", error);
  });
}

/**
 * The Electron platform.
 *
 * Electron's main-process `Notification` has no permission probe, so the host
 * asks the person once and records the answer with the queue. A system with no
 * notification channel answers `unsupported`; a denial is visible on Home.
 */
function reminderPlatform(): ReminderPlatform {
  return {
    isSupported: () => Notification.isSupported(),
    ask: async (): Promise<ReminderPermission> => {
      if (window === null) return "denied";
      const answer = await dialog.showMessageBox(window.window, {
        type: "question",
        title: "Allow reminders?",
        message: "Suite can show reminders from your apps after they are closed.",
        detail:
          "Suite schedules and shows the notification; the app only declares which tasks are reminders. Your system notification settings still apply.",
        buttons: ["Don't show reminders", "Allow reminders"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return answer.response === 1 ? "granted" : "denied";
    },
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
    console.warn(`[shell] ${sender.packId} did not project its reminders`, error);
    return;
  }

  let rows: readonly ProjectedReminder[];
  try {
    rows = parseProjectedReminders(decodeProjection(projected), sender.packId);
  } catch (error) {
    console.warn(`[shell] ${sender.packId} projected an invalid reminder row`, error);
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
