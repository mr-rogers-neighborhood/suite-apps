/*
 * The window's bridge.
 *
 * CommonJS because a sandboxed preload cannot use ESM imports. The channel names are
 * spelled here for the same reason, and `bridge.test.ts` fails if they drift from
 * `src/shared.ts`.
 *
 * No method takes a path, a URL or a command: the page asks for the relay's state and for
 * the four things main already knows how to do with it.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("suiteSync", {
  state: () => ipcRenderer.invoke("suite:sync:state"),
  start: () => ipcRenderer.invoke("suite:sync:start"),
  stop: () => ipcRenderer.invoke("suite:sync:stop"),
  // Main copies the link and the fingerprint it computed; the page never handles them.
  copyLink: () => ipcRenderer.invoke("suite:sync:copy-link"),
  copyFingerprint: () => ipcRenderer.invoke("suite:sync:copy-fingerprint"),
  // One of "loopback", "tailnet", "network". `true` is the confirmation the network scope
  // requires; main refuses the change without it, so a hidden page cannot widen the bind.
  setScope: (scope, acknowledged) =>
    ipcRenderer.invoke("suite:sync:scope", scope, acknowledged === true),
  // The console URL carries a one-time token, so the page asks main to open it.
  openConsole: () => ipcRenderer.invoke("suite:sync:console"),
  setAutostart: (enabled) => ipcRenderer.invoke("suite:sync:autostart", enabled === true),
  info: () => ipcRenderer.invoke("suite:sync:info"),
  // The window outlives no page load, so the listener is never removed.
  onChanged: (listener) => {
    ipcRenderer.on("suite:sync:changed", (_event, view) => listener(view));
  },
});
