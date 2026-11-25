import type { AppCommand, PlannerBridge, ReminderEvent, SyncInfo } from "@suite/planner-core";
import { contextBridge, ipcRenderer } from "electron";

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const bridge: PlannerBridge = {
  loadSnapshot: () => ipcRenderer.invoke("workspace:snapshot"),
  wasCreated: (): Promise<boolean> => ipcRenderer.invoke("workspace:created"),
  commit: (update) => ipcRenderer.invoke("workspace:commit", update),
  onWorkspaceReplaced: (listener) =>
    subscribe<Uint8Array>("workspace:replaced", (snapshot) => listener(snapshot)),
  onReminder: (listener) => subscribe<ReminderEvent>("reminder:fired", listener),
  onCommand: (listener) => subscribe<AppCommand>("ui:command", listener),
  exportWorkspace: () => ipcRenderer.invoke("workspace:export"),
  importWorkspace: () => ipcRenderer.invoke("workspace:import"),
  info: () => ipcRenderer.invoke("workspace:info"),
  platform: () => ipcRenderer.invoke("app:platform"),
  // Sync crosses this bridge as state and links, never as a key or a socket. Main applies a
  // frame to the authority and tells the page through the same replacement path as an
  // import, so the renderer has no second way to change the document.
  syncStatus: () => ipcRenderer.invoke("sync:status"),
  syncEnable: (url, fingerprint) => ipcRenderer.invoke("sync:enable", url, fingerprint),
  syncDisable: () => ipcRenderer.invoke("sync:disable"),
  syncInvite: (role, to) => ipcRenderer.invoke("sync:invite", role, to),
  syncJoin: (link, fingerprint) => ipcRenderer.invoke("sync:join", link, fingerprint),
  syncAddContact: (input) => ipcRenderer.invoke("sync:contact:add", input),
  syncRemoveContact: (code) => ipcRenderer.invoke("sync:contact:remove", code),
  onSyncChanged: (listener) => subscribe<SyncInfo>("sync:changed", listener),
};

contextBridge.exposeInMainWorld("suitePlanner", bridge);
