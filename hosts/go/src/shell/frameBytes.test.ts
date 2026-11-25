import {
  createFrameHost,
  type DocumentRecord,
  derivePackKey,
  type FileService,
  FRAME_PROTOCOL,
  type FrameHost,
  MAX_FRAME_BYTES,
  type ModuleHost,
  type PackIdentityService,
  type PackManifest,
  packIdentityView,
  signPackRecord,
  verifyPackRecord,
} from "@suite/go";
import { describe, expect, it } from "vitest";
import { createFrameServer, type FrameServer } from "./frameBridge.js";

/**
 * Document bytes across the frame bridge (#149).
 *
 * A document is moved as a `Uint8Array` in both directions. The proof is a real
 * round trip through the client and server halves: the same bytes come back, no
 * base64 appears on the document path, and an older base64 payload is refused
 * rather than mis-parsed.
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

const encoder = new TextEncoder();

function fileService(): FileService {
  return {
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
  };
}

/** One document in memory, with the host surface the frame bridge calls. */
function host(
  identityService?: PackIdentityService,
): ModuleHost & { readonly bytes: () => Uint8Array | null } {
  let current: Uint8Array | null = null;
  const record = (): DocumentRecord => ({
    id: "doc-1",
    moduleId: "planner",
    name: "Planner.planner",
    title: "Plan",
    savedAt: 1,
    bytes: current ?? new Uint8Array(0),
  });
  return {
    moduleId: "planner",
    documents: {
      list: async () => [],
      create: async () => record(),
      open: async () => (current === null ? null : { ...record(), bytes: new Uint8Array(current) }),
      save: async (_id, input) => {
        current = input.bytes;
        return {
          id: "doc-1",
          moduleId: "planner",
          name: "Planner.planner",
          title: "Plan",
          savedAt: 2,
        };
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
    files: fileService(),
    notifications: {
      permission: async () => "unsupported",
      request: async () => "unsupported",
      schedule: async () => ({ ok: false, permission: "unsupported", reason: "unsupported" }),
      cancel: async () => undefined,
      cancelAll: async () => undefined,
    },
    identity: identityService ?? {
      pack: async () => {
        throw new Error("unused");
      },
      sign: async () => {
        throw new Error("unused");
      },
    },
    theme: { scheme: "light", density: "comfortable", cssVariables: {} },
    bytes: () => current,
  };
}

function manifest(capabilities: PackManifest["capabilities"] = ["documents"]): PackManifest {
  return {
    format: "suite.pack",
    id: "planner",
    name: "Planner",
    version: "1.0.0",
    entry: "index.html",
    contractVersion: 3,
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
  readonly host: ReturnType<typeof host>;
  readonly close: () => void;
}

function harness(
  options: {
    readonly capabilities?: PackManifest["capabilities"];
    readonly identity?: PackIdentityService;
  } = {},
): Harness {
  const frameHost = host(options.identity);
  let server: FrameServer;
  const parent = {
    postMessage(message: {
      readonly id?: number;
      readonly request?: never;
      readonly payload?: string;
      readonly bytes?: Uint8Array;
    }): void {
      void (async () => {
        const request = (message as unknown as { readonly request: never }).request;
        const reply = await server.answer(request, message.payload, message.bytes);
        const frameReply = { ...reply, protocol: FRAME_PROTOCOL, id: message.id };
        queueMicrotask(() => {
          for (const listener of listeners) listener({ data: frameReply });
        });
      })();
    },
  } as unknown as Window;

  server = createFrameServer({
    host: frameHost,
    manifest: () => manifest(options.capabilities),
    files: fileService(),
    theme: () => ({ scheme: "light", density: "comfortable", variables: {} }),
    target: () => null,
  });
  const client = createFrameHost({
    moduleId: "planner",
    parent,
    requestTimeoutMs: 2_000,
  });
  return {
    client,
    server,
    host: frameHost,
    close: () => {
      client.dispose();
      server.dispose();
    },
  };
}

describe("a document across the frame bridge", () => {
  it("round-trips the same bytes without base64", async () => {
    const frame = harness();
    try {
      const created = await frame.client.documents.create({
        moduleId: "planner",
        name: "Planner.planner",
      });
      expect(created.bytes).toBeInstanceOf(Uint8Array);

      const snapshot = encoder.encode("a Loro snapshot is opaque bytes here");
      await frame.client.documents.save(created.id, { bytes: snapshot, title: "Plan" });
      expect(frame.host.bytes()).toBeInstanceOf(Uint8Array);
      expect(frame.host.bytes()).toEqual(snapshot);

      const opened = await frame.client.documents.open(created.id);
      expect(opened?.bytes).toBeInstanceOf(Uint8Array);
      expect(opened?.bytes).toEqual(snapshot);
      expect(new TextDecoder().decode(opened?.bytes)).toBe("a Loro snapshot is opaque bytes here");
    } finally {
      frame.close();
    }
  });

  it("refuses an older pack that still sends documents.save as base64", async () => {
    const frame = harness();
    try {
      const reply = await frame.server.answer(
        { method: "documents.save", id: "doc-1" },
        "c25hcHNob3Q=",
      );
      expect(reply).toMatchObject({ ok: false });
      expect(reply.ok ? "" : reply.message).toContain("no longer accepts base64");
    } finally {
      frame.close();
    }
  });

  it("refuses a payload over the bridge bound", async () => {
    const frame = harness();
    try {
      const reply = await frame.server.answer(
        { method: "documents.save", id: "doc-1" },
        undefined,
        new Uint8Array(MAX_FRAME_BYTES + 1),
      );
      expect(reply).toMatchObject({ ok: false });
      expect(reply.ok ? "" : reply.message).toContain("at most");
    } finally {
      frame.close();
    }
  });
});

describe("identity across the frame bridge", () => {
  // spec: S4.7
  it("gives the pack only its public identity and refuses a relay signature", async () => {
    const device = {
      version: 1 as const,
      secretKey: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
      publicKey: "",
    };
    const key = derivePackKey(device, "suite", "planner");
    const identity: PackIdentityService = {
      pack: () => packIdentityView(key),
      sign: async (purpose, bytes) => signPackRecord(purpose, bytes, key.secretKey),
    };
    const frame = harness({ capabilities: ["documents", "identity.pack"], identity });
    try {
      const view = await frame.client.identity.pack();
      expect(view.publicKey).toBe(key.publicKey);
      expect(JSON.stringify(view)).not.toContain(key.secretKey);

      const bytes = encoder.encode("planner data");
      const signature = await frame.client.identity.sign("pack-data", bytes);
      expect(await verifyPackRecord(bytes, signature, view.publicKey)).toBe(true);

      await expect(frame.client.identity.sign("relay-frame", bytes)).rejects.toThrow(
        /relay frame/u,
      );
    } finally {
      frame.close();
    }
  });

  it("refuses identity calls when the pack did not declare identity.pack", async () => {
    const frame = harness();
    try {
      await expect(frame.client.identity.pack()).rejects.toThrow(/does not declare it/u);
    } finally {
      frame.close();
    }
  });
});
