import type { FileHandle, FilesService, RelayConnection } from "@suite/pack-runtime";
import { createDeviceIdentity, createWorkspaceGroup, RELAY_PROTOCOL_VERSION } from "@suite/sync";
import { createSyncStoresFor } from "@suite/sync-desktop/relay";
import { describe, expect, it, vi } from "vitest";

import { createPackSyncAdapter } from "./adapter.js";
import { packStoreFiles } from "./files.js";

const workspaceId = "a".repeat(64);
const relayUrl = "ws://127.0.0.1:8787/sync";

/** The pack's `files` root, and the two handles a recovery errand needs. */
function fakeFiles(): FilesService & {
  readonly map: Map<string, Uint8Array>;
  readonly openQueue: Array<Uint8Array | null>;
  readonly saved: Array<{ name: string; bytes: Uint8Array }>;
} {
  const map = new Map<string, Uint8Array>();
  const openQueue: Array<Uint8Array | null> = [];
  const saved: Array<{ name: string; bytes: Uint8Array }> = [];

  const handleOf = (name: string, bytes: Uint8Array): FileHandle => {
    let contents = new Uint8Array(bytes);
    return {
      get info() {
        return { name, size: contents.byteLength, mtimeMs: 1_000 };
      },
      async read() {
        return new Uint8Array(contents);
      },
      async write(next) {
        contents = new Uint8Array(next);
      },
      async close() {},
    };
  };

  return {
    map,
    openQueue,
    saved,
    async list() {
      return [...map.entries()].map(([path, bytes]) => ({
        path,
        name: path.split("/").at(-1) ?? path,
        kind: "file" as const,
        size: bytes.byteLength,
        mtimeMs: 1_000,
      }));
    },
    async stat(path) {
      const bytes = map.get(path);
      return bytes === undefined
        ? null
        : {
            path,
            name: path.split("/").at(-1) ?? path,
            kind: "file" as const,
            size: bytes.byteLength,
            mtimeMs: 1_000,
          };
    },
    async mkdir() {},
    async read(path) {
      const bytes = map.get(path);
      if (bytes === undefined) throw new Error("not-found");
      return new Uint8Array(bytes);
    },
    async write(path, bytes) {
      map.set(path, new Uint8Array(bytes));
      return {
        path,
        name: path.split("/").at(-1) ?? path,
        kind: "file" as const,
        size: bytes.byteLength,
        mtimeMs: 1_000,
      };
    },
    async rename(from, to) {
      const bytes = map.get(from);
      if (bytes === undefined) throw new Error("not-found");
      map.delete(from);
      map.set(to, bytes);
    },
    async remove(path) {
      map.delete(path);
    },
    async backup(path) {
      return path;
    },
    async lock(path) {
      return { path, release: async () => undefined };
    },
    async pickOpen() {
      const next = openQueue.shift();
      return next === undefined || next === null ? null : handleOf("way-back-in.json", next);
    },
    async pickSave(suggestedName) {
      let contents = new Uint8Array();
      return {
        get info() {
          return { name: suggestedName, size: contents.byteLength, mtimeMs: 1_000 };
        },
        async read() {
          return new Uint8Array(contents);
        },
        async write(bytes: Uint8Array) {
          contents = new Uint8Array(bytes);
          saved.push({ name: suggestedName, bytes: contents });
        },
        async close() {},
      } satisfies FileHandle;
    },
    async importFile() {
      throw new Error("no import");
    },
    async importFolder() {
      return null;
    },
  };
}

function fakeRelay() {
  const connects: Array<{ url: string; certificateSha256?: string }> = [];
  const sent: string[] = [];
  let deliver: ((frame: Uint8Array) => void) | null = null;

  const relay = {
    async connect(options: { url: string; certificateSha256?: string }) {
      connects.push(options);
      return {
        async send(frame: Uint8Array) {
          sent.push(new TextDecoder().decode(frame));
        },
        onFrame(listener: (frame: Uint8Array) => void) {
          deliver = listener;
          return () => undefined;
        },
        onClose() {
          return () => undefined;
        },
        async close() {},
      } satisfies RelayConnection;
    },
  };

  return {
    relay,
    connects,
    sent,
    emit(message: unknown) {
      deliver?.(new TextEncoder().encode(JSON.stringify(message)));
    },
  };
}

async function seedGroup(files: FilesService) {
  const identity = await createDeviceIdentity("this laptop");
  const group = await createWorkspaceGroup(workspaceId, identity);
  await createSyncStoresFor(packStoreFiles(files), workspaceId).group.save(group);
  return { identity, group };
}

function joined(epoch: number) {
  return {
    type: "joined",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    workspaceId,
    newestEpoch: epoch,
    frames: 0,
    members: [{ deviceId: "b".repeat(64), name: "the other laptop", role: "editor" }],
  };
}

describe("the pack's sync adapter", () => {
  it("refuses without the relay capability, and says why", async () => {
    const adapter = createPackSyncAdapter({
      files: fakeFiles(),
      relay: undefined,
      workspaceId: () => workspaceId,
    });

    expect(adapter.enabled).toBe(false);
    const info = await adapter.enable(relayUrl);
    expect(info.status.state).toBe("off");
    expect(info.problem).toMatch(/relay connection/u);
    expect(await adapter.invite("editor")).toBeNull();
  });

  it("keeps the same device and friend code across a reload", async () => {
    const files = fakeFiles();
    const first = createPackSyncAdapter({
      files,
      relay: fakeRelay().relay,
      workspaceId: () => workspaceId,
    });
    const before = await first.status();
    await first.dispose();

    const second = createPackSyncAdapter({
      files,
      relay: fakeRelay().relay,
      workspaceId: () => workspaceId,
    });
    const after = await second.status();

    expect(after.deviceId).toBe(before.deviceId);
    expect(after.friendCode).toBe(before.friendCode);
    expect(files.map.has("sync/identity.json")).toBe(true);
    expect(files.map.has("sync/contacts.json")).toBe(false);
  });

  it("gives the host an address and a pin, never a document", async () => {
    const files = fakeFiles();
    const { group } = await seedGroup(files);
    const host = fakeRelay();
    const adapter = createPackSyncAdapter({
      files,
      relay: host.relay,
      workspaceId: () => workspaceId,
    });

    const info = await adapter.enable(relayUrl);
    expect(info.status.state).toBe("connecting");
    await vi.waitFor(() => expect(host.sent.length).toBeGreaterThan(0));
    host.emit(joined(group.epoch));
    await vi.waitFor(async () => expect((await adapter.status()).status.state).toBe("syncing"));

    const sentinel = "a card body that must never reach the host relay";
    await adapter.publish(Array.from(new TextEncoder().encode(sentinel)));
    await vi.waitFor(() => expect(host.sent.some((line) => line.includes('"kind":"application"'))).toBe(true));

    // The request is exactly the two values the capability accepts.
    expect(host.connects).toEqual([{ url: relayUrl }]);
    expect(Object.keys(host.connects[0] ?? {}).sort()).toEqual(["url"]);
    // The frame is sealed: the bytes and the workspace's document never appear on the wire.
    expect(host.sent.join("\n")).not.toContain(sentinel);
  });
});
