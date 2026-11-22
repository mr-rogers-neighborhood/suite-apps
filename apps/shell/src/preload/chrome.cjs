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
  onState: (listener) => {
    ipcRenderer.on("suite:shell:state-changed", (_event, state) => listener(state));
  },
});
