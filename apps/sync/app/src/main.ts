import { existsSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { desktopCsp, isTrustedSender, resolveProtocolAsset } from "@suite/desktop";
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  net,
  protocol,
  shell,
  Tray,
} from "electron";

import {
  AUTOSTART_APP_ID,
  type AutostartLocation,
  autostartEnabled,
  autostartEntryFor,
  autostartLocation,
  disableAutostart,
  enableAutostart,
} from "./autostart.js";
import { readScope, relayConfigPath, writeScope } from "./config.js";
import { RelayService, type RelayState } from "./relay.js";
import {
  checkScopeChange,
  DEFAULT_SCOPE,
  isRelayScope,
  type RelayScope,
  type RelayTarget,
  resolveRelayTarget,
  scopeOptions,
} from "./scope.js";
import { type RelayView, SYNC_CHANGED, SYNC_IPC } from "./shared.js";
import {
  closeAction,
  relayCode,
  relayLink,
  type ShellState,
  type TrayCommand,
  trayMenu,
} from "./shell.js";

/**
 * Suite Sync.
 *
 * One Electron process with two faces: a tray item that keeps a relay serving, and a small
 * window that says where it is and shows its code. The relay is embedded — `@suite/host` in
 * this process — because the Flatpak carries one runtime, and the store stays the relay's,
 * under the app's own data directory.
 *
 * The window hides rather than closes, so a person who dismisses it still has a relay. Quit
 * is the only way out, and it stops the relay first.
 */

app.setName("Suite Sync");

const APP_SCHEME = "sync";
const APP_HOST = "relay";
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const PAGE_ENTRY = `${APP_ORIGIN}/index.html`;
const CSP = desktopCsp({ wasm: false });

// Before `ready`: a scheme cannot be registered as privileged afterwards.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let relay: RelayService | null = null;
let location: AutostartLocation | null = null;
/** The app's own config, where the chosen reach scope is kept. */
let configPath: string | null = null;
/** The chosen reach. Loaded from the config at launch; `--hidden` uses the same one. */
let scope: RelayScope = DEFAULT_SCOPE;
let quitting = false;
let cleanedUp = false;

/** Launched by the login session: the tray appears, the window does not. */
const startHidden = process.argv.includes("--hidden");

/** `$XDG_DATA_HOME`, which the Flatpak points at the app's own data directory. */
function dataHome(): string {
  return process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
}

/** The relay's store, unless a test or another deployment names one. */
function storeDir(): string {
  return process.env.SUITE_SYNC_STORE?.trim() || join(dataHome(), "suite-sync");
}

/**
 * `SUITE_SYNC_BIND`, the test and host override.
 *
 * It wins over the stored scope: a machine, a smoke test or a unit that names an address gets that
 * address, and the window says the reach is fixed by the environment rather than pretending the
 * selector decides.
 */
function envBind(): string | null {
  const value = process.env.SUITE_SYNC_BIND?.trim();
  return value === undefined || value.length === 0 ? null : value;
}

function bindPort(): number {
  const raw = process.env.SUITE_SYNC_PORT?.trim();
  const parsed = raw === undefined || raw.length === 0 ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 8787;
}

/** What the relay would bind right now, without starting it. */
function currentTarget(): RelayTarget {
  return (
    relay?.target ??
    resolveRelayTarget({ scope, envBind: envBind(), interfaces: networkInterfaces() })
  );
}

function appRoot(): string {
  return app.getAppPath();
}

function autostartEntry(): string {
  return autostartEntryFor({
    appId: AUTOSTART_APP_ID,
    name: "Suite Sync",
    comment: "Your Suite relay, running in the tray",
    env: process.env,
    execPath: process.execPath,
    appRoot: appRoot(),
  });
}

function shellState(state: RelayState): ShellState {
  return {
    running: state.running,
    address: state.address,
    fingerprint: state.fingerprint,
    consoleUrl: state.consoleUrl,
    problem: state.problem,
  };
}

function view(): RelayView {
  const state = relay?.state ?? {
    running: false,
    address: null,
    bind: currentTarget().bind,
    port: bindPort(),
    fingerprint: null,
    consoleUrl: null,
    store: storeDir(),
    scope,
    effective: currentTarget().effective,
    locked: currentTarget().locked,
    problem: currentTarget().problem,
  };
  const shell = shellState(state);
  return {
    ...shell,
    store: state.store,
    bind: state.bind,
    port: state.port,
    scope: state.scope,
    effective: state.effective,
    scopeLocked: state.locked,
    options: scopeOptions({
      scope: state.scope,
      locked: state.locked,
      interfaces: networkInterfaces(),
    }),
    autostart: location !== null && autostartEnabled(location),
    version: app.getVersion(),
    link: relayLink(shell),
    code: relayCode(shell),
  };
}

function iconPath(name: string): string | null {
  const packaged = join(process.resourcesPath, name);
  if (app.isPackaged && existsSync(packaged)) return packaged;
  const source = join(appRoot(), "build", name);
  return existsSync(source) ? source : null;
}

/**
 * Copy text without asking the page for the clipboard.
 *
 * The renderer has no clipboard permission and needs none: it asks main to copy what main
 * already has, and main writes the string it computed for the code.
 */
function copy(text: string | null): boolean {
  if (text === null || text.length === 0) return false;
  clipboard.writeText(text);
  return true;
}

/**
 * Open the console the relay printed.
 *
 * The URL carries a one-time token, so it is never handed to the page: main holds it, checks
 * that it is the loopback HTTP console this feature is for, and opens that.
 */
async function openConsole(): Promise<boolean> {
  const url = view().consoleUrl;
  if (url === null) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1") return false;
  await shell.openExternal(parsed.href);
  return true;
}

async function broadcast(): Promise<void> {
  const current = view();
  if (window !== null && !window.isDestroyed()) {
    window.webContents.send(SYNC_CHANGED, current);
  }
  if (tray !== null) tray.setContextMenu(trayMenuFor(current));
}

function trayMenuFor(current: RelayView): Menu {
  const template: MenuItemConstructorOptions[] = trayMenu(current).map((item) => {
    if (item.kind === "separator") return { type: "separator" };
    if (item.id === null) return { label: item.label, enabled: item.enabled };
    const command = item.id;
    return {
      label: item.label,
      enabled: item.enabled,
      click: () => void runTray(command),
    };
  });
  return Menu.buildFromTemplate(template);
}

async function runTray(command: TrayCommand): Promise<void> {
  switch (command) {
    case "copy-link":
      copy(view().link);
      return;
    case "console":
      await openConsole();
      return;
    case "window":
      showWindow();
      return;
    case "quit":
      app.quit();
  }
}

function createTray(): void {
  const path = iconPath("tray.png");
  if (path === null) throw new Error("no tray icon beside the app");
  // A panel draws a tray icon at roughly this size, and a 512px image would be scaled by the
  // host with no say from the app.
  const icon = nativeImage.createFromPath(path).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip("Suite Sync");
  tray.setContextMenu(trayMenuFor(view()));
  tray.on("click", showWindow);
}

function createWindow(options: { readonly show: boolean }): BrowserWindow {
  const icon = iconPath("icon.png");
  const created = new BrowserWindow({
    width: 460,
    height: 700,
    minWidth: 420,
    minHeight: 560,
    show: false,
    title: "Suite Sync",
    backgroundColor: "#0b0d12",
    ...(icon === null ? {} : { icon }),
    webPreferences: {
      preload: join(appRoot(), "dist", "preload", "index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  created.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedSender(url, [APP_ORIGIN])) event.preventDefault();
  });

  created.on("close", (event) => {
    if (closeAction({ quitting, hasTray: tray !== null }) === "hide") {
      event.preventDefault();
      created.hide();
    }
  });
  created.on("closed", () => {
    if (window === created) window = null;
  });
  created.once("ready-to-show", () => {
    if (options.show) created.show();
  });

  void created.loadURL(PAGE_ENTRY);
  return created;
}

function showWindow(): void {
  if (!app.isReady()) return;
  if (window === null || window.isDestroyed()) {
    window = createWindow({ show: true });
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function onIpc(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedSender(event.senderFrame?.url, [APP_ORIGIN])) return undefined;
    return handler(event, ...args);
  });
}

function registerIpc(): void {
  onIpc(SYNC_IPC.state, () => view());

  onIpc(SYNC_IPC.start, async () => {
    await relay?.start();
    await broadcast();
    return view();
  });

  onIpc(SYNC_IPC.stop, async () => {
    await relay?.stop();
    await broadcast();
    return view();
  });

  /**
   * Choose who can reach the relay.
   *
   * The window shows the warning and asks for confirmation; this is where the choice is enforced.
   * An unacknowledged switch to the network scope is refused here rather than trusted to the page,
   * and a bind fixed by `SUITE_SYNC_BIND` cannot be overridden at all.
   */
  onIpc(SYNC_IPC.setScope, async (_event, next: unknown, acknowledged: unknown) => {
    if (!isRelayScope(next) || relay === null) return view();
    if (relay.target.locked) return view();
    const change = checkScopeChange({
      from: scope,
      to: next,
      acknowledged: acknowledged === true,
    });
    if (!change.ok) return view();
    if (next === scope) return view();

    if (configPath !== null) {
      try {
        writeScope(configPath, next);
      } catch (error) {
        // A choice that cannot be stored would revert on the next launch, which is worse than
        // saying so: keep the running state and report the failure.
        console.warn("[sync] the reach scope could not be saved", error);
        return view();
      }
    }

    await relay.stop();
    scope = next;
    relay.setScope(next);
    await relay.start();
    await broadcast();
    return view();
  });

  onIpc(SYNC_IPC.copyLink, () => copy(view().link));

  onIpc(SYNC_IPC.copyFingerprint, () => copy(view().fingerprint));

  onIpc(SYNC_IPC.console, () => openConsole());

  onIpc(SYNC_IPC.autostart, async (_event, enabled: unknown) => {
    if (typeof enabled !== "boolean" || location === null) return view();
    try {
      if (enabled) enableAutostart(location, autostartEntry());
      else disableAutostart(location);
    } catch (error) {
      // A sandbox without the grant, or a directory the session made read-only: the checkbox
      // goes back to what is on disk rather than claiming a file it could not write.
      console.warn("[sync] the autostart entry could not be changed", error);
    }
    await broadcast();
    return view();
  });

  onIpc(SYNC_IPC.info, () => ({
    app: "sync",
    version: app.getVersion(),
    platform: process.platform,
    sandboxed: (process.env.FLATPAK_ID ?? "").length > 0,
  }));
}

/** Serve the built page, with the policy every Suite page ships. */
function serveWindow(): void {
  const root = join(appRoot(), "dist", "renderer");
  protocol.handle(APP_SCHEME, async (request) => {
    const resolved = resolveProtocolAsset(request.url, root, {
      scheme: APP_SCHEME,
      hosts: [APP_HOST],
    });
    if (!resolved.ok) return new Response("not found", { status: 404 });

    // `net.fetch`, not the global: only this one can read a file URL.
    const response = await net.fetch(pathToFileURL(resolved.file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CSP);
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  });
}

async function shutdown(): Promise<void> {
  quitting = true;
  await relay?.stop().catch(() => undefined);
  cleanedUp = true;
  tray?.destroy();
  tray = null;
  app.quit();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // A login launch that finds the app already running stays hidden: it was asked for the
    // relay, not for a window.
    if (!argv.includes("--hidden")) showWindow();
  });

  app.on("before-quit", (event) => {
    if (cleanedUp) return;
    event.preventDefault();
    void shutdown();
  });

  app.on("window-all-closed", () => {
    // The tray is the way back and the relay is still serving. Without a tray there is
    // neither, so closing the last window is the end of the app.
    if (tray === null) app.quit();
  });

  app.on("activate", () => showWindow());

  void app.whenReady().then(async () => {
    location = autostartLocation({
      appId: AUTOSTART_APP_ID,
      home: app.getPath("home"),
      env: process.env,
    });
    configPath = relayConfigPath({ env: process.env, home: app.getPath("home") });
    // The last choice, including the one a login launch (`--hidden`) inherits.
    scope = readScope(configPath);
    relay = new RelayService({
      storeDir: storeDir(),
      scope,
      envBind: envBind(),
      port: bindPort(),
      version: app.getVersion(),
    });

    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { label: app.name, submenu: [{ role: "quit" }] },
        { role: "windowMenu" },
      ]),
    );

    serveWindow();
    registerIpc();

    window = createWindow({ show: !startHidden });
    try {
      createTray();
    } catch (error) {
      // A desktop without a tray host is unusual, not fatal: the window stays, and closing
      // it quits, which `closeAction` already decides from `tray === null`.
      console.warn("[sync] the tray is unavailable; closing the window will quit", error);
    }

    await relay.start();
    await broadcast();
  });
}
