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
// Keep in sync with MAX_FRAME_BYTES in relayAdapter.ts. The host checks again.
const MAX_RELAY_FRAME_BYTES = 16 * 1024 * 1024;

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

// How many local listeners hold the one host watch. The host watches per tab, so
// the first listener starts it and the last one stops it.
let changeListeners = 0;

// Declared projections (S6.3). The pack binds the entry its manifest names; the
// host calls it with a read-only handle for one document. The map is local, so
// another renderer cannot borrow a handler by naming this pack's entry.
const projections = new Map();

// Command Surface providers (#226). The manifest declares an entry; the pack
// binds it here. The host calls only a declared entry over the separate command
// channel, and neither side puts a document, a path or a handle in the request.
const providers = new Map();

ipcRenderer.on("suite:command:invoke", (_event, request) => {
  const handler = providers.get(request.entry);
  if (typeof handler !== "function") {
    void ipcRenderer.invoke(
      "suite:command:failed",
      request.requestId,
      `no provider is bound to ${request.entry}`,
    );
    return;
  }
  const dispatch = async () => {
    try {
      const value = await handler(request.request);
      await ipcRenderer.invoke("suite:command:done", request.requestId, value);
    } catch (error) {
      await ipcRenderer.invoke(
        "suite:command:failed",
        request.requestId,
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  void dispatch();
});

// Relay connections in this renderer, keyed by the host's token. Frames can
// arrive before `connect()` resolves and before the pack binds a listener, so an
// unknown token is buffered briefly rather than dropped.
const relayConnections = new Map();
const pendingRelayFrames = new Map();
const pendingRelayCloses = new Map();
const MAX_PENDING_RELAY_FRAMES = 64;

ipcRenderer.on("suite:relay:frame", (_event, token, frame) => {
  const connection = relayConnections.get(token);
  if (connection === undefined) {
    const buffered = pendingRelayFrames.get(token) ?? [];
    if (buffered.length < MAX_PENDING_RELAY_FRAMES) buffered.push(frame);
    pendingRelayFrames.set(token, buffered);
    return;
  }
  connection.deliver(frame);
});

ipcRenderer.on("suite:relay:closed", (_event, token, reason) => {
  const connection = relayConnections.get(token);
  if (connection === undefined) {
    pendingRelayCloses.set(token, reason);
    return;
  }
  connection.close(reason);
});

function projectionHandle(request) {
  return {
    id: typeof request.id === "string" ? request.id : "",
    version: typeof request.version === "number" ? request.version : 0,
    read: () => ipcRenderer.invoke("suite:projection:read", request.requestId),
  };
}

ipcRenderer.on("suite:projection:invoke", (_event, request) => {
  const handler = projections.get(request.entry);
  if (typeof handler !== "function") {
    void ipcRenderer.invoke(
      "suite:projection:failed",
      request.requestId,
      `no projection is bound to ${request.entry}`,
    );
    return;
  }
  let pending;
  try {
    pending = handler(projectionHandle(request));
  } catch (error) {
    void ipcRenderer.invoke("suite:projection:failed", request.requestId, String(error));
    return;
  }
  pending
    .then((rows) => ipcRenderer.invoke("suite:projection:done", request.requestId, rows))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      return ipcRenderer.invoke("suite:projection:failed", request.requestId, message);
    });
});

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
    // The host opens the file manager at the document's own location. The pack
    // names the document and gets its summary back, never a path.
    reveal: (id) => ipcRenderer.invoke("suite:documents:reveal", id),
    // What changed while this pack was closed. The host compares its record with
    // the files, so a change missed while the host was off is still reported.
    pendingChanges: () => ipcRenderer.invoke("suite:documents:pending-changes"),
    // While the pack is open the host pushes ids. Nothing is delivered while it
    // is closed, so the pack never polls a directory.
    onChanged: (listener) => {
      if (typeof listener !== "function") {
        throw new Error("a document change listener is a function");
      }
      const handler = (_event, documentIds) => {
        if (Array.isArray(documentIds)) listener(documentIds);
      };
      ipcRenderer.on("suite:documents:changed", handler);
      changeListeners += 1;
      if (changeListeners === 1) void ipcRenderer.invoke("suite:documents:watch", true);
      return () => {
        ipcRenderer.removeListener("suite:documents:changed", handler);
        changeListeners = Math.max(0, changeListeners - 1);
        if (changeListeners === 0) void ipcRenderer.invoke("suite:documents:watch", false);
      };
    },
  },
  // The host's recent list. Another pack's row carries no document id, so a pack
  // cannot enumerate or open a document it does not own (S11.1).
  recents: {
    list: () => ipcRenderer.invoke("suite:recents:list"),
    forget: (documentId) => ipcRenderer.invoke("suite:recents:forget", documentId),
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
    // The person picks a folder and the host copies it under this pack's own
    // root. The result is a relative directory and its files, never a path.
    importFolder: (destination) => ipcRenderer.invoke("suite:files:import-folder", destination),
  },
  setTitle: (title) => ipcRenderer.send("suite:pack:set-title", title),
  openExternal: (url) => ipcRenderer.invoke("suite:pack:open-external", url),
  // The narrow relay capability: the host opens a pinned socket to the relay it
  // supervises and forwards opaque frames. The token is a closure here, never a
  // property of the connection the pack receives, so another tab cannot replay it.
  relay: {
    connect: async (options) => {
      const issued = await ipcRenderer.invoke("suite:relay:connect", options);
      if (!issued || typeof issued.token !== "string") {
        throw new Error("the host refused the relay connection");
      }
      const token = issued.token;
      const frameListeners = new Set();
      const closeListeners = new Set();
      const buffered = pendingRelayFrames.get(token) ?? [];
      pendingRelayFrames.delete(token);
      const connection = {
        buffered,
        closed: null,
        deliver(frame) {
          if (frameListeners.size === 0) {
            if (this.buffered.length < MAX_PENDING_RELAY_FRAMES) this.buffered.push(frame);
            return;
          }
          for (const listener of frameListeners) listener(frame);
        },
        close(reason) {
          if (this.closed !== null) return;
          this.closed = reason;
          relayConnections.delete(token);
          for (const listener of closeListeners) listener(reason);
        },
      };
      relayConnections.set(token, connection);
      const pendingClose = pendingRelayCloses.get(token);
      pendingRelayCloses.delete(token);
      if (pendingClose !== undefined) connection.close(pendingClose);

      return {
        // The host never inspects the frame; this guard only avoids cloning an
        // obviously oversized buffer across IPC.
        send: (frame) => {
          if (!frame || typeof frame.byteLength !== "number") {
            return Promise.reject(new Error("a relay frame is bytes"));
          }
          if (frame.byteLength > MAX_RELAY_FRAME_BYTES) {
            return Promise.reject(new Error("relay frame is too large"));
          }
          return ipcRenderer.invoke("suite:relay:send", token, frame);
        },
        onFrame: (listener) => {
          if (typeof listener !== "function") throw new Error("a frame listener is a function");
          frameListeners.add(listener);
          while (connection.buffered.length > 0) {
            const frame = connection.buffered.shift();
            if (frame !== undefined) listener(frame);
          }
          return () => frameListeners.delete(listener);
        },
        onClose: (listener) => {
          if (typeof listener !== "function") throw new Error("a close listener is a function");
          closeListeners.add(listener);
          if (connection.closed !== null) listener(connection.closed);
          return () => closeListeners.delete(listener);
        },
        close: () =>
          ipcRenderer
            .invoke("suite:relay:close", token)
            .finally(() => connection.close("the pack closed the connection")),
      };
    },
  },
  // A deep link that arrives while this tab is already open. The first launch is
  // read through `launch()`; this is the same context pushed to a live page.
  onDeepLink: (listener) => {
    const handler = (_event, url) => listener(url);
    ipcRenderer.on("suite:pack:deep-link", handler);
    return () => ipcRenderer.removeListener("suite:pack:deep-link", handler);
  },
  // A declared provider entry. The host invokes only an entry the manifest lists
  // under `contributions.providers`; the pack answers with display metadata and
  // an optional suite:// link. No document bytes cross this channel.
  commands: {
    provide: (entry, handler) => {
      if (typeof entry !== "string" || typeof handler !== "function") {
        throw new Error("a provider needs an entry name and a handler");
      }
      providers.set(entry, handler);
      ipcRenderer.send("suite:command:register", entry);
      return () => {
        if (providers.get(entry) === handler) providers.delete(entry);
        ipcRenderer.send("suite:command:unregister", entry);
      };
    },
  },
  // A declared projection entry. The host names the entry from the manifest and
  // supplies a handle scoped to the one document; the pack supplies display rows.
  projections: {
    register: (entry, handler) => {
      if (typeof entry !== "string" || typeof handler !== "function") {
        throw new Error("a projection needs an entry name and a handler");
      }
      projections.set(entry, handler);
      ipcRenderer.send("suite:projection:register", entry);
      return () => {
        if (projections.get(entry) === handler) projections.delete(entry);
        ipcRenderer.send("suite:projection:unregister", entry);
      };
    },
  },
});
