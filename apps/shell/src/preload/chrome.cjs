/*
 * The chrome bridge.
 *
 * CommonJS because a sandboxed preload cannot use ESM. Channel names are spelled
 * out; `channels.test.ts` fails if they drift from `src/shared.ts`.
 *
 * The page can ask for state and name a tab or pack. It never names a path, a
 * document, or a process.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("suiteShell", {
  state: () => ipcRenderer.invoke("suite:shell:state"),
  openPack: (packId) => ipcRenderer.invoke("suite:shell:open-pack", packId),
  activateTab: (tabId) => ipcRenderer.invoke("suite:shell:activate-tab", tabId),
  closeTab: (tabId) => ipcRenderer.invoke("suite:shell:close-tab", tabId),
  newTab: () => ipcRenderer.invoke("suite:shell:new-tab"),
  reloadTab: (tabId) => ipcRenderer.invoke("suite:shell:reload-tab", tabId),
  openExternal: (url) => ipcRenderer.invoke("suite:shell:open-external", url),
  installPack: () => ipcRenderer.invoke("suite:shell:install-pack"),
  installCataloguePack: (id, version) =>
    ipcRenderer.invoke("suite:shell:install-catalogue-pack", id, version),
  importRevocation: () => ipcRenderer.invoke("suite:shell:import-revocation"),
  rotatePublisher: () => ipcRenderer.invoke("suite:shell:rotate-publisher"),
  uninstallPack: (id, version) => ipcRenderer.invoke("suite:shell:uninstall-pack", id, version),
  addWidget: (registryId) => ipcRenderer.invoke("suite:shell:add-widget", registryId),
  removeWidget: (registryId) => ipcRenderer.invoke("suite:shell:remove-widget", registryId),
  moveWidget: (registryId, direction) =>
    ipcRenderer.invoke("suite:shell:move-widget", registryId, direction),
  resizeWidget: (registryId, size) =>
    ipcRenderer.invoke("suite:shell:resize-widget", registryId, size),
  createScreen: (name) => ipcRenderer.invoke("suite:shell:create-screen", name),
  renameScreen: (screenId, name) =>
    ipcRenderer.invoke("suite:shell:rename-screen", screenId, name),
  duplicateScreen: (screenId) => ipcRenderer.invoke("suite:shell:duplicate-screen", screenId),
  deleteScreen: (screenId, replacementId) =>
    ipcRenderer.invoke("suite:shell:delete-screen", screenId, replacementId),
  setHomeScreen: (screenId) => ipcRenderer.invoke("suite:shell:set-home-screen", screenId),
  openScreen: (screenId) => ipcRenderer.invoke("suite:shell:open-screen", screenId),
  onState: (listener) => {
    ipcRenderer.on("suite:shell:state-changed", (_event, state) => listener(state));
  },
});
