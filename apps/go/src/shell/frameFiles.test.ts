import {
  createFrameHost,
  type FileService,
  FRAME_PROTOCOL,
  type FrameHost,
  type ModuleHost,
  type PackManifest,
} from "@suite/go";
import { describe, expect, it } from "vitest";
import type { PackFileBackend } from "../host/packFiles.js";
import { createPackFilesWith } from "../host/packFiles.js";
import { createFrameServer, type FrameServer } from "./frameBridge.js";

/**
 * A pack that uses files, driven over the real frame protocol.
 *
 * The fixture is the proof: a pack calls `host.files.write` and `read`, the
 * request crosses a `postMessage`-shaped transport, the bridge maps the frame to
 * a store built from its own manifest, and the bytes come back. The two refusals
 * that matter most — a path outside the root and another pack's file — are
 * asserted rather than described.
 */
const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

/**
 * Node has no `globalThis.addEventListener`, and the frame client installs its
 * reply listener there. A set of listeners is the whole of what a browser's
 * `MessageEvent` target does for this bridge.
 */
type Listener = (event: { data: unknown }) => void;
const listeners = new Set<Listener>();
(globalThis as unknown as { addEventListener: unknown }).addEventListener = (
  _type: string,
  listener: Listener,
) => listeners.add(listener);
(globalThis as unknown as { removeEventListener: unknown }).removeEventListener = (
  _type: string,
  listener: Listener,
) => listeners.delete(listener);

class MemoryBackend implements PackFileBackend {
  readonly files = new Map<string, Uint8Array>();
  readonly directories = new Set<string>();

  async read(path: string): Promise<Uint8Array> {
    const found = this.files.get(path);
    if (found === undefined) throw new Error("no such file");
    return found;
  }
  async write(path: string, value: Uint8Array): Promise<void> {
    this.files.set(path, value);
    this.directories.delete(path);
  }
  async mkdir(path: string): Promise<void> {
    const parts = path.split("/");
    for (let depth = 1; depth <= parts.length; depth += 1) {
      this.directories.add(parts.slice(0, depth).join("/"));
    }
  }
  async readdir(path: string): Promise<readonly { name: string; type: string }[]> {
    if (!this.directories.has(path)) throw new Error("no such directory");
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const key of [...this.files.keys(), ...this.directories]) {
      if (!key.startsWith(prefix)) continue;
      const name = key.slice(prefix.length).split("/")[0];
      if (name !== undefined && name.length > 0) names.add(name);
    }
    return [...names].map((name) => ({
      name,
      type: this.directories.has(`${prefix}${name}`) ? "directory" : "file",
    }));
  }
  async stat(path: string): Promise<{ type: string; size: number; mtimeMs: number } | null> {
    const file = this.files.get(path);
    if (file !== undefined) return { type: "file", size: file.byteLength, mtimeMs: 1 };
    if (this.directories.has(path)) return { type: "directory", size: 0, mtimeMs: 0 };
    return null;
  }
  async rename(from: string, to: string): Promise<void> {
    const found = this.files.get(from);
    if (found === undefined) throw new Error("no such file");
    this.files.set(to, found);
    this.files.delete(from);
  }
  async copy(from: string, to: string): Promise<void> {
    const found = this.files.get(from);
    if (found === undefined) throw new Error("no such file");
    this.files.set(to, new Uint8Array(found));
  }
  async removeFile(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error("no such file");
  }
  async removeDirectory(path: string, recursive: boolean): Promise<void> {
    const children = [...this.files.keys(), ...this.directories].filter((key) =>
      key.startsWith(`${path}/`),
    );
    if (!recursive && children.length > 0) throw new Error("directory is not empty");
    for (const key of children) {
      this.files.delete(key);
      this.directories.delete(key);
    }
    this.directories.delete(path);
  }
}

function host(): ModuleHost {
  return {
    moduleId: "alpha",
    documents: {
      list: async () => [],
      create: async () => {
        throw new Error("unused");
      },
      open: async () => null,
      save: async () => {
        throw new Error("unused");
      },
      remove: async () => undefined,
    },
    storage: {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
      keys: async () => [],
    },
    navigation: { setTitle: () => undefined, close: () => undefined },
    recents: { remember: () => undefined, forget: () => undefined },
    files: {
      list: async () => [],
      stat: async () => null,
      mkdir: async () => undefined,
      read: async () => new Uint8Array(0),
      write: async () => ({ path: "", name: "", kind: "file", size: 0, mtimeMs: 0 }),
      rename: async () => undefined,
      remove: async () => undefined,
      backup: async () => "",
      lock: async (path) => ({ path, release: async () => undefined }),
      pickOpen: async () => null,
      exportFile: async () => ({ ok: true, uri: "file:///documents/x" }),
      share: async () => ({ ok: false, reason: "cancelled" }),
    },
    notifications: {
      permission: async () => "unsupported",
      request: async () => "unsupported",
      schedule: async () => ({ ok: false, permission: "unsupported", reason: "unsupported" }),
      cancel: async () => undefined,
      cancelAll: async () => undefined,
    },
    theme: { scheme: "light", density: "comfortable", cssVariables: {} },
  };
}

function manifest(id: string, capabilities: PackManifest["capabilities"]): PackManifest {
  return {
    format: "suite.pack",
    id,
    name: id,
    version: "1.0.0",
    entry: "index.html",
    contractVersion: 2,
    independent: true,
    isolation: "isolated",
    capabilities,
    files: [],
    signature: "",
  };
}

interface Harness {
  readonly client: FrameHost;
  readonly server: FrameServer;
  readonly close: () => void;
}

/** A frame and its bridge, wired the way `postMessage` wires them. */
function harness(options: {
  readonly pack: PackManifest | null;
  readonly files: FileService;
  readonly moduleId?: string;
}): Harness {
  let server: FrameServer;
  const parent = {
    postMessage(message: { readonly id?: number; readonly payload?: string }): void {
      // The client posts a request; the bridge answers; the reply arrives as
      // another message. Deferred so the client has registered its waiter first.
      void (async () => {
        const request = (message as unknown as { readonly request: never }).request;
        const reply = await server.answer(request, message.payload);
        const frameReply = { ...reply, protocol: FRAME_PROTOCOL, id: message.id };
        queueMicrotask(() => {
          for (const listener of listeners) listener({ data: frameReply });
        });
      })();
    },
  } as unknown as Window;

  server = createFrameServer({
    host: host(),
    manifest: () => options.pack,
    files: options.files,
    theme: () => ({ scheme: "light", density: "comfortable", variables: {} }),
    target: () => null,
  });

  const client = createFrameHost({
    moduleId: options.moduleId ?? options.pack?.id ?? "unknown",
    parent,
    requestTimeoutMs: 2_000,
  });

  return {
    client,
    server,
    close: () => {
      client.dispose();
      server.dispose();
    },
  };
}

describe("a pack using its own files across the frame bridge", () => {
  it("writes, reads, lists and removes its own file", async () => {
    const files = createPackFilesWith({ packId: "alpha" }, { backend: new MemoryBackend() });
    const frame = harness({ pack: manifest("alpha", ["files"]), files });
    try {
      const entry = await frame.client.files.write("notes/day.txt", bytes("hello"));
      expect(entry).toMatchObject({
        path: "notes/day.txt",
        name: "day.txt",
        kind: "file",
        size: 5,
      });
      expect(text(await frame.client.files.read("notes/day.txt"))).toBe("hello");
      expect((await frame.client.files.list("notes")).map((row) => row.name)).toEqual(["day.txt"]);
      expect((await frame.client.files.stat("notes/day.txt"))?.size).toBe(5);

      await frame.client.files.rename("notes/day.txt", "notes/today.txt");
      expect(text(await frame.client.files.read("notes/today.txt"))).toBe("hello");

      await frame.client.files.remove("notes/today.txt");
      expect(await frame.client.files.stat("notes/today.txt")).toBeNull();
    } finally {
      frame.close();
    }
  });

  it("backs a file up and restores the bytes under the returned name", async () => {
    const files = createPackFilesWith({ packId: "alpha" }, { backend: new MemoryBackend() });
    const frame = harness({ pack: manifest("alpha", ["files"]), files });
    try {
      await frame.client.files.write("notes/day.txt", bytes("first"));
      const backup = await frame.client.files.backup("notes/day.txt");
      expect(backup).toMatch(/^notes\/day\.txt\..+\.bak$/u);
      expect(text(await frame.client.files.read(backup))).toBe("first");
    } finally {
      frame.close();
    }
  });

  it("refuses a path outside the root, and another pack's file", async () => {
    const alpha = createPackFilesWith({ packId: "alpha" }, { backend: new MemoryBackend() });
    const first = harness({ pack: manifest("alpha", ["files"]), files: alpha });
    try {
      await first.client.files.write("notes/day.txt", bytes("alpha only"));
      await expect(first.client.files.read("../beta/secret.txt")).rejects.toThrow(
        /invalid path \(invalid-path\)/u,
      );
      await expect(first.client.files.write("/etc/passwd", bytes("no"))).rejects.toThrow(
        /invalid path \(invalid-path\)/u,
      );
    } finally {
      first.close();
    }

    const beta = createPackFilesWith({ packId: "beta" }, { backend: new MemoryBackend() });
    const second = harness({ pack: manifest("beta", ["files"]), files: beta });
    try {
      expect(await second.client.files.list()).toEqual([]);
      await expect(second.client.files.read("notes/day.txt")).rejects.toThrow(
        /file not found \(not-found\)/u,
      );
    } finally {
      second.close();
    }
  });

  it("holds one writer per path and refuses a second lock", async () => {
    const files = createPackFilesWith({ packId: "alpha" }, { backend: new MemoryBackend() });
    const frame = harness({ pack: manifest("alpha", ["files"]), files });
    try {
      const lock = await frame.client.files.lock("notes/day.txt");
      expect(lock.path).toBe("notes/day.txt");
      await expect(frame.client.files.lock("notes/day.txt")).rejects.toThrow(
        /file is locked \(locked\)/u,
      );

      await lock.release();
      const again = await frame.client.files.lock("notes/day.txt");
      await again.release();
    } finally {
      frame.close();
    }
  });

  it("refuses every file request when the pack did not declare files", async () => {
    const files = createPackFilesWith({ packId: "alpha" }, { backend: new MemoryBackend() });
    const frame = harness({ pack: manifest("alpha", ["documents"]), files });
    try {
      await expect(frame.client.files.list()).rejects.toThrow(/does not declare it/u);
      await expect(frame.client.files.write("a.txt", bytes("no"))).rejects.toThrow(
        /does not declare it/u,
      );
    } finally {
      frame.close();
    }
  });

  it("refuses file requests when the frame has no pack identity", async () => {
    const files = createPackFilesWith({ packId: "alpha" }, { backend: new MemoryBackend() });
    const frame = harness({ pack: null, files });
    try {
      await expect(frame.client.files.list()).rejects.toThrow(/no installed pack identity/u);
    } finally {
      frame.close();
    }
  });
});
