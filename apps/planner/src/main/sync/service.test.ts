import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  addDevice,
  createDeviceIdentity,
  createWorkspaceGroup,
  deriveFriendCode,
  encodeBase64,
  type FriendInvite,
  formatInvite,
  friendInvitePayload,
  joinWorkspaceGroup,
  parseInvite,
  type RelayWebSocket,
  seal,
  verifyFriendInvite,
} from "@suite/sync";
import { afterEach, describe, expect, it } from "vitest";

import { loadGroup, saveGroup } from "./groupStore";
import { loadOrCreateIdentity, verifyEd25519 } from "./identity";
import { loadRelayConfig } from "./relayConfig";
import { createPlannerSyncService } from "./service";

const workspaceId = "a".repeat(64);
const cleanups: string[] = [];

async function folder(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "suite-planner-sync-"));
  cleanups.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((directory) => rm(directory, { recursive: true })));
});

/** A socket the test drives as the relay would. */
function fakeRelay() {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, (event?: { data: unknown }) => void>();
  let opened = false;
  const socket = {
    send: (data: string) => sent.push(JSON.parse(data) as Record<string, unknown>),
    close: () => listeners.get("close")?.(),
    addEventListener: (type: string, listener: (event?: { data: unknown }) => void) => {
      listeners.set(type, listener);
      // A real socket can open before whoever asked has finished registering its interest.
      if (type === "open" && opened) queueMicrotask(() => listener());
    },
  } as unknown as RelayWebSocket;

  return {
    socket,
    sent,
    open: () => {
      opened = true;
      listeners.get("open")?.();
    },
    relay: (message: unknown) => listeners.get("message")?.({ data: JSON.stringify(message) }),
  };
}

async function waitFor(check: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Two devices in one group, stored where each service will look for it. */
async function groupForTwo(dataDirA: string, dataDirB: string): Promise<number> {
  const aIdentity = await loadOrCreateIdentity(dataDirA);
  const bIdentity = await loadOrCreateIdentity(dataDirB);
  const owner = await createDeviceIdentity(aIdentity.deviceId);
  const joiner = await createDeviceIdentity(bIdentity.deviceId);
  const started = await createWorkspaceGroup(workspaceId, owner);
  const added = await addDevice(started, joiner.keyPackage);
  await saveGroup(dataDirA, workspaceId, added.group);
  await saveGroup(dataDirB, workspaceId, await joinWorkspaceGroup(added.welcome, joiner));
  return added.group.epoch;
}

describe("the Planner sync service", () => {
  it("starts off and publishing with no relay is a no-op", async () => {
    const service = await createPlannerSyncService({ dataDir: await folder(), workspaceId });

    expect(service.status()).toEqual({ state: "off" });
    await expect(service.publish(new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
    await service.disconnect();
  });

  it("hands a neighbour's update to the authority", async () => {
    const dataDir = await folder();
    const peerDir = await folder();
    const epoch = await groupForTwo(peerDir, dataDir);

    const fake = fakeRelay();
    const service = await createPlannerSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fake.socket,
    });
    const updates: Uint8Array[] = [];
    service.onUpdate((update) => updates.push(update));

    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    fake.relay({
      type: "joined",
      protocolVersion: 4,
      workspaceId,
      newestEpoch: epoch,
      frames: 0,
      members: [],
    });

    const plaintext = '{"title":"from the other machine"}';
    const peerGroup = await loadGroup(peerDir, workspaceId);
    if (peerGroup === null) throw new Error("the peer has no group");
    const sealed = await seal(peerGroup, new TextEncoder().encode(plaintext));
    fake.relay({
      type: "frame",
      index: 0,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: "b".repeat(64),
        epoch: sealed.group.epoch,
        payload: encodeBase64(sealed.message),
        signature: "signed",
        receivedAt: "2026-11-20T12:00:00.000Z",
      },
    });

    await waitFor(() => updates.length === 1, "the peer's update");
    expect(new TextDecoder().decode(updates[0])).toBe(plaintext);
    expect(service.status()).toMatchObject({ state: "syncing" });

    await service.disconnect();
  });

  it("tries the same relay again after the socket closes", async () => {
    const sockets: Array<ReturnType<typeof fakeRelay>> = [];
    const service = await createPlannerSyncService({
      dataDir: await folder(),
      workspaceId,
      reconnectDelayMs: 5,
      webSocket: () => {
        const fake = fakeRelay();
        sockets.push(fake);
        return fake.socket;
      },
    });

    const connected = service.connect("ws://127.0.0.1:8787/sync");
    await waitFor(() => sockets.length === 1, "a socket");
    sockets[0]?.open();
    await connected;
    expect(sockets).toHaveLength(1);

    sockets[0]?.socket.close();

    await waitFor(() => sockets.length === 2, "a second connection");
    sockets[1]?.open();
    await waitFor(() => (sockets[1]?.sent.length ?? 0) > 0, "the second join");
    expect(sockets[1]?.sent[0]).toMatchObject({ type: "join", workspaceId });

    await service.disconnect();
  });
});

describe("friend codes and contacts", () => {
  it("gives this installation a code that matches its public key", async () => {
    const service = await createPlannerSyncService({ dataDir: await folder(), workspaceId });
    const identity = await service.identity();

    expect(service.friendCode()).toBe(deriveFriendCode(identity.publicKey));
    expect(service.contacts()).toEqual([]);
    await service.disconnect();
  });

  it("writes an invitation with a signed envelope and the legacy fields", async () => {
    const dataDir = await folder();
    const fake = fakeRelay();
    const service = await createPlannerSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fake.socket,
    });

    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    const link = await service.createInvite("editor");
    const parsed = parseInvite(link);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.reason);

    // The old fields still name the same invitation, so an older build can join.
    expect(parsed.value).toMatchObject({
      host: "ws://127.0.0.1:8787/sync",
      workspaceId,
    });
    expect(parsed.value.friend).toBeDefined();
    const friend = parsed.value.friend;
    if (friend === undefined) throw new Error("the envelope is missing");

    expect(friend.from.deviceId).toBe((await service.identity()).deviceId);
    expect(friend.relay).toEqual({ url: "ws://127.0.0.1:8787/sync", fingerprint: null });
    expect(friend.workspace).toBe(workspaceId);
    expect(friend.invite).toBe(parsed.value.inviteId);
    const checked = verifyFriendInvite(friend, verifyEd25519);
    expect(checked.ok).toBe(true);

    await service.disconnect();
  });

  it("remembers a contact by code, across a restart", async () => {
    const dataDir = await folder();
    const first = await createPlannerSyncService({ dataDir, workspaceId });
    const publicKey = (await first.identity()).publicKey;

    const added = await first.addContact({
      code: deriveFriendCode(publicKey),
      name: "Ada",
      publicKey,
    });
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: "Ada", publicKey });
    await first.disconnect();

    const second = await createPlannerSyncService({ dataDir, workspaceId });
    expect(second.contacts()).toHaveLength(1);
    expect(second.contacts()[0]?.name).toBe("Ada");

    await second.removeContact(deriveFriendCode(publicKey));
    expect(second.contacts()).toEqual([]);
    await second.disconnect();
  });

  it("refuses a signed invitation from a code this installation has not added", async () => {
    const service = await createPlannerSyncService({ dataDir: await folder(), workspaceId });

    // A device this Planner has never met: the envelope is valid, but the code is not a
    // contact. Adding it is the explicit act, so the join stops with something to do.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
    const publicKeyBase64 = raw.toString("base64");
    const body = {
      from: {
        deviceId: deviceIdOf(raw),
        publicKey: publicKeyBase64,
      },
      relay: { url: "ws://127.0.0.1:8787/sync", fingerprint: null },
      workspace: workspaceId,
      invite: "b".repeat(64),
      expiresAt: "2099-01-01T00:00:00.000Z",
      nonce: "c".repeat(32),
    };
    const friend: FriendInvite = {
      ...body,
      signature: sign(null, Buffer.from(friendInvitePayload(body)), privateKey).toString("base64"),
    };
    const link = formatInvite({
      host: body.relay.url,
      workspaceId,
      inviteId: body.invite,
      friend,
    });

    await expect(service.join(link)).rejects.toThrow(/Add that code in Contacts/u);
    await service.disconnect();
  });
});

function deviceIdOf(rawPublicKey: Buffer): string {
  return createHash("sha256").update(rawPublicKey).digest("hex");
}

describe("pinning a relay certificate", () => {
  it("refuses a wss relay until a fingerprint is entered", async () => {
    const service = await createPlannerSyncService({ dataDir: await folder(), workspaceId });

    const status = await service.connect("wss://192.168.1.20:8787/sync");

    expect(status).toMatchObject({ state: "refused" });
    expect(status.state === "refused" ? status.reason : "").toMatch(/fingerprint is required/u);
  });

  it("keeps the pin in main-process configuration, beside the group", async () => {
    const dataDir = await folder();
    const fake = fakeRelay();
    const service = await createPlannerSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fake.socket,
    });

    const connecting = service.connect(
      "wss://192.168.1.20:8787/sync",
      "ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89:ab:cd:ef:01:23:45:67:89",
    );
    fake.open();
    await connecting;

    const stored = await loadRelayConfig(dataDir, workspaceId);
    expect(stored?.fingerprint).toBe(
      "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89",
    );
  });
});
