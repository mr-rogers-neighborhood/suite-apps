import { generateKeyPairSync, sign } from "node:crypto";
import {
  addDevice,
  applyRoleRecord,
  createDeviceIdentity,
  createRoleState,
  createWorkspaceGroup,
  decodeKeyPackageBytes,
  encodeBase64,
  encodeKeyPackageBytes,
  encodeRelayMessage,
  ephemeralPayload,
  type FrameKind,
  framePayload,
  inviteRecordPayload,
  joinWorkspaceGroup,
  open,
  RELAY_PROTOCOL_VERSION,
  type RelayHostMessage,
  removalRecordPayload,
  roleRecordPayload,
  type SealedFrame,
  seal,
} from "@suite/sync";
import { describe, expect, it } from "vitest";
import { deviceIdFromPublicKey, ed25519Verifier } from "./crypto.js";
import { createSyncServer, HostRegistry } from "./server.js";
import { MemoryHostStore, type StoredFrame } from "./store.js";

const workspaceId = "a".repeat(64);

/** A device with a real Ed25519 key, an id derived from it, and a way to sign. */
function device() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const publicKeyBase64 = raw.toString("base64");
  return {
    deviceId: deviceIdFromPublicKey(publicKeyBase64),
    publicKey: publicKeyBase64,
    sign: (payload: Uint8Array | string) =>
      sign(null, Buffer.from(payload), privateKey).toString("base64"),
  };
}

const owner = device();
const second = device();

/** A client of the relay: sends messages, collects what the host hands back. */
class RelayClient {
  readonly messages: RelayHostMessage[] = [];
  private waiters: Array<() => void> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)) as RelayHostMessage);
      for (const waiter of this.waiters) waiter();
      this.waiters = [];
    });
  }

  static async connect(url: string): Promise<RelayClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("socket error")), { once: true });
    });
    return new RelayClient(socket);
  }

  send(message: unknown): void {
    this.socket.send(encodeRelayMessage(message as Parameters<typeof encodeRelayMessage>[0]));
  }

  async until(
    predicate: (message: RelayHostMessage) => boolean,
    timeoutMs = 2000,
  ): Promise<RelayHostMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`timed out; saw ${JSON.stringify(this.messages)}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  close(): void {
    this.socket.close();
  }
}

async function started(store = new MemoryHostStore()) {
  const server = await createSyncServer({
    registry: new HostRegistry(),
    port: 0,
    store,
    verifyFrame: ed25519Verifier,
    verifyRole: ed25519Verifier,
    now: () => new Date("2026-11-06T12:00:00.000Z"),
  });
  return { server, store };
}

function roleRecord(
  actor: ReturnType<typeof device>,
  target: { deviceId: string },
  role: "owner" | "editor" | "viewer",
  seq = 0,
) {
  const unsigned = {
    workspaceId,
    deviceId: target.deviceId,
    role,
    seq,
    signerId: actor.deviceId,
  } as const;
  return { ...unsigned, signature: actor.sign(roleRecordPayload(unsigned)) };
}

function sealedFrame(
  actor: ReturnType<typeof device>,
  epoch: number,
  payload: string,
  kind: FrameKind = "application",
): SealedFrame {
  const header = {
    kind,
    workspaceId,
    deviceId: actor.deviceId,
    epoch,
    payload,
  };
  return { ...header, signature: actor.sign(framePayload(header)) };
}

/** A frame as a store would already hold it, with the position the host gave it. */
function storedFrame(index: number, epoch: number, receivedAt: string): StoredFrame {
  return { index, frame: { ...sealedFrame(owner, epoch, "AAAA"), receivedAt } };
}

function removalRecord(actor: ReturnType<typeof device>, target: { deviceId: string }) {
  const unsigned = {
    workspaceId,
    deviceId: target.deviceId,
    removedAt: "2026-11-06T12:30:00.000Z",
    signerId: actor.deviceId,
  };
  return { ...unsigned, signature: actor.sign(removalRecordPayload(unsigned)) };
}

/** An invitation an owner writes. The host keeps it; the code is the bearer token. */
function inviteRecord(
  actor: ReturnType<typeof device>,
  inviteId: string,
  role: "editor" | "viewer" = "editor",
) {
  const unsigned = {
    workspaceId,
    inviteId,
    role,
    expiresAt: "2026-11-07T12:00:00.000Z",
    signerId: actor.deviceId,
  };
  return { ...unsigned, signature: actor.sign(inviteRecordPayload(unsigned)) };
}

/** A device asking to join: a key package at epoch 0, which is all it may send. */
function keyPackage(
  actor: ReturnType<typeof device>,
  keyPackageBytes: Uint8Array,
  inviteId: string,
) {
  const header = {
    kind: "keypackage" as const,
    workspaceId,
    deviceId: actor.deviceId,
    epoch: 0,
    payload: encodeBase64(keyPackageBytes),
  };
  return {
    type: "keypackage" as const,
    inviteId,
    deviceId: actor.deviceId,
    publicKey: actor.publicKey,
    name: "a joining device",
    frame: { ...header, signature: actor.sign(framePayload(header)) },
  };
}

/** A presence message: signed like any other, sealed with its own key, and stored like none. */
function presenceMessage(actor: ReturnType<typeof device>, payload = "cHJlc2VuY2U=") {
  const message = { workspaceId, deviceId: actor.deviceId, payload };
  return {
    type: "ephemeral" as const,
    ...message,
    signature: actor.sign(ephemeralPayload(message)),
  };
}

async function joined(client: RelayClient, who: ReturnType<typeof device>) {
  client.send({
    type: "join",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    workspaceId,
    deviceId: who.deviceId,
    publicKey: who.publicKey,
    name: "a test device",
  });
  await client.until((m) => m.type === "joined");
}

describe("two devices through one host", () => {
  it("relays a document update the host cannot read", async () => {
    const { server, store } = await started();
    const ownerDevice = await createDeviceIdentity("owner-laptop");
    const joiner = await createDeviceIdentity("owner-desktop");
    const group = await createWorkspaceGroup(workspaceId, ownerDevice);
    const added = await addDevice(group, joiner.keyPackage);
    const joinedGroup = await joinWorkspaceGroup(added.welcome, joiner);

    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await joined(bob, second);
    bob.send({ type: "role", record: roleRecord(owner, second, "editor") });

    const plaintext = '{"title":"Q4 planning"}';
    const sealed = await seal(added.group, new TextEncoder().encode(plaintext));
    alice.send({
      type: "frame",
      frame: sealedFrame(owner, sealed.group.epoch, encodeBase64(sealed.message)),
    });

    const delivered = await bob.until((m) => m.type === "frame");
    if (delivered.type !== "frame") throw new Error("expected a frame");
    expect(delivered.index).toBe(0);

    const opened = await open(joinedGroup, Buffer.from(delivered.frame.payload, "base64"));
    expect(new TextDecoder().decode(opened.plaintext ?? new Uint8Array())).toBe(plaintext);

    const kept = JSON.stringify(await store.loadFrames(workspaceId));
    expect(kept).not.toContain("Q4 planning");
    expect(kept).toContain(workspaceId);

    alice.close();
    bob.close();
    await server.close();
  });

  it("refuses a viewer's frame and stores nothing", async () => {
    const { server, store } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    alice.send({ type: "role", record: roleRecord(owner, second, "viewer") });

    const bob = await RelayClient.connect(server.url);
    await joined(bob, second);
    bob.send({ type: "frame", frame: sealedFrame(second, 1, "AAAA") });

    expect(await bob.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "not-authorized",
    });
    expect(await store.loadFrames(workspaceId)).toHaveLength(0);

    alice.close();
    bob.close();
    await server.close();
  });

  it("tells a device who else is in the workspace, and what each may do", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");

    const bob = await RelayClient.connect(server.url);
    await joined(bob, second);

    // A device that joins is told who its neighbours are, because every decision a person is
    // asked to make here is a decision about a named device. A device with a pinned key but no
    // role is waiting to be let in rather than here, so it is not on the list.
    const greeting = bob.messages.find((message) => message.type === "joined");
    expect(greeting).toMatchObject({
      members: [{ deviceId: owner.deviceId, name: "a test device", role: "owner" }],
    });

    // And it hears the list change, rather than keeping the one it arrived with: a device
    // that joined an hour ago has just as much need to know it is not alone.
    alice.send({ type: "role", record: roleRecord(owner, second, "editor") });
    const roster = await bob.until((message) => message.type === "roster");
    expect(roster.type === "roster" && roster.members).toHaveLength(2);
    expect(roster.type === "roster" && roster.members.map((member) => member.role).sort()).toEqual([
      "editor",
      "owner",
    ]);

    alice.close();
    bob.close();
    await server.close();
  });

  it("hands a returning device only what it has not seen", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });

    for (const epoch of [1, 2, 3]) {
      alice.send({ type: "frame", frame: sealedFrame(owner, epoch, "AAAA") });
      await alice.until((m) => m.type === "frame" && m.index === epoch - 1);
    }

    alice.messages.length = 0;
    alice.send({ type: "since", after: 2 });
    const replayed = await alice.until((m) => m.type === "frame");
    expect(replayed.type === "frame" && replayed.index).toBe(2);

    alice.close();
    await server.close();
  });
});

describe("a device joining a workspace that already has frames", () => {
  it("a second device joins a workspace that already has frames, and syncs", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");

    // The owner's side of the group, as the app would hold it.
    const ownerGroup = await createWorkspaceGroup(
      workspaceId,
      await createDeviceIdentity("owner-laptop"),
    );

    // Bob asks with an invitation and a key package at epoch 0. The host is empty, so this
    // is the easy case; the next device is the one that matters.
    const bobIdentity = await createDeviceIdentity("bob-laptop");
    const bob = device();
    const bobInvite = "b1".repeat(32);
    alice.send({ type: "invite", record: inviteRecord(owner, bobInvite) });
    await alice.until((m) => m.type === "invited");

    const bobClient = await RelayClient.connect(server.url);
    await joined(bobClient, bob);
    bobClient.send(keyPackage(bob, encodeKeyPackageBytes(bobIdentity.keyPackage), bobInvite));
    const bobAsked = await alice.until((m) => m.type === "frame");
    if (bobAsked.type !== "frame") throw new Error("expected a key package");
    expect(bobAsked.frame.kind).toBe("keypackage");

    // The owner adds the device the host announced. This is the commit that makes epoch 1
    // exist, so everything after it happens in a workspace that has moved on.
    const addedBob = await addDevice(
      ownerGroup,
      decodeKeyPackageBytes(Buffer.from(bobAsked.frame.payload, "base64")),
    );
    alice.send({
      type: "frame",
      frame: sealedFrame(owner, addedBob.group.epoch, encodeBase64(addedBob.commit), "commit"),
    });
    alice.send({
      type: "frame",
      frame: sealedFrame(owner, addedBob.group.epoch, encodeBase64(addedBob.welcome), "welcome"),
    });
    await bobClient.until((m) => m.type === "frame" && m.frame.kind === "welcome");
    const bobWelcome = bobClient.messages.find(
      (m) => m.type === "frame" && m.frame.kind === "welcome",
    );
    if (bobWelcome?.type !== "frame") throw new Error("expected a welcome");
    const bobGroup = await joinWorkspaceGroup(
      Buffer.from(bobWelcome.frame.payload, "base64"),
      bobIdentity,
    );
    expect(bobGroup.epoch).toBe(1);

    // And the workspace now has frames Bob can read: epoch 1 is the newest the host holds.
    const firstUpdate = '{"title":"before the second device"}';
    const sealedFirst = await seal(addedBob.group, new TextEncoder().encode(firstUpdate));
    alice.send({
      type: "frame",
      frame: sealedFrame(owner, sealedFirst.group.epoch, encodeBase64(sealedFirst.message)),
    });
    const bobFirst = await bobClient.until(
      (m) => m.type === "frame" && m.frame.kind === "application",
    );
    if (bobFirst.type !== "frame") throw new Error("expected an application frame");
    const openedFirst = await open(bobGroup, Buffer.from(bobFirst.frame.payload, "base64"));
    expect(new TextDecoder().decode(openedFirst.plaintext ?? new Uint8Array())).toBe(firstUpdate);

    // Carol asks to join now, at epoch 0, into a workspace whose newest epoch is 1. Before
    // S2 the epoch floor refused this and the door never opened.
    const carolIdentity = await createDeviceIdentity("carol-laptop");
    const carol = device();
    const carolInvite = "c1".repeat(32);
    alice.send({ type: "invite", record: inviteRecord(owner, carolInvite) });
    await alice.until((m) => m.type === "invited" && m.inviteId === carolInvite);

    const carolClient = await RelayClient.connect(server.url);
    await joined(carolClient, carol);
    carolClient.send(
      keyPackage(carol, encodeKeyPackageBytes(carolIdentity.keyPackage), carolInvite),
    );
    const carolAsked = await alice.until(
      (m) =>
        m.type === "frame" && m.frame.kind === "keypackage" && m.frame.deviceId === carol.deviceId,
    );
    if (carolAsked.type !== "frame") throw new Error("expected Carol's key package");
    // The answer the joiner is owed: its key package was stored and numbered, not refused.
    expect(carolClient.messages.some((m) => m.type === "refused")).toBe(false);

    const addedCarol = await addDevice(
      addedBob.group,
      decodeKeyPackageBytes(Buffer.from(carolAsked.frame.payload, "base64")),
    );
    alice.send({
      type: "frame",
      frame: sealedFrame(owner, addedCarol.group.epoch, encodeBase64(addedCarol.commit), "commit"),
    });
    alice.send({
      type: "frame",
      frame: sealedFrame(
        owner,
        addedCarol.group.epoch,
        encodeBase64(addedCarol.welcome),
        "welcome",
      ),
    });
    const carolWelcome = await carolClient.until(
      (m) => m.type === "frame" && m.frame.kind === "welcome",
    );
    if (carolWelcome.type !== "frame") throw new Error("expected Carol's welcome");
    const carolGroup = await joinWorkspaceGroup(
      Buffer.from(carolWelcome.frame.payload, "base64"),
      carolIdentity,
    );

    const nextUpdate = '{"title":"after the second device joined"}';
    const sealedNext = await seal(addedCarol.group, new TextEncoder().encode(nextUpdate));
    alice.send({
      type: "frame",
      frame: sealedFrame(owner, sealedNext.group.epoch, encodeBase64(sealedNext.message)),
    });
    const carolFrame = await carolClient.until(
      (m) =>
        m.type === "frame" &&
        m.frame.kind === "application" &&
        m.frame.epoch === addedCarol.group.epoch,
    );
    if (carolFrame.type !== "frame") throw new Error("expected Carol's application frame");
    const openedNext = await open(carolGroup, Buffer.from(carolFrame.frame.payload, "base64"));
    expect(new TextDecoder().decode(openedNext.plaintext ?? new Uint8Array())).toBe(nextUpdate);

    alice.close();
    bobClient.close();
    carolClient.close();
    await server.close();
  });
});

describe("a message the host is asked to forget", () => {
  it("forwards presence to the room and keeps none of it", async () => {
    const { server, store } = await started();
    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await joined(bob, second);
    bob.send({ type: "role", record: roleRecord(owner, second, "editor") });
    await bob.until((m) => m.type === "applied");

    alice.send(presenceMessage(owner));
    const seen = await bob.until((m) => m.type === "ephemeral");
    expect(seen.type === "ephemeral" && seen.payload).toBe("cHJlc2VuY2U=");

    // The whole point: a cursor in the log would be a document that grows every time somebody
    // moves, so the assertion is about absence.
    expect(await store.loadFrames(workspaceId)).toHaveLength(0);

    alice.close();
    bob.close();
    await server.close();
  });

  it("forwards a reader's presence while still refusing its frames", async () => {
    const { server, store } = await started();
    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    alice.send({ type: "role", record: roleRecord(owner, second, "viewer") });
    await joined(bob, second);

    // A reader nobody could see would make collaboration mean collaboration between editors.
    bob.send(presenceMessage(second));
    await alice.until((m) => m.type === "ephemeral");

    bob.send({ type: "frame", frame: sealedFrame(second, 1, "AAAA") });
    expect(await bob.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "not-authorized",
    });
    expect(await store.loadFrames(workspaceId)).toHaveLength(0);

    alice.close();
    bob.close();
    await server.close();
  });

  it("refuses presence from a device with no role at all", async () => {
    const { server } = await started();
    const stranger = device();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");

    const bob = await RelayClient.connect(server.url);
    await joined(bob, stranger);
    bob.send(presenceMessage(stranger));

    expect(await bob.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "not-authorized",
    });

    alice.close();
    bob.close();
    await server.close();
  });
});

describe("taking a device out", () => {
  it("tells the device, drops its socket, and stops counting it", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");
    bob.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: second.deviceId,
      publicKey: second.publicKey,
      name: "the desktop",
    });
    await bob.until((m) => m.type === "joined");
    alice.send({ type: "role", record: roleRecord(owner, second, "editor") });
    await bob.until((m) => m.type === "roster" && m.members.length === 2);

    alice.send({ type: "removal", record: removalRecord(owner, second) });

    // It is told which happened, because a bare close reads as a bad connection.
    expect(await bob.until((m) => m.type === "removed")).toEqual({ type: "removed" });

    alice.messages.length = 0;
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner", 1) });
    const roster = await alice.until((m) => m.type === "roster");
    expect(roster.type === "roster" && roster.members.map((member) => member.deviceId)).toEqual([
      owner.deviceId,
    ]);

    alice.close();
    await server.close();
  });

  it("refuses a removed device's frame, and its join, unless it holds a new invitation", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");
    alice.send({ type: "removal", record: removalRecord(owner, second) });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const returning = await RelayClient.connect(server.url);
    returning.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: second.deviceId,
      publicKey: second.publicKey,
      name: "the desktop",
    });
    expect(await returning.until((m) => m.type === "removed")).toEqual({ type: "removed" });

    returning.close();
    alice.close();
    await server.close();
  });

  it("remembers a removal across a restart", async () => {
    const store = new MemoryHostStore();
    const first = await started(store);
    const alice = await RelayClient.connect(first.server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");
    alice.send({ type: "removal", record: removalRecord(owner, second) });
    await new Promise((resolve) => setTimeout(resolve, 50));
    alice.close();
    await first.server.close();

    const second_ = await started(store);
    const back = await RelayClient.connect(second_.server.url);
    back.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: second.deviceId,
      publicKey: second.publicKey,
      name: "the desktop",
    });
    expect(await back.until((m) => m.type === "removed")).toEqual({ type: "removed" });

    back.close();
    await second_.server.close();
  });
});

describe("what the host remembers across a restart", () => {
  it("reports the oldest position retention still holds, without renumbering it", async () => {
    const store = new MemoryHostStore();
    await store.appendFrame(workspaceId, storedFrame(4, 1, "2026-01-01T00:00:00.000Z"));
    await store.appendFrame(workspaceId, storedFrame(5, 2, "2026-11-05T00:00:00.000Z"));

    const { server } = await started(store);
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);

    const greeting = alice.messages.find((message) => message.type === "joined");
    expect(greeting).toMatchObject({ frames: 1, oldestIndex: 5 });

    // A cursor below the oldest index is a gap: the host still answers with the frame it
    // has, at its stored position, rather than pretending the catch-up was empty.
    alice.messages.length = 0;
    alice.send({ type: "since", after: 4 });
    const replayed = await alice.until((message) => message.type === "frame");
    expect(replayed.type === "frame" && replayed.index).toBe(5);

    alice.close();
    await server.close();
  });

  it("still knows who may write after it is rebuilt from disk", async () => {
    const store = new MemoryHostStore();
    const first = await started(store);
    const alice = await RelayClient.connect(first.server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");
    alice.close();
    await first.server.close();

    // A fresh host over the same store: without replayed roles, this frame is refused.
    const second_ = await started(store);
    const bob = await RelayClient.connect(second_.server.url);
    await joined(bob, owner);
    bob.send({ type: "frame", frame: sealedFrame(owner, 1, "AAAA") });

    const answer = await bob.until((m) => m.type === "frame" || m.type === "refused");
    expect(answer.type).toBe("frame");

    bob.close();
    await second_.server.close();
  });

  it("refuses a device id that arrives with a different key", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);

    const impostor = await RelayClient.connect(server.url);
    impostor.send({
      type: "join",
      protocolVersion: RELAY_PROTOCOL_VERSION,
      workspaceId,
      deviceId: owner.deviceId,
      publicKey: second.publicKey,
      name: "a test device",
    });

    const error = await impostor.until((m) => m.type === "error");
    expect(error.type === "error" && error.message).toContain("pinned");

    alice.close();
    impostor.close();
    await server.close();
  });

  it("refuses a frame signed by a key that is not the pinned one", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });

    const forged: SealedFrame = {
      ...sealedFrame(second, 1, "AAAA"),
      deviceId: owner.deviceId,
    };
    alice.send({ type: "frame", frame: forged });

    expect(await alice.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "invalid-signature",
    });

    alice.close();
    await server.close();
  });
});

describe("the wire", () => {
  it("refuses a version it does not speak", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({
      type: "join",
      protocolVersion: 999,
      workspaceId,
      deviceId: owner.deviceId,
      publicKey: owner.publicKey,
      name: "a test device",
    });
    const error = await alice.until((m) => m.type === "error");
    expect(error.type === "error" && error.code).toBe("protocol-version");
    alice.close();
    await server.close();
  });

  it("refuses a frame from a device that never joined", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    alice.send({ type: "frame", frame: sealedFrame(owner, 1, "AAAA") });
    const error = await alice.until((m) => m.type === "error");
    expect(error.type === "error" && error.code).toBe("not-joined");
    alice.close();
    await server.close();
  });

  it("refuses an invitation that carries a friend envelope, and stores nothing", async () => {
    const { server, store } = await started();
    const alice = await RelayClient.connect(server.url);
    await joined(alice, owner);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });
    await alice.until((m) => m.type === "applied");

    // The envelope travels out of band. A client that spread it into the relay's invite
    // record must be refused, not quietly stored: the relay is not a friend-code directory.
    const record = inviteRecord(owner, "d1".repeat(32));
    alice.send({
      type: "invite",
      record: {
        ...record,
        friend: { to: "49AD1CD0E5G07PAC", nonce: "c".repeat(32) },
      },
    });

    const error = await alice.until((m) => m.type === "error");
    expect(error.type === "error" && error.code).toBe("malformed");
    expect(await store.loadInvites(workspaceId)).toHaveLength(0);

    alice.close();
    await server.close();
  });

  it("tells the sender when its role record is refused, and nobody else", async () => {
    const { server } = await started();
    const alice = await RelayClient.connect(server.url);
    const bob = await RelayClient.connect(server.url);
    await joined(alice, owner);
    await joined(bob, second);
    alice.send({ type: "role", record: roleRecord(owner, owner, "owner") });

    // Bob is not an owner, so his record for himself is refused — to Bob.
    bob.send({ type: "role", record: roleRecord(second, second, "owner") });
    expect(await bob.until((m) => m.type === "refused")).toEqual({
      type: "refused",
      reason: "not-owner",
    });
    expect(alice.messages.some((m) => m.type === "refused")).toBe(false);

    alice.close();
    bob.close();
    await server.close();
  });
});

describe("the role record a host is asked to keep", () => {
  it("applies an owner's record and refuses a second owner claim", () => {
    // `applyRoleRecord` asks "may this signer sign", so the adapter resolves the id to a key.
    const byDeviceId = (payload: string, signature: string, signerId: string) => {
      const key = [owner, second].find((d) => d.deviceId === signerId)?.publicKey;
      return key !== undefined && ed25519Verifier(payload, signature, key);
    };

    const seeded = applyRoleRecord(
      createRoleState(workspaceId),
      roleRecord(owner, owner, "owner"),
      byDeviceId,
    );
    expect(seeded.ok).toBe(true);

    const second_ = applyRoleRecord(
      seeded.ok ? seeded.state : createRoleState(workspaceId),
      roleRecord(second, second, "owner"),
      byDeviceId,
    );
    expect(second_).toEqual({ ok: false, reason: "not-owner" });
  });
});
