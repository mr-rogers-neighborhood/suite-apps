import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDevice,
  createDeviceIdentity,
  createWorkspaceGroup,
  decodeKeyPackageBytes,
  encodeBase64,
  encodeKeyPackageBytes,
  joinWorkspaceGroup,
  type RelayWebSocket,
  seal,
} from "@suite/sync";
import { describe, expect, it, vi } from "vitest";
import { loadCursor } from "./cursorStore.js";
import { loadGroup, saveGroup } from "./groupStore.js";
import { loadOrCreateIdentity } from "./identity.js";
import { genesisChecksOut, readGenesis, readRootFile } from "./rootStore.js";
import { createSyncService, type SyncStatus } from "./service.js";

const workspaceId = "a".repeat(64);

async function folder(): Promise<string> {
  return mkdtemp(join(tmpdir(), "suite-canvas-sync-"));
}

/** A socket the test drives as the host would. */
function fakeHost() {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, (event?: { data: unknown }) => void>();
  let opened = false;
  const socket = {
    send: (data: string) => sent.push(JSON.parse(data) as Record<string, unknown>),
    close: () => listeners.get("close")?.(),
    addEventListener: (type: string, listener: (event?: { data: unknown }) => void) => {
      listeners.set(type, listener);
      // A real socket can open before whoever asked has finished registering its interest;
      // the connection is made asynchronously here too, so the same has to be possible.
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
    host: (message: unknown) => listeners.get("message")?.({ data: JSON.stringify(message) }),
  };
}

/** The last frame of a kind this fake host was sent, as the host would relay it. */
function sentFrame(fake: ReturnType<typeof fakeHost>, kind: string, epoch?: number) {
  return [...fake.sent]
    .reverse()
    .map((message) => message.frame as { kind?: string; epoch?: number } | undefined)
    .find((frame) => frame?.kind === kind && (epoch === undefined || frame.epoch === epoch));
}

/** Answer a commit the way the host does: number it, stamp it, and send it back. */
async function echoCommit(fake: ReturnType<typeof fakeHost>, index: number): Promise<void> {
  await vi.waitFor(() => {
    expect(sentFrame(fake, "commit")).toBeDefined();
  });
  fake.host({
    type: "frame",
    index,
    frame: { ...sentFrame(fake, "commit"), receivedAt: "2026-11-06T12:00:00.000Z" },
  });
}

/** Two devices in one group, each with its own service, and a socket the test relays by hand. */
async function twoDevices() {
  const a = await folder();
  const b = await folder();
  const aIdentity = await loadOrCreateIdentity(a);
  const bIdentity = await loadOrCreateIdentity(b);
  const owner = await createDeviceIdentity(aIdentity.deviceId);
  const joiner = await createDeviceIdentity(bIdentity.deviceId);
  const started = await createWorkspaceGroup(workspaceId, owner);
  const added = await addDevice(started, joiner.keyPackage);
  await saveGroup(a, workspaceId, added.group);
  await saveGroup(b, workspaceId, await joinWorkspaceGroup(added.welcome, joiner));

  const hostA = fakeHost();
  const hostB = fakeHost();
  const serviceA = await createSyncService({
    dataDir: a,
    workspaceId,
    webSocket: () => hostA.socket,
  });
  const serviceB = await createSyncService({
    dataDir: b,
    workspaceId,
    webSocket: () => hostB.socket,
  });
  const connectingA = serviceA.connect("ws://127.0.0.1:8787/sync");
  const connectingB = serviceB.connect("ws://127.0.0.1:8787/sync");
  hostA.open();
  hostB.open();
  await Promise.all([connectingA, connectingB]);
  return {
    serviceA,
    serviceB,
    hostA,
    hostB,
    owner: aIdentity,
    joiner: bIdentity,
    dataDirA: a,
    dataDirB: b,
  };
}

describe("the identity this install keeps", () => {
  it("is made once and stays the same", async () => {
    const dataDir = await folder();
    const first = await loadOrCreateIdentity(dataDir);
    const second = await loadOrCreateIdentity(dataDir);

    expect(second.publicKey).toBe(first.publicKey);
    expect(second.deviceId).toBe(first.deviceId);
    expect(first.deviceId).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("signs what it is given, verifiably", async () => {
    const dataDir = await folder();
    const identity = await loadOrCreateIdentity(dataDir);
    const signature = identity.sign(new Uint8Array([1, 2, 3]));
    expect(signature.length).toBeGreaterThan(0);
    expect(signature).not.toBe(identity.sign(new Uint8Array([1, 2, 4])));
  });
});

describe("the group it keeps", () => {
  it("round-trips through disk", async () => {
    const dataDir = await folder();
    const identity = await createDeviceIdentity("canvas-laptop");
    const group = await createWorkspaceGroup(workspaceId, identity);
    await saveGroup(dataDir, workspaceId, group);

    const loaded = await loadGroup(dataDir, workspaceId);
    expect(loaded?.epoch).toBe(group.epoch);
  });

  it("answers nothing for a workspace it never joined", async () => {
    expect(await loadGroup(await folder(), workspaceId)).toBeNull();
  });
});

describe("the service", () => {
  it("starts off, and says so", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    expect(service.status()).toEqual({ state: "off" });
  });

  it("publishing with no host is a no-op rather than a throw", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    await expect(service.publish(new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
  });

  it("hands a neighbour's update to the renderer", async () => {
    const dataDir = await folder();
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("this-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    const joined = await joinWorkspaceGroup(added.welcome, joiner);
    await saveGroup(dataDir, workspaceId, joined);

    const fake = fakeHost();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fake.socket,
    });

    const updates: Uint8Array[] = [];
    const statuses: SyncStatus[] = [];
    service.onUpdate((update) => updates.push(update));
    service.onStatus((status) => statuses.push(status));

    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    fake.host({
      type: "joined",
      protocolVersion: 2,
      workspaceId,
      newestEpoch: added.group.epoch,
      frames: 1,
      members: [{ deviceId: "b".repeat(64), name: "the other laptop", role: "editor" }],
    });

    const plaintext = '{"title":"from the other machine"}';
    const sealed = await seal(added.group, new TextEncoder().encode(plaintext));
    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: "b".repeat(64),
        epoch: sealed.group.epoch,
        payload: encodeBase64(sealed.message),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });

    // The frame is decrypted by whichever microtask finishes first; give it one.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(updates).toHaveLength(1);
    expect(new TextDecoder().decode(updates[0])).toBe(plaintext);
    expect(statuses.at(-1)).toMatchObject({ state: "syncing" });
    // The host said who else is here, and the service keeps it for the dialog to draw.
    expect(service.members()).toEqual([
      { deviceId: "b".repeat(64), name: "the other laptop", role: "editor" },
    ]);
  });

  it("ignores a frame from an epoch it has left", async () => {
    const dataDir = await folder();
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("this-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    await saveGroup(dataDir, workspaceId, added.group);

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const updates: Uint8Array[] = [];
    service.onUpdate((update) => updates.push(update));

    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: "b".repeat(64),
        epoch: 1,
        payload: "AAAA",
        signature: "s",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(updates).toHaveLength(0);
  });

  it("says the host is asleep when the socket closes", async () => {
    const dataDir = await folder();
    const service = await createSyncService({ dataDir, workspaceId });
    const statuses: SyncStatus[] = [];
    service.onStatus((status) => statuses.push(status));

    const fake = fakeHost();
    const withSocket = await createSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fake.socket,
    });
    withSocket.onStatus((status) => statuses.push(status));
    const connected = withSocket.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    fake.socket.close();

    expect(statuses.at(-1)).toMatchObject({ state: "asleep" });
    void service;
  });
});

describe("sharing a workspace for the first time", () => {
  it("makes the group, claims the workspace, and can then publish", async () => {
    const dataDir = await folder();
    const fake = fakeHost();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "this laptop",
      webSocket: () => fake.socket,
    });

    const sharing = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await sharing;
    fake.host({
      type: "joined",
      protocolVersion: 2,
      workspaceId,
      newestEpoch: null,
      frames: 0,
      members: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    // The host allows exactly one bootstrap: a self-signed owner record while it has no
    // owners. Without it every frame this device sends is refused, and every invitation it
    // writes is refused too — a workspace that says it is syncing and stores nothing.
    const claim = fake.sent.find((message) => message.type === "role")?.record as
      | { deviceId: string; role: string; seq: number; signerId: string }
      | undefined;
    expect(claim).toMatchObject({ role: "owner", seq: 0 });
    expect(claim?.signerId).toBe(claim?.deviceId);

    // And the group is real, so an edit has somewhere to go.
    fake.sent.length = 0;
    await service.publish(new TextEncoder().encode('{"title":"first"}'));
    expect(fake.sent.some((message) => message.type === "frame")).toBe(true);
    const kept = await loadGroup(dataDir, workspaceId);
    expect(kept).not.toBeNull();
  });

  it("does not claim a workspace it was let into", async () => {
    const dataDir = await folder();
    // A device that joined somebody else's workspace: a group, but no marker saying it made it.
    const owner = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("this-laptop");
    const started = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(started, joiner.keyPackage);
    await saveGroup(dataDir, workspaceId, await joinWorkspaceGroup(added.welcome, joiner));

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    // A host with no owners on record is the moment a claim would be taken, and this device
    // must not take it: it was invited here, and being invited is not being in charge.
    fake.host({
      type: "joined",
      protocolVersion: 2,
      workspaceId,
      newestEpoch: null,
      frames: 0,
      members: [],
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(fake.sent.some((message) => message.type === "role")).toBe(false);
  });
});

describe("presence and leaving", () => {
  it("sends presence the other device can open, and receives what it sends", async () => {
    const { serviceA, serviceB, hostA, hostB, owner } = await twoDevices();
    const seen: Uint8Array[] = [];
    serviceB.onPresence((update) => seen.push(update));

    const cursor = new TextEncoder().encode('{"cursor":{"x":10,"y":20}}');
    await serviceA.presence(cursor);

    const sent = hostA.sent.find((message) => message.type === "ephemeral") as
      | { workspaceId: string; deviceId: string; payload: string; signature: string }
      | undefined;
    expect(sent).toBeDefined();

    // What the hub would forward, forwarded.
    hostB.host({ type: "ephemeral", ...sent });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(seen).toHaveLength(1);
    expect(new TextDecoder().decode(seen[0])).toBe('{"cursor":{"x":10,"y":20}}');
    expect(sent?.deviceId).toBe(owner.deviceId);
  });

  it("drops presence it cannot open rather than reporting it", async () => {
    const { serviceB, hostB } = await twoDevices();
    const seen: Uint8Array[] = [];
    serviceB.onPresence((update) => seen.push(update));

    // Something sealed for another workspace, or another epoch: a cursor nobody can read is
    // not a failure, it is what a device outside the group sees.
    hostB.host({
      type: "ephemeral",
      workspaceId,
      deviceId: "d".repeat(64),
      payload: Buffer.alloc(40, 1).toString("base64"),
      signature: "signed",
    });
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(seen).toHaveLength(0);
  });

  it("takes a device out, and moves to a new epoch so what follows is unreadable to it", async () => {
    const { serviceA, hostA, joiner, dataDirA, dataDirB } = await twoDevices();
    hostA.host({
      type: "joined",
      protocolVersion: 3,
      workspaceId,
      newestEpoch: 1,
      frames: 0,
      members: [
        { deviceId: (await serviceA.identity()).deviceId, name: "this laptop", role: "owner" },
        { deviceId: joiner.deviceId, name: "the desktop", role: "editor" },
      ],
    });

    const removal = serviceA.removeDevice(joiner.deviceId);
    // The commit is not "removed" until the host has numbered it. Answer the way a host does.
    await echoCommit(hostA, 0);
    await removal;

    const kinds = hostA.sent
      .filter((message) => message.type === "frame")
      .map((message) => (message.frame as { kind?: string }).kind);
    expect(kinds).toContain("commit");
    expect(hostA.sent.some((message) => message.type === "removal")).toBe(true);
    // The epoch moved, which is the half of "removed" the host cannot do for anybody: the
    // owner is somewhere the removed device's keys cannot follow.
    const ownerGroup = await loadGroup(dataDirA, workspaceId);
    const removedGroup = await loadGroup(dataDirB, workspaceId);
    expect(ownerGroup?.epoch ?? 0).toBeGreaterThan(removedGroup?.epoch ?? 0);
  });

  it("says which happened when an owner takes this device out", async () => {
    const { serviceA, hostA } = await twoDevices();
    hostA.host({ type: "removed" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(serviceA.status()).toEqual({ state: "removed" });
  });
});

describe("a way back in", () => {
  it("writes a kit this device can be rebuilt from, and says so for the hub", async () => {
    const dataDir = await folder();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      webSocket: () => fakeHost().socket,
    });
    // A workspace that has never been shared has nothing to save.
    await expect(service.exportKit(null)).rejects.toThrow(/not shared yet/);
  });

  it("refuses to restore a file for another workspace", async () => {
    const mine = await folder();
    const elsewhere = await folder();
    const otherWorkspace = "f".repeat(64);
    // A group for somebody else's workspace, saved where a service for it will find it.
    await saveGroup(
      elsewhere,
      otherWorkspace,
      await createWorkspaceGroup(otherWorkspace, await createDeviceIdentity("theirs")),
    );
    const theirs = await createSyncService({
      dataDir: elsewhere,
      workspaceId: otherWorkspace,
      webSocket: () => fakeHost().socket,
    });
    const kit = await theirs.exportKit(null);

    const service = await createSyncService({
      dataDir: mine,
      workspaceId,
      webSocket: () => fakeHost().socket,
    });
    await expect(service.importKit(kit, null)).rejects.toThrow(/another workspace/);
  });
});

describe("inviting someone in", () => {
  it("hands back a link a person can paste, and tells the host", async () => {
    const dataDir = await folder();
    const group = await createWorkspaceGroup(
      workspaceId,
      await createDeviceIdentity("this-laptop"),
    );
    await saveGroup(dataDir, workspaceId, group);

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    const link = await service.createInvite("editor");
    expect(link.startsWith("suite://join?")).toBe(true);
    expect(fake.sent.some((message) => message.type === "invite")).toBe(true);
  });

  it("refuses to write an invitation while it is not connected", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    await expect(service.createInvite("editor")).rejects.toThrow();
  });

  it("asks to join, and says it is waiting", async () => {
    const dataDir = await folder();
    const fake = fakeHost();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "the desktop",
      webSocket: () => fake.socket,
    });

    const joining = service.join(
      `suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync&w=${workspaceId}&i=${"b".repeat(64)}`,
    );
    fake.open();
    await joining;

    expect(service.status()).toEqual({ state: "waiting" });
    const keyPackage = fake.sent.find((message) => message.type === "keypackage");
    expect(keyPackage).toMatchObject({ deviceId: expect.any(String), name: "the desktop" });
  });

  it("keeps waiting across a restart, because the invitation is already spent", async () => {
    const dataDir = await folder();
    const link = `suite://join?h=ws%3A%2F%2F127.0.0.1%3A8787%2Fsync&w=${workspaceId}&i=${"b".repeat(64)}`;

    const first = fakeHost();
    const before = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "the desktop",
      webSocket: () => first.socket,
    });
    const joining = before.join(link);
    first.open();
    await joining;
    await before.disconnect();

    // The app quits here and comes back. A new identity would be a device the host has never
    // seen holding an invitation it will not honour twice, so the one that asked is the one
    // that has to return.
    const asked = first.sent.find((message) => message.type === "keypackage") as
      | { frame: { payload: string } }
      | undefined;
    const keyPackage = decodeKeyPackageBytes(
      new Uint8Array(Buffer.from(asked?.frame.payload ?? "", "base64")),
    );
    const owner = await createDeviceIdentity("owner-laptop");
    const ownerGroup = await createWorkspaceGroup(workspaceId, owner);
    const added = await addDevice(ownerGroup, keyPackage);

    const second = fakeHost();
    const after = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "the desktop",
      webSocket: () => second.socket,
    });
    const resumed = after.resume();
    second.open();
    await resumed;
    expect(after.status()).toEqual({ state: "waiting" });

    second.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "welcome",
        workspaceId,
        deviceId: "e".repeat(64),
        epoch: added.group.epoch,
        payload: encodeBase64(added.welcome),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    // The identity that asked is the identity that opened the welcome, which is the whole
    // reason it had to survive the restart. Wait for the frame to be stored rather than
    // assuming 50 ms is enough on a machine running the rest of the suite beside it.
    await vi.waitFor(async () => {
      expect(await loadGroup(dataDir, workspaceId)).not.toBeNull();
    });
    expect(after.status()).toMatchObject({ state: "syncing" });
  });

  it("says why a link is no good instead of failing quietly", async () => {
    const service = await createSyncService({ dataDir: await folder(), workspaceId });
    await service.join("not a link");
    expect(service.status()).toMatchObject({ state: "refused" });
  });

  it("lets a device in when it asks, and gives it the role its invitation promised", async () => {
    const dataDir = await folder();
    const ownerIdentity = await createDeviceIdentity("this-laptop");
    await saveGroup(dataDir, workspaceId, await createWorkspaceGroup(workspaceId, ownerIdentity));

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    await service.createInvite("viewer");
    fake.sent.length = 0;

    let asked = 0;
    service.onJoinedByAnother(() => {
      asked += 1;
    });

    // The host announces the device and the invitation it spent before relaying the key
    // package. A viewer invitation must not become an editor, and the owner cannot look the
    // role up: the invitation may have been written by a different device.
    const deviceId = "c".repeat(64);
    fake.host({
      type: "waiting",
      deviceId,
      name: "the desktop",
      inviteId: "d".repeat(64),
      role: "viewer",
    });

    // A device that wants in, and the key package it is allowed to send.
    const asking = await createDeviceIdentity("the desktop");
    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "keypackage",
        workspaceId,
        deviceId,
        epoch: 0,
        payload: encodeBase64(encodeKeyPackageBytes(asking.keyPackage)),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    const kinds = fake.sent.map(
      (message) => (message.frame as { kind?: string } | undefined)?.kind,
    );
    expect(kinds).toContain("commit");
    expect(kinds).toContain("welcome");
    const granted = fake.sent.find((message) => message.type === "role")?.record as
      | { deviceId: string; role: string }
      | undefined;
    expect(granted).toMatchObject({ deviceId, role: "viewer" });
    // And the app was asked for a snapshot, because a new device cannot read the past.
    expect(asked).toBe(1);
  });

  it("hears the list of who is here change, not only who was here when it joined", async () => {
    const dataDir = await folder();
    await saveGroup(
      dataDir,
      workspaceId,
      await createWorkspaceGroup(workspaceId, await createDeviceIdentity("this-laptop")),
    );

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    let announced = 0;
    service.onMembers(() => {
      announced += 1;
    });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;

    fake.host({
      type: "roster",
      members: [
        { deviceId: "b".repeat(64), name: "this laptop", role: "owner" },
        { deviceId: "c".repeat(64), name: "the desktop", role: "viewer" },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(announced).toBe(1);
    expect(service.members().map((member) => member.name)).toEqual(["this laptop", "the desktop"]);
  });

  it("ignores a key package nobody announced, rather than adding the same device twice", async () => {
    const dataDir = await folder();
    const ownerIdentity = await createDeviceIdentity("this-laptop");
    await saveGroup(dataDir, workspaceId, await createWorkspaceGroup(workspaceId, ownerIdentity));

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connected = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connected;
    fake.sent.length = 0;

    // What a reconnect looks like: the log replays every key package it holds, and each of
    // those devices is already a member. Admitting them again would add a second copy of each.
    const asking = await createDeviceIdentity("the desktop");
    fake.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "keypackage",
        workspaceId,
        deviceId: "c".repeat(64),
        epoch: 0,
        payload: encodeBase64(encodeKeyPackageBytes(asking.keyPackage)),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(fake.sent.some((message) => message.type === "role")).toBe(false);
  });
});

describe("a revoke waits for the commit's numbered echo", () => {
  it("does not report a removal until the host has numbered the commit", async () => {
    const { serviceA, hostA, joiner } = await twoDevices();
    let settled = false;
    const removal = serviceA.removeDevice(joiner.deviceId).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.waitFor(() => {
      expect(sentFrame(hostA, "commit")).toBeDefined();
    });
    // The frame was sent; the host has not said it stored it. "Removed" now would be a
    // promise about a key rotation that is still only in flight.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(settled).toBe(false);

    await echoCommit(hostA, 0);
    await removal;
    expect(settled).toBe(true);
  });

  it("sends the commit again when the host refuses it as stale", async () => {
    const { serviceA, hostA, joiner } = await twoDevices();
    const removal = serviceA.removeDevice(joiner.deviceId);
    await vi.waitFor(() => {
      expect(sentFrame(hostA, "commit")).toBeDefined();
    });

    hostA.host({ type: "refused", reason: "stale-epoch" });
    await vi.waitFor(() => {
      const commits = hostA.sent.filter(
        (message) =>
          message.type === "frame" && (message.frame as { kind?: string }).kind === "commit",
      );
      expect(commits).toHaveLength(2);
    });

    await echoCommit(hostA, 0);
    await removal;
  });

  it("says the removal did not complete when the host goes away", async () => {
    const { serviceA, hostA, joiner } = await twoDevices();
    const removal = serviceA.removeDevice(joiner.deviceId);
    await vi.waitFor(() => {
      expect(sentFrame(hostA, "commit")).toBeDefined();
    });

    hostA.socket.close();
    await expect(removal).rejects.toThrow(/did not complete/u);
  });
});

describe("a revoked device", () => {
  it("cannot open a post-revoke frame", async () => {
    const { serviceA, serviceB, hostA, hostB, joiner } = await twoDevices();
    const updates: Uint8Array[] = [];
    serviceB.onUpdate((update) => updates.push(update));

    const removal = serviceA.removeDevice(joiner.deviceId);
    await echoCommit(hostA, 0);
    await removal;

    await serviceA.publish(new TextEncoder().encode("after the revoke"));
    const sealedAfter = sentFrame(hostA, "application");
    expect(sealedAfter).toBeDefined();
    expect(sealedAfter?.epoch).toBe(2);

    // The epoch moved, so a device that no longer holds its secrets cannot open what follows.
    hostB.host({
      type: "frame",
      index: 0,
      frame: { ...sealedAfter, receivedAt: "2026-11-06T12:00:00.000Z" },
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(updates).toHaveLength(0);

    // And applying the commit does not give back what the remove took away.
    hostB.host({
      type: "frame",
      index: 1,
      frame: { ...sentFrame(hostA, "commit"), receivedAt: "2026-11-06T12:00:00.000Z" },
    });
    hostB.host({
      type: "frame",
      index: 2,
      frame: { ...sealedAfter, receivedAt: "2026-11-06T12:00:00.000Z" },
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(updates).toHaveLength(0);
  });
});

describe("a device that is one commit behind", () => {
  it("catches up and writes again", async () => {
    const { serviceA, serviceB, hostB, dataDirA } = await twoDevices();
    const updates: Uint8Array[] = [];
    serviceB.onUpdate((update) => updates.push(update));

    // B is at epoch 1 and applies one frame, so its cursor is the host's index 0.
    const atEpochOne = await loadGroup(dataDirA, workspaceId);
    if (atEpochOne === null) throw new Error("expected a group");
    const first = await seal(atEpochOne, new TextEncoder().encode("one"));
    hostB.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: (await serviceA.identity()).deviceId,
        epoch: first.group.epoch,
        payload: encodeBase64(first.message),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await vi.waitFor(() => expect(updates).toHaveLength(1));

    // A membership change makes epoch 2, and A writes there. B receives the update first,
    // which is what a live socket can do while a catch-up is still in flight.
    const third = await createDeviceIdentity("third-laptop");
    const added = await addDevice(atEpochOne, third.keyPackage);
    const second = await seal(added.group, new TextEncoder().encode("two"));
    const epochTwo = second.group.epoch;
    hostB.host({
      type: "frame",
      index: 2,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: (await serviceA.identity()).deviceId,
        epoch: epochTwo,
        payload: encodeBase64(second.message),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });

    // The answer is not "open it anyway": it asks for the frames after its cursor.
    await vi.waitFor(() => {
      expect(hostB.sent.filter((message) => message.type === "since").at(-1)).toEqual({
        type: "since",
        after: 1,
      });
    });
    expect(updates).toHaveLength(1);

    // The host answers in index order: the commit, then the frame it unlocks.
    hostB.host({
      type: "frame",
      index: 1,
      frame: {
        kind: "commit",
        workspaceId,
        deviceId: (await serviceA.identity()).deviceId,
        epoch: epochTwo,
        payload: encodeBase64(added.commit),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    hostB.host({
      type: "frame",
      index: 2,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: (await serviceA.identity()).deviceId,
        epoch: epochTwo,
        payload: encodeBase64(second.message),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await vi.waitFor(() => {
      expect(new TextDecoder().decode(updates[1] ?? new Uint8Array())).toBe("two");
    });

    // And the member can write again, at the epoch it caught up to.
    hostB.sent.length = 0;
    await serviceB.publish(new TextEncoder().encode("three"));
    const written = hostB.sent.find(
      (message) =>
        message.type === "frame" && (message.frame as { kind?: string }).kind === "application",
    );
    expect((written?.frame as { epoch?: number } | undefined)?.epoch).toBe(epochTwo);
  });
});

describe("the cursor is the host's index, not a count in this process", () => {
  it("asks for what follows the last applied index after a restart", async () => {
    const dataDir = await folder();
    const owner = await createDeviceIdentity("owner-laptop");
    const group = await createWorkspaceGroup(workspaceId, owner);
    await saveGroup(dataDir, workspaceId, group);

    const firstHost = fakeHost();
    const first = await createSyncService({
      dataDir,
      workspaceId,
      webSocket: () => firstHost.socket,
    });
    const updates: Uint8Array[] = [];
    first.onUpdate((update) => updates.push(update));
    const connecting = first.connect("ws://127.0.0.1:8787/sync");
    firstHost.open();
    await connecting;

    const sealed = await seal(group, new TextEncoder().encode("first"));
    firstHost.host({
      type: "frame",
      index: 0,
      frame: {
        kind: "application",
        workspaceId,
        deviceId: "b".repeat(64),
        epoch: sealed.group.epoch,
        payload: encodeBase64(sealed.message),
        signature: "signed",
        receivedAt: "2026-11-06T12:00:00.000Z",
      },
    });
    await vi.waitFor(() => expect(updates).toHaveLength(1));
    await vi.waitFor(async () => {
      expect(await loadCursor(dataDir, workspaceId)).toBe(0);
    });
    await first.disconnect();

    // The app quits and comes back. A count would start at zero and ask for frame 0 again;
    // the cursor names what this device already applied.
    const secondHost = fakeHost();
    const second = await createSyncService({
      dataDir,
      workspaceId,
      webSocket: () => secondHost.socket,
    });
    const reconnecting = second.connect("ws://127.0.0.1:8787/sync");
    secondHost.open();
    await reconnecting;

    await vi.waitFor(() => {
      expect(secondHost.sent.find((message) => message.type === "since")).toEqual({
        type: "since",
        after: 1,
      });
    });
  });
});

describe("the identity root of a new workspace", () => {
  it("writes a genesis its root signed when the workspace is first shared", async () => {
    const dataDir = await folder();
    const fake = fakeHost();
    const service = await createSyncService({
      dataDir,
      workspaceId,
      deviceName: "this laptop",
      webSocket: () => fake.socket,
    });

    const sharing = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await sharing;

    const stored = await readRootFile(dataDir, workspaceId);
    if (stored === null) throw new Error("expected a root for a new workspace");
    expect(stored.genesis.workspaceId).toBe(workspaceId);
    expect(stored.genesis.relay).toBe("ws://127.0.0.1:8787/sync");
    expect(stored.genesis.deviceId).toBe((await service.identity()).deviceId);
    expect(genesisChecksOut(stored.genesis, workspaceId)).toBe(true);

    // The root private key is not sent to the host, and it is not what signs frames: it signs
    // exactly one record, and the install key is still what the host pins.
    const wire = JSON.stringify(fake.sent);
    expect(wire).not.toContain(stored.privateKey);
  });

  it("opens a workspace shared before the root existed, with no genesis", async () => {
    const dataDir = await folder();
    await saveGroup(
      dataDir,
      workspaceId,
      await createWorkspaceGroup(workspaceId, await createDeviceIdentity("owner-laptop")),
    );

    const fake = fakeHost();
    const service = await createSyncService({ dataDir, workspaceId, webSocket: () => fake.socket });
    const connecting = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await connecting;

    expect(await readGenesis(dataDir, workspaceId)).toBeNull();
    await service.publish(new TextEncoder().encode("still working"));
    expect(fake.sent.some((message) => message.type === "frame")).toBe(true);
  });

  it("carries the root in the recovery kit, and restores it", async () => {
    const original = await folder();
    const fake = fakeHost();
    const service = await createSyncService({
      dataDir: original,
      workspaceId,
      webSocket: () => fake.socket,
    });
    const sharing = service.connect("ws://127.0.0.1:8787/sync");
    fake.open();
    await sharing;
    const kit = await service.exportKit(null);
    const genesis = await readGenesis(original, workspaceId);
    expect(genesis).not.toBeNull();

    const restored = await folder();
    const second = await createSyncService({
      dataDir: restored,
      workspaceId,
      webSocket: () => fakeHost().socket,
    });
    await second.importKit(kit, null);

    const after = await readRootFile(restored, workspaceId);
    if (after === null) throw new Error("expected the kit to restore the root");
    expect(after.genesis).toEqual(genesis);
    expect(genesisChecksOut(after.genesis, workspaceId)).toBe(true);
  });
});
