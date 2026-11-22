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
  // The Home Screen is Start's own document: an id and a size class cross the
  // bridge, never a path. Main writes the file and answers with the new state.
  moveWidget: (id, direction) => ipcRenderer.invoke("suite:start:screen-move", id, direction),
  setWidgetSize: (id, size) => ipcRenderer.invoke("suite:start:screen-size", id, size),
  addWidget: (id) => ipcRenderer.invoke("suite:start:screen-add", id),
  removeWidget: (id) => ipcRenderer.invoke("suite:start:screen-remove", id),
  setWidgetSetting: (id, field, value) =>
    ipcRenderer.invoke("suite:start:screen-setting", id, field, value),
  // The host-owned Screens manager. Each answers with the new Screens state.
  createScreen: (name) => ipcRenderer.invoke("suite:start:screen-create", name),
  renameScreen: (id, name) => ipcRenderer.invoke("suite:start:screen-rename", id, name),
  duplicateScreen: (id) => ipcRenderer.invoke("suite:start:screen-duplicate", id),
  deleteScreen: (id, replacementId) =>
    ipcRenderer.invoke("suite:start:screen-delete", id, replacementId),
  setHomeScreen: (id) => ipcRenderer.invoke("suite:start:screen-home", id),
  openScreen: (id) => ipcRenderer.invoke("suite:start:screen-open", id),
  // The window outlives no page load, so the listener is never removed.
  onChanged: (listener) => {
    ipcRenderer.on("suite:start:changed", (_event, state) => listener(state));
  },
  // One app's install progress, and only while one is running.
  onInstallProgress: (listener) => {
    ipcRenderer.on("suite:start:install-progress", (_event, installing) => listener(installing));
  },
});
