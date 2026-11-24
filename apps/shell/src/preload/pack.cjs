/*
 * The pack bridge.
 *
 * CommonJS because a sandboxed preload cannot use ESM. The only things a pack
 * can reach are the host's scoped document and file stores, a title, and a link
 * opener. Paths are relative to the pack's own root and are never absolute.
 * There is no Node, and no network API beyond the page's own fetch, which the
 * per-pack CSP and session policy bound.
 *
 * The pack id is the custom-protocol host; the host derives it again from the
 * sender for every call, so a pack cannot impersonate another by editing a value.
 */
const { contextBridge, ipcRenderer } = require("electron");

// Keep in sync with the default in @suite/pack-host. This guard only avoids
// cloning an obviously oversized buffer across IPC; the store enforces the cap.
const MAX_FILE_BYTES = 256 * 1024 * 1024;
// The same kind of guard for the pack's own signing call; the host enforces it.
const MAX_IDENTITY_BYTES = 16 * 1024 * 1024;

// The host is `<container>.<pack>`. The host still derives both from the sender
// for every call; these values are for display, not identity.
const host = location.host;
const separator = host.indexOf(".");
const containerId = separator > 0 ? host.slice(0, separator) : "";
const packId = separator > 0 ? host.slice(separator + 1) : host;

// An external handle's token is a capability, so it stays in this map and never
// becomes a property of the object the pack sees. The pack can call, but it
// cannot read the token out, copy it, or mint a handle of its own.
const issuedTokens = new WeakMap();

function externalHandle(issued) {
  if (issued === null || typeof issued !== "object" || typeof issued.token !== "string") {
    return null;
  }
  const handle = {
    // A name, size and mtime snapshot. No path crosses the bridge.
    info: issued.info,
    read: () => ipcRenderer.invoke("suite:files:read-external", issued.token),
    write: (bytes) => {
      if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength > MAX_FILE_BYTES) {
        return Promise.reject(new Error("file is too large"));
      }
      return ipcRenderer.invoke("suite:files:write-external", issued.token, bytes);
    },
    close: () => ipcRenderer.invoke("suite:files:close-external", issued.token),
  };
  issuedTokens.set(handle, issued.token);
  return handle;
}

contextBridge.exposeInMainWorld("suite", {
  packId,
  containerId,
  info: () => ipcRenderer.invoke("suite:pack:info"),
  // The host stores the context per tab and derives the tab from the sender, so
  // a pack cannot parse a launch out of a URL or name another tab.
  launch: () => ipcRenderer.invoke("suite:pack:launch"),
  // The pack's own key, derived by the host from `(publisher id, pack id)`.
  // Only the public half crosses the bridge; the private half stays in the main
  // process. `sign` is the host signing the pack's own data.
  identity: {
    pack: () => ipcRenderer.invoke("suite:identity:pack"),
    sign: (bytes) => {
      if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength > MAX_IDENTITY_BYTES) {
        return Promise.reject(new Error("identity payload is too large"));
      }
      return ipcRenderer.invoke("suite:identity:sign", bytes);
    },
  },
  documents: {
    list: () => ipcRenderer.invoke("suite:documents:list"),
    create: (name) => ipcRenderer.invoke("suite:documents:create", name),
    open: (id) => ipcRenderer.invoke("suite:documents:open", id),
    save: (id, bytes) => {
      // A guard, not the boundary: the main process checks again. Keep this in
      // sync with MAX_DOCUMENT_BYTES in documents.ts; it keeps a mistaken caller
      // from cloning a huge buffer across IPC first.
      if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength > 64 * 1024 * 1024) {
        return Promise.reject(new Error("document is too large"));
      }
      return ipcRenderer.invoke("suite:documents:save", id, bytes);
    },
    remove: (id) => ipcRenderer.invoke("suite:documents:remove", id),
  },
  files: {
    list: (path) => ipcRenderer.invoke("suite:files:list", path),
    stat: (path) => ipcRenderer.invoke("suite:files:stat", path),
    mkdir: (path) => ipcRenderer.invoke("suite:files:mkdir", path),
    read: (path, options) => ipcRenderer.invoke("suite:files:read", path, options),
    write: (path, bytes, options) => {
      if (!bytes || typeof bytes.byteLength !== "number" || bytes.byteLength > MAX_FILE_BYTES) {
        return Promise.reject(new Error("file is too large"));
      }
      return ipcRenderer.invoke("suite:files:write", path, bytes, options);
    },
    rename: (from, to) => ipcRenderer.invoke("suite:files:rename", from, to),
    remove: (path, options) => ipcRenderer.invoke("suite:files:remove", path, options),
    backup: (path) => ipcRenderer.invoke("suite:files:backup", path),
    // The host keeps the token. The pack gets the `FileLock` shape it expects,
    // and the token never becomes a value the pack can replay against another tab.
    lock: async (path) => {
      const token = await ipcRenderer.invoke("suite:files:lock", path);
      if (typeof token !== "string") throw new Error("the host refused the lock");
      return {
        path,
        release: () => ipcRenderer.invoke("suite:files:unlock", token),
      };
    },
    // The person picks; the host keeps the path. `null` means they cancelled,
    // which is a value, not a failure.
    pickOpen: async (filters) =>
      externalHandle(await ipcRenderer.invoke("suite:files:pick-open", filters)),
    pickSave: async (suggestedName) =>
      externalHandle(await ipcRenderer.invoke("suite:files:pick-save", suggestedName)),
    // Only a handle this preload issued can be imported: the WeakMap lookup
    // fails for a copy or a hand-built object.
    importFile: (handle, name) => {
      const token = issuedTokens.get(handle);
      if (typeof token !== "string") {
        return Promise.reject(new Error("the host refused the file handle"));
      }
      return ipcRenderer.invoke("suite:files:import-external", token, name);
    },
  },
  setTitle: (title) => ipcRenderer.send("suite:pack:set-title", title),
  openExternal: (url) => ipcRenderer.invoke("suite:pack:open-external", url),
});
