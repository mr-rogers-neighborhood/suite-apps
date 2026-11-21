import { join } from "node:path";

import { app, BrowserWindow } from "electron";

import { registerAppScheme, serveRenderer } from "./protocol";
import { applyContentSecurityPolicy, createMainWindow, pageCsp } from "./window";

app.setName("Suite Help");

// Before `ready`: a scheme cannot be registered as privileged afterwards.
registerAppScheme();

if (process.env.SUITE_HELP_USER_DATA) {
  app.setPath("userData", process.env.SUITE_HELP_USER_DATA);
}

let mainWindow: BrowserWindow | null = null;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => focusWindow());

  app
    .whenReady()
    .then(bootstrap)
    .catch((error: unknown) => {
      console.error("Suite Help failed to start", error);
      app.quit();
    });

  app.on("window-all-closed", () => {
    // No tray and no background work; closing the last window quits.
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow();
  });
}

function bootstrap(): void {
  serveRenderer(
    join(__dirname, "../renderer"),
    pageCsp(Boolean(process.env.ELECTRON_RENDERER_URL)),
  );
  applyContentSecurityPolicy();
  openWindow();
}

function openWindow(): BrowserWindow {
  const window = createMainWindow();
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
  return window;
}

function focusWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow) {
    openWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}
