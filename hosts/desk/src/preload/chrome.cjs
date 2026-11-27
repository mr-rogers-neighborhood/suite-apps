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
  tabMenu: (tabId) => ipcRenderer.invoke("suite:shell:tab-menu", tabId),
  newTab: () => ipcRenderer.invoke("suite:shell:new-tab"),
  home: () => ipcRenderer.invoke("suite:shell:home"),
  picker: () => ipcRenderer.invoke("suite:shell:picker"),
  openDocument: (packId, documentId) =>
    ipcRenderer.invoke("suite:shell:open-document", packId, documentId),
  newDocument: (packId) => ipcRenderer.invoke("suite:shell:new-document", packId),
  reloadTab: (tabId) => ipcRenderer.invoke("suite:shell:reload-tab", tabId),
  packMenuAction: (action) => ipcRenderer.invoke("suite:shell:pack-menu-action", action),
  openExternal: (url) => ipcRenderer.invoke("suite:shell:open-external", url),
  installPack: () => ipcRenderer.invoke("suite:shell:install-pack"),
  installCataloguePack: (id, version) =>
    ipcRenderer.invoke("suite:shell:install-catalogue-pack", id, version),
  installFirstRunPack: (id) => ipcRenderer.invoke("suite:shell:install-first-run-pack", id),
  completeFirstRun: () => ipcRenderer.invoke("suite:shell:complete-first-run"),
  setTheme: (choice) => ipcRenderer.invoke("suite:shell:set-theme", choice),
  reaskConsent: (packId, capability) =>
    ipcRenderer.invoke("suite:shell:reask-consent", packId, capability),
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
  renameScreen: (screenId, name) => ipcRenderer.invoke("suite:shell:rename-screen", screenId, name),
  duplicateScreen: (screenId) => ipcRenderer.invoke("suite:shell:duplicate-screen", screenId),
  deleteScreen: (screenId, replacementId) =>
    ipcRenderer.invoke("suite:shell:delete-screen", screenId, replacementId),
  setHomeScreen: (screenId) => ipcRenderer.invoke("suite:shell:set-home-screen", screenId),
  openScreen: (screenId) => ipcRenderer.invoke("suite:shell:open-screen", screenId),
  exportScreen: (screenId) => ipcRenderer.invoke("suite:shell:export-screen", screenId),
  importScreen: () => ipcRenderer.invoke("suite:shell:import-screen"),
  relayStart: () => ipcRenderer.invoke("suite:shell:relay-start"),
  relayStop: () => ipcRenderer.invoke("suite:shell:relay-stop"),
  commandList: (query, mode, packId, scope) =>
    ipcRenderer.invoke("suite:shell:command-list", query, mode, packId, scope),
  commandInvoke: (commandId, scope, args) =>
    ipcRenderer.invoke("suite:shell:command-invoke", commandId, scope, args),
  commandScopes: (packId) => ipcRenderer.invoke("suite:shell:command-scopes", packId),
  commandItems: (packId, scopeId, limit) =>
    ipcRenderer.invoke("suite:shell:command-items", packId, scopeId, limit),
  commandCapture: (packId, scopeId, values) =>
    ipcRenderer.invoke("suite:shell:command-capture", packId, scopeId, values),
  commandOpen: (packId, scopeId, itemId) =>
    ipcRenderer.invoke("suite:shell:command-open", packId, scopeId, itemId),
  commandSearch: (query, scope) => ipcRenderer.invoke("suite:shell:command-search", query, scope),
  commandOpenLink: (link) => ipcRenderer.invoke("suite:shell:command-open-link", link),
  commandClearRecents: () => ipcRenderer.invoke("suite:shell:command-clear-recents"),
  onState: (listener) => {
    ipcRenderer.on("suite:shell:state-changed", (_event, state) => listener(state));
  },
  onPick: (listener) => {
    ipcRenderer.on("suite:shell:pick", () => listener());
  },
  onOpenSettings: (listener) => {
    ipcRenderer.on("suite:shell:open-settings", (_event, section) => listener(section));
  },
});
