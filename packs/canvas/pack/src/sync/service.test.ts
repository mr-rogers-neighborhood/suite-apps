import {
  addDevice,
  createDeviceIdentity,
  createWorkspaceGroup,
  joinWorkspaceGroup,
  RELAY_PROTOCOL_VERSION,
} from "@suite/sync";
import {
  createSyncStoresFor,
  type SyncStoreFiles,
} from "@suite/sync-desktop/relay";
import { describe, expect, it, vi } from "vitest";

import { createPackSyncService } from "./service.js";
import { loadOrCreateIdentity } from "./identity.js";

const workspaceId = "a".repeat(64);
const relayUrl = "ws://127.0.0.1:8787/sync";

/** The pack's files root, in memory. The shared stores own the layout. */
function memoryFiles(): SyncStoreFiles & { readonly map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    async read(path) {
      const bytes = map.get(path);
      return bytes === undefined ? null : new Uint8Array(bytes);
    },
    async write(path, bytes) {
      map.set(path, new Uint8Array(bytes));
    },
    async remove(path) {
      map.delete(path);
    },
  };
}

interface SentMessage {
  readonly type?: string;
  readonly frame?: {
    readonly kind?: string;
    readonly payload?: string;
    readonly epoch?: number;
  };
  readonly [key: string]: unknown;
}

/**
 * The host's relay, as the pack sees it: opaque bytes in, opaque bytes out.
 *
 * `sent` is every message the pack handed over. `emit` is the host delivering one frame.
 */
function fakeRelay() {
  const sent: SentMessage[] = [];
  const connects: Array<{ url: string; certificateSha256?: string }> = [];
  let deliver: ((frame: Uint8Array) => void) | null = null;
  let closed: ((reason: string) => void) | null = null;

  const relay = {
    async connect(options: { url: string; certificateSha256?: string }) {
      connects.push(options);
      return {
        async send(frame: Uint8Array) {
          sent.push(JSON.parse(new TextDecoder().decode(frame)) as SentMessage);
        },
        onFrame(listener: (frame: Uint8Array) => void) {
          deliver = listener;
          return () => {
            deliver = null;
          };
        },
        onClose(listener: (reason: string) => void) {
          closed = listener;
          return () => {
            closed = null;
          };
        },
        async close() {
          closed?.("the pack closed the connection");
        },
      };
    },
  };

  return {
    relay,
    sent,
    connects,
    emit(message: unknown) {
      deliver?.(new TextEncoder().encode(JSON.stringify(message)));
    },
  };
}

function joinedMessage(epoch: number, frames = 0) {
  return {
    type: "joined",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    workspaceId,
    newestEpoch: epoch,
    frames,
    members: [{ deviceId: "b".repeat(64), name: "the other laptop", role: "editor" }],
  };
}

async function waitFor(check: () => boolean): Promise<void> {
  await vi.waitFor(() => expect(check()).toBe(true));
}

/** Two devices in one group, each with a service and a host we relay by hand. */
async function twoDevices() {
  const filesA = memoryFiles();
  const filesB = memoryFiles();
  const identityA = await loadOrCreateIdentity(filesA);
  const identityB = await loadOrCreateIdentity(filesB);
  const owner = await createDeviceIdentity(identityA.deviceId);
  const joiner = await createDeviceIdentity(identityB.deviceId);
  const started = await createWorkspaceGroup(workspaceId, owner);
  const added = await addDevice(started, joiner.keyPackage);
  await createSyncStoresFor(filesA, workspaceId).group.save(added.group);
  await createSyncStoresFor(filesB, workspaceId).group.save(
    await joinWorkspaceGroup(added.welcome, joiner),
  );

  const hostA = fakeRelay();
  const hostB = fakeRelay();
  const serviceA = await createPackSyncService({ files: filesA, workspaceId, relay: hostA.relay });
  const serviceB = await createPackSyncService({ files: filesB, workspaceId, relay: hostB.relay });
  await serviceA.connect(relayUrl);
  await serviceB.connect(relayUrl);
  hostA.emit(joinedMessage(added.group.epoch));
  hostB.emit(joinedMessage(added.group.epoch));
  return { serviceA, serviceB, hostA, hostB, identityA, identityB };
}

describe("the pack's sync service", () => {
  it("keeps its installation key across a reload", async () => {
    const files = memoryFiles();
    const first = await createPackSyncService({ files, workspaceId, relay: null });
    const second = await createPackSyncService({ files, workspaceId, relay: null });

    expect(second.identity().deviceId).toBe(first.identity().deviceId);
    expect(second.identity().publicKey).toBe(first.identity().publicKey);
    expect(second.friendCode()).toBe(first.friendCode());
    // The key is in the pack's own files root, not in a browser store.
    expect([...files.map.keys()]).toContain("sync/identity.json");
  });

  it("refuses without the host's relay capability", async () => {
    const service = await createPackSyncService({
      files: memoryFiles(),
      workspaceId,
      relay: null,
    });

    const status = await service.connect(relayUrl);
    expect(status.state).toBe("refused");
    if (status.state === "refused") {
      expect(status.reason).toMatch(/cannot open a relay connection/u);
    }
  });

  it("connects to the host's relay with the address and pin it was given", async () => {
    const host = fakeRelay();
    const service = await createPackSyncService({
      files: memoryFiles(),
      workspaceId,
      relay: host.relay,
    });

    const status = await service.connect("wss://relay.example.test/sync", "ABCD");
    expect(status.state).toBe("refused");
    // A malformed pin is refused before the host is asked to open anything.
    expect(host.connects).toHaveLength(0);

    await service.connect("wss://relay.example.test/sync", "ab".repeat(32));
    expect(host.connects).toHaveLength(1);
    expect(host.connects[0]).toEqual({
      url: "wss://relay.example.test/sync",
      certificateSha256: "AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB",
    });
    await waitFor(() => host.sent.some((message) => message.type === "join"));
    host.emit(joinedMessage(1));
    await waitFor(() => service.status().state === "syncing");
    expect(service.relayFingerprint()).toBe(
      "AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB:AB",
    );
  });

  it("sends a sealed update and hands a neighbour's update to the document", async () => {
    const { serviceA, serviceB, hostA, hostB } = await twoDevices();
    const updates: Uint8Array[] = [];
    serviceB.onUpdate((update) => updates.push(update));

    const sentinel = new TextEncoder().encode("document bytes that must stay local");
    await serviceA.publish(sentinel);
    await waitFor(() => hostA.sent.some((message) => message.frame?.kind === "application"));

    const frame = hostA.sent.find((message) => message.frame?.kind === "application")?.frame;
    expect(frame?.payload).toBeDefined();
    // The wire carries ciphertext inside a signed header; the document's bytes are not in it.
    expect(JSON.stringify(hostA.sent)).not.toContain("document bytes that must stay local");

    // The host numbers and relays the same frame to the other device.
    hostB.emit({ type: "frame", index: 0, frame: { ...frame, receivedAt: new Date().toISOString() } });
    await waitFor(() => updates.length === 1);
    expect(new TextDecoder().decode(updates[0])).toBe("document bytes that must stay local");
  });
});
