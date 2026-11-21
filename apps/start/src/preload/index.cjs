/*
 * The hub bridge.
 *
 * CommonJS because a sandboxed preload cannot use ESM imports. The channel names
 * are spelled here for the same reason, and `bridge.test.ts` fails if they drift
 * from `src/shared.ts`.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("suiteStart", {
  host: "start",
  version: process.env.SUITE_START_VERSION || "0.0.0",
  listApps: () => ipcRenderer.invoke("suite:start:list"),
  launch: (id) => ipcRenderer.invoke("suite:start:launch", id),
  addApp: () => ipcRenderer.invoke("suite:start:add"),
  removeApp: (id) => ipcRenderer.invoke("suite:start:remove", id),
  // Asks Flatpak to remove a deployment; the confirmation happens in main.
  uninstallApp: (id) => ipcRenderer.invoke("suite:start:uninstall", id),
  // One of "system", "light", "dark". Main validates it before it is applied or stored.
  setTheme: (source) => ipcRenderer.invoke("suite:start:theme", source),
  // An app id, never a path: main resolves it against its own records.
  revealApp: (id) => ipcRenderer.invoke("suite:start:reveal", id),
  // Install from the store or update a deployment, or switch one pre-release
  // install to another tier. Progress arrives on its own channel below.
  installApp: (id, channel) => ipcRenderer.invoke("suite:start:install", id, channel),
  recents: () => ipcRenderer.invoke("suite:start:recents"),
  forgetRecent: (path) => ipcRenderer.invoke("suite:start:forget", path),
  openFile: (path) => ipcRenderer.invoke("suite:start:open-file", path),
  // On demand: the page asks, main fetches, nothing runs on a timer.
  checkUpdates: () => ipcRenderer.invoke("suite:start:check-updates"),
  info: () => ipcRenderer.invoke("suite:start:info"),
  // Suite Sync is a Flatpak deployment: Start installs it from the store and opens
  // it. The app's tray keeps the relay and shows its own address and fingerprint.
  installSync: () => ipcRenderer.invoke("suite:start:sync-install"),
  openSync: () => ipcRenderer.invoke("suite:start:sync-open"),
  // The window outlives no page load, so the listener is never removed.
  onChanged: (listener) => {
    ipcRenderer.on("suite:start:changed", (_event, state) => listener(state));
  },
  // One app's install progress, and only while one is running.
  onInstallProgress: (listener) => {
    ipcRenderer.on("suite:start:install-progress", (_event, installing) => listener(installing));
  },
});
