import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { suitePaths } from "@suite/contracts";
import type { ReminderEvent } from "@suite/planner-core";
import { app, BrowserWindow, dialog, Notification, type Tray } from "electron";

import { currentChannel } from "./channel";
import { registerIpc } from "./ipc";
import { installMenu } from "./menu";
import { findNewerInstall } from "./newerInstall";
import { workspaceFolder, workspacePaths } from "./paths";
import { registerAppScheme, serveRenderer } from "./protocol";
import { ReminderScheduler } from "./scheduler";
import { createPlannerSyncController, type PlannerSyncController } from "./sync/ipc";
import { createTray } from "./tray";
import { checkForUpdates } from "./updateCheck";
import { applyContentSecurityPolicy, createMainWindow, pageCsp } from "./window";
import {
  adoptChannelWorkspace,
  adoptLegacyWorkspace,
  workspaceFromArgv,
} from "./workspaceLocation";
import { WorkspaceStore } from "./workspaceStore";

app.setName("Suite Planner");

// Before `ready`: a scheme cannot be registered as privileged afterwards.
registerAppScheme();

if (process.env.SUITE_PLANNER_USER_DATA) {
  app.setPath("userData", process.env.SUITE_PLANNER_USER_DATA);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: WorkspaceStore | null = null;
let scheduler: ReminderScheduler | null = null;
let sync: PlannerSyncController | null = null;
let quitting = false;
let cleanedUp = false;

/** Files handed over before a window existed. */
const pendingFiles: string[] = [];

/**
 * A newer Planner installed by Suite Start, if there is one.
 *
 * Start installs into `<applications>/Planner/<version>/` and launches the new binary. Before
 * this check, that binary lost the single-instance lock to whatever was already running and
 * exited, so the old version raised its own window and the update looked like a no-op. Planner
 * is the only app that keeps a tray, so it is the only app where closing the window leaves a
 * process behind to lose that race.
 */
function newerInstall(): { version: string; execPath: string } | null {
  try {
    return findNewerInstall({
      running: app.getVersion(),
      applicationsRoot: suitePaths("Planner", {
        platform: process.platform,
        home: app.getPath("home"),
        xdgDataHome: process.env.XDG_DATA_HOME,
      }).applications,
      appDir: "Planner",
      binaryPrefix: "suite-planner",
    });
  } catch {
    // Telling a person about an update must never be a reason the app fails to start.
    return null;
  }
}

/** The workspace the command line names, whether a path or a link the hub routed here. */
function workspaceFromCommandLine(argv: readonly string[]): string | null {
  return workspaceFromArgv(argv, workspaceFolder(), existsSync);
}

function notifyReminder(reminder: ReminderEvent): void {
  if (Notification.isSupported()) {
    const notification = new Notification({ title: "Suite Planner", body: reminder.title });
    notification.on("click", () => showWindow());
    notification.show();
  }
  mainWindow?.webContents.send("reminder:fired", reminder);
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const file = workspaceFromCommandLine(argv);

    // Someone double-clicked Planner while a newer one was installed. Starting this one would
    // only prove it is out of date, so start the new one instead.
    const newer = newerInstall();
    if (newer !== null) {
      if (file) app.relaunch({ execPath: newer.execPath, args: [file] });
      else app.relaunch({ execPath: newer.execPath });
      app.exit(0);
      return;
    }

    if (file) {
      void openWorkspaceFile(file);
      return;
    }
    showWindow();
  });

  // Delivered before `ready`, so the listener is registered before it.
  app.on("open-file", (event, path) => {
    event.preventDefault();
    if (app.isReady() && store) {
      void openWorkspaceFile(path);
      return;
    }
    pendingFiles.push(path);
  });

  app
    .whenReady()
    .then(() => bootstrap(workspaceFromCommandLine(process.argv)))
    .catch((error: unknown) => {
      console.error("Suite Planner failed to start", error);
      // A version refusal reaches here with a sentence meant for the person: which app wrote the
      // file and which version they need. Quitting without it would be the crash this path exists
      // to avoid.
      dialog.showErrorBox("Suite Planner", error instanceof Error ? error.message : String(error));
      app.quit();
    });

  app.on("before-quit", (event) => {
    if (cleanedUp) return;
    event.preventDefault();
    void shutdown();
  });

  app.on("window-all-closed", () => {
    // The tray keeps the reminder scheduler alive; quitting happens from the tray or the menu.
    // Without a tray there is no way back, so closing the last window quits.
    if (!tray) {
      app.quit();
      return;
    }

    // A tray that outlives an update is a trap: the person believes they closed Planner, the
    // old process keeps running, and the version they installed is the one that never starts.
    // Closing is treated as "done with this copy" whenever a newer one is waiting.
    if (newerInstall() !== null) app.quit();
  });
}

async function bootstrap(initialFile: string | null): Promise<void> {
  serveRenderer(
    join(__dirname, "../renderer"),
    pageCsp(Boolean(process.env.ELECTRON_RENDERER_URL)),
  );
  applyContentSecurityPolicy();
  // A pre-release copies a handed-over stable file before opening it, so the copy is what the
  // store and its backup and temporary file live beside.
  const channel = currentChannel();
  const opened = initialFile
    ? await adoptChannelWorkspace(initialFile, { channel, folder: workspaceFolder(channel) })
    : null;
  const paths = workspacePaths(opened);
  const legacyDir = app.getPath("userData");
  const copied = await adoptLegacyWorkspace(paths, legacyDir);
  if (copied.length > 0) console.info(`Suite Planner: copied the workspace from ${legacyDir}`);

  store = await WorkspaceStore.open(paths);
  sync = createPlannerSyncController({
    getStore: () => store,
    webContents: () => mainWindow?.webContents ?? null,
    publishReplaced: (snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("workspace:replaced", snapshot);
      }
    },
    // What the other person's screen calls this device. "Planner on harbour-laptop" is
    // something a person can weigh; a fingerprint is not.
    deviceName: `Planner on ${hostname()}`,
  });
  registerIpc(() => {
    if (!store) throw new Error("Suite Planner: no workspace is open");
    return store;
  }, sync);

  scheduler = new ReminderScheduler(store, notifyReminder);
  scheduler.start();

  installMenu();
  openWindow();

  // One check per launch, in the background: it writes the report the hub reads.
  // A dev run has no feed, so it does not ask, and a Flatpak launch leaves its
  // bytes to OSTree rather than checking at all.
  void checkForUpdates({
    // Start reads the report beside the app's other data, as `@suite/contracts` defines it.
    // `app.getPath("userData")` is a different directory on Linux, so the report went unseen.
    dataDir: suitePaths("Planner", {
      platform: process.platform,
      home: app.getPath("home"),
      xdgDataHome: process.env.XDG_DATA_HOME,
    }).data,
    version: app.getVersion(),
    channel: "alpha",
    packaged: app.isPackaged,
  }).then(({ error }) => {
    if (error !== null && app.isPackaged) console.warn(`[update] ${error}`);
  });

  try {
    tray = createTray(showWindow, () => app.quit());
  } catch (error) {
    console.warn("Suite Planner: tray is unavailable, closing the window will quit", error);
  }

  app.on("activate", () => showWindow());

  for (const file of pendingFiles.splice(0)) await openWorkspaceFile(file);
}

/**
 * Open a file handed over by the operating system or by the hub.
 *
 * The store is replaced rather than merged: a planner window shows one workspace, and pointing it at
 * another file is the whole request. The previous store is flushed first, so nothing queued is lost.
 */
async function openWorkspaceFile(file: string): Promise<void> {
  if (!store) {
    pendingFiles.push(file);
    return;
  }
  const previous = store;
  let next: WorkspaceStore;
  try {
    const channel = currentChannel();
    const opened = await adoptChannelWorkspace(file, {
      channel,
      folder: workspaceFolder(channel),
    });
    next = await WorkspaceStore.open(workspacePaths(opened));
  } catch (error) {
    // Opening a newer file from the hub must keep the current workspace and say why, not replace
    // the window with a failed open.
    dialog.showErrorBox("Suite Planner", error instanceof Error ? error.message : String(error));
    return;
  }
  await previous.close();
  scheduler?.stop();

  store = next;
  scheduler = new ReminderScheduler(next, notifyReminder);
  scheduler.start();

  // The previous workspace's keys and socket belong to the file that just closed, not to
  // this one. Stop before any window is told what it is now looking at.
  await sync?.workspaceChanged();

  const snapshot = next.snapshot();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("workspace:replaced", snapshot);
  }
  showWindow();
}

function openWindow(): BrowserWindow {
  const window = createMainWindow();
  window.on("close", (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    window.hide();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
  return window;
}

function showWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow) {
    openWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function shutdown(): Promise<void> {
  quitting = true;
  scheduler?.stop();
  await sync?.stop();
  await store?.close();
  cleanedUp = true;
  tray?.destroy();
  app.quit();
}
