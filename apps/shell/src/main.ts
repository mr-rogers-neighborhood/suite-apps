import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { desktopCsp, isTrustedSender, resolveProtocolAsset } from "@suite/desktop";
import { SUITE_PACK_PUBLIC_KEY } from "@suite/pack/pinned-key";
import { cssVariables, defaultTheme } from "@suite/theme";
import { app, dialog, ipcMain, nativeTheme, net, protocol } from "electron";
import { DocumentStore } from "./documents.js";
import { type FilesScope, filesScope, PackFilesService } from "./files.js";
import {
  InstalledPackError,
  installPackArchive,
  loadInstalledPacks,
  MAX_ARCHIVE_BYTES,
  type PackTrustOptions,
} from "./installedPacks.js";
import { devPacksEnabled, mergePackSources, shouldOpenAfterInstall } from "./packRegistry.js";
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
import { type PackSender, packSender } from "./senders.js";
import {
  CHROME_HOST,
  CHROME_IPC,
  CHROME_ORIGIN,
  CHROME_SCHEME,
  type FileReadOptions,
  type FileRemoveOptions,
  type FileWriteOptions,
  PACK_IPC,
  PACK_SCHEME,
  type PackInfoView,
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
let documents: DocumentStore | null = null;
let files: PackFilesService | null = null;
let packs: readonly PackInfo[] = [];

/** The compressed archive cap this host opens from the picker. The reader enforces its own entry limits too. */
const MAX_INSTALL_BYTES = MAX_ARCHIVE_BYTES;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => window?.focus());

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error("Suite failed to start", error);
      app.quit();
    });

  app.on("window-all-closed", () => app.quit());
  app.on("activate", () => {
    if (window === null) openWindow();
    else window.focus();
  });
  app.on("before-quit", () => {
    void spaceStore?.flush().catch((error: unknown) => {
      console.warn("[shell] space document flush failed", error);
    });
  });
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId("run.suite.shell");

  const dataRoot = dataRootFor();
  await mkdir(dataRoot, { recursive: true });

  await refreshPacks();
  spaceStore = await SpaceStore.open(join(dataRoot, "spaces.loro"));
  // Documents are resolved under documents/<container>/<pack>.
  documents = new DocumentStore(join(dataRoot, "documents"));
  // One store per (container, pack), created on first use. This is host data,
  // deliberately separate from the pack's code root.
  files = new PackFilesService(join(dataRoot, "files"));

  serveProtocols();
  registerIpc();
  nativeTheme.on("updated", () => window?.setTheme(themeView()));
  openWindow();
}

function dataRootFor(): string {
  const override = process.env.SUITE_SHELL_DATA?.trim();
  if (override !== undefined && override.length > 0) return override;
  return join(app.getPath("userData"), "shell");
}

function packTrustOptions(): PackTrustOptions {
  return {
    publicKey: SUITE_PACK_PUBLIC_KEY,
    hostContractVersion: HOST_CONTRACT_VERSION,
    hostVersion: HOST_VERSION,
    hostCapabilities: HOST_CAPABILITIES,
  };
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
  console.info(`[shell] ${packs.length} pack(s) available`);
}

function themeView(): ThemeView {
  const mode = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  return { mode, values: { ...cssVariables(defaultTheme(), mode) } };
}

function openWindow(): void {
  if (spaceStore === null || documents === null) throw new Error("the shell is not ready");
  let created: ShellWindow | null = null;
  created = new ShellWindow({
    packs,
    spaces: spaceStore,
    theme: themeView(),
    onViewClosed: (tabId) => files?.releaseOwner(tabId),
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

  onPack(PACK_IPC.info, (sender): PackInfoView => {
    return {
      id: sender.pack.id,
      name: sender.pack.name,
      containerId: sender.containerId,
      capabilities: sender.pack.capabilities,
    };
  });
  onPack(PACK_IPC.listDocuments, (sender) => {
    // An empty list is a kinder fail-closed answer than `undefined` for the one
    // method whose contract is a list.
    if (!packAllows(sender.pack, "documents")) return [];
    return documents?.list(sender.containerId, sender.packId);
  });
  onPack(PACK_IPC.createDocument, (sender, name) => {
    if (!packAllows(sender.pack, "documents") || typeof name !== "string") return undefined;
    return documents?.create(sender.containerId, sender.packId, name);
  });
  onPack(PACK_IPC.openDocument, (sender, id) => {
    if (!packAllows(sender.pack, "documents") || typeof id !== "string") return undefined;
    return documents?.open(sender.containerId, sender.packId, id);
  });
  onPack(PACK_IPC.saveDocument, (sender, id, bytes) => {
    if (!packAllows(sender.pack, "documents")) return undefined;
    if (typeof id !== "string" || !(bytes instanceof Uint8Array)) return undefined;
    return documents?.save(sender.containerId, sender.packId, id, bytes);
  });
  onPack(PACK_IPC.removeDocument, (sender, id) => {
    if (!packAllows(sender.pack, "documents") || typeof id !== "string") return undefined;
    return documents?.remove(sender.containerId, sender.packId, id);
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
 * Ask for one archive, verify it, install it, and redraw the launcher.
 *
 * The picker is host chrome. A pack never gets a path, and this IPC is not in the
 * pack preload or `PACK_IPC`. The dialog keeps the absolute path; only the bytes
 * cross into `installPackArchive`, and a refusal is a short notice.
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

  try {
    const installed = await installPackArchive(
      bytes,
      join(dataRootFor(), "packs"),
      packTrustOptions(),
    );
    await refreshPacks();
    window?.setPacks(packs);
    const opened = shouldOpenAfterInstall(window?.state().tabs ?? [], installed.id);
    if (opened) {
      await window?.openPack(installed.id).catch((error: unknown) => {
        console.warn(`[shell] could not open ${installed.id} after install`, error);
      });
    }
    window?.setNotice(
      opened
        ? `${installed.name} ${installed.version} installed. The app is open now.`
        : `${installed.name} ${installed.version} installed. Restart Suite to run the new version of the already-open app.`,
    );
  } catch (error) {
    window?.setNotice(installRefusal(error));
  }
}

function installRefusal(error: unknown): string {
  if (error instanceof InstalledPackError) return `The pack was refused: ${error.message}`;
  console.warn("[shell] pack install failed", error);
  return "The pack could not be installed.";
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
