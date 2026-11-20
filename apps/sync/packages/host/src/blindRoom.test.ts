import {
  applyRoleRecord,
  createRoleState,
  type Frame,
  framePayload,
  type RoleState,
  type RoleVerifier,
} from "@suite/sync";
import { describe, expect, it } from "vitest";
import { admitFrame, FrameLog, type FrameVerifier } from "./blindRoom.js";

const workspaceId = "a".repeat(64);
const ownerDevice = "b".repeat(64);
const viewerDevice = "c".repeat(64);
const strangerDevice = "d".repeat(64);
const joinerDevice = "e".repeat(64);

const roleVerifier: RoleVerifier = (_payload, signature, signerId) =>
  signature === `signed-by-${signerId}`;

/** The device key check, stood in for: a signature names the key that made it. */
const frameVerifier: FrameVerifier = (_payload, signature, publicKey) =>
  signature === `signed-by-${publicKey}`;

/** A device's pinned key, or nothing when it never joined. */
const keyOf = (deviceId: string) =>
  deviceId === ownerDevice
    ? "owner-key"
    : deviceId === viewerDevice
      ? "viewer-key"
      : deviceId === joinerDevice
        ? "joiner-key"
        : null;

function roles(): RoleState {
  const seeded = applyRoleRecord(
    createRoleState(workspaceId),
    {
      workspaceId,
      deviceId: ownerDevice,
      role: "owner",
      seq: 0,
      signerId: ownerDevice,
      signature: `signed-by-${ownerDevice}`,
    },
    roleVerifier,
  );
  if (!seeded.ok) throw new Error(seeded.reason);
  const withViewer = applyRoleRecord(
    seeded.state,
    {
      workspaceId,
      deviceId: viewerDevice,
      role: "viewer",
      seq: 0,
      signerId: ownerDevice,
      signature: `signed-by-${ownerDevice}`,
    },
    roleVerifier,
  );
  if (!withViewer.ok) throw new Error(withViewer.reason);
  return withViewer.state;
}

function frame(overrides: Partial<Frame> = {}): Frame {
  return {
    kind: "application",
    workspaceId,
    deviceId: ownerDevice,
    epoch: 1,
    payload: "AAAA",
    signature: `signed-by-owner-key`,
    receivedAt: "2026-11-06T12:00:00.000Z",
    ...overrides,
  };
}

const host = { workspaceId, newestEpoch: null };

describe("the four things a host may refuse", () => {
  it("stores a frame from an authorised device at the current epoch", () => {
    const verdict = admitFrame(frame(), host, roles(), keyOf, frameVerifier);
    expect(verdict.ok).toBe(true);
  });

  it("refuses a frame for another workspace", () => {
    const verdict = admitFrame(
      frame({ workspaceId: "e".repeat(64) }),
      host,
      roles(),
      keyOf,
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "wrong-workspace" });
  });

  it("refuses an epoch it has already passed", () => {
    const verdict = admitFrame(
      frame({ epoch: 2 }),
      { workspaceId, newestEpoch: 5 },
      roles(),
      keyOf,
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "stale-epoch" });
  });

  it("refuses a device with no role record", () => {
    const verdict = admitFrame(
      frame({ deviceId: strangerDevice, signature: "signed-by-stranger-key" }),
      host,
      roles(),
      keyOf,
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("refuses a viewer, before it looks at the signature", () => {
    const verdict = admitFrame(
      frame({ deviceId: viewerDevice, signature: "signed-by-viewer-key" }),
      host,
      roles(),
      keyOf,
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("refuses a signature that does not verify", () => {
    const verdict = admitFrame(frame({ signature: "forged" }), host, roles(), keyOf, frameVerifier);
    expect(verdict).toEqual({ ok: false, reason: "invalid-signature" });
  });
});

describe("the join request is exempt from the epoch floor", () => {
  const laterHost = { workspaceId, newestEpoch: 5 };

  it("admits a key package at epoch 0 into a workspace that has moved on", () => {
    // A device with no group has no epoch. Measuring its key package against the newest
    // stored epoch would refuse every device asking to join an active workspace.
    const verdict = admitFrame(
      frame({
        kind: "keypackage",
        deviceId: joinerDevice,
        epoch: 0,
        signature: "signed-by-joiner-key",
      }),
      laterHost,
      roles(),
      keyOf,
      frameVerifier,
      "2026-11-06T12:00:00.000Z",
      { kindAllowedWithoutRole: "keypackage" },
    );
    expect(verdict.ok).toBe(true);
  });

  it("still asks the invite for the key package, and only for it", () => {
    // The exemption is from the epoch floor, not from the authorisation: without the
    // invite exception a device with no role is refused exactly as before.
    const verdict = admitFrame(
      frame({
        kind: "keypackage",
        deviceId: joinerDevice,
        epoch: 0,
        signature: "signed-by-joiner-key",
      }),
      laterHost,
      roles(),
      keyOf,
      frameVerifier,
    );
    expect(verdict).toEqual({ ok: false, reason: "not-authorized" });
  });

  it("does not exempt any other kind", () => {
    for (const kind of ["application", "commit", "welcome"] as const) {
      const verdict = admitFrame(
        frame({ kind, epoch: 0 }),
        laterHost,
        roles(),
        keyOf,
        frameVerifier,
      );
      expect(verdict).toEqual({ ok: false, reason: "stale-epoch" });
    }
  });
});

describe("the log the host keeps", () => {
  it("has no readable content in anything it stores", () => {
    const log = new FrameLog(workspaceId);
    // The payload a client seals is ciphertext; the host never sees the plaintext form,
    // so the log can hold every field a person would recognise and still hold nothing.
    log.append(frame({ payload: "q83vAAAA+Zg" }));
    log.append(frame({ epoch: 2, payload: "q83vAQAA+Zg" }));

    const stored = JSON.stringify(log.all());
    expect(stored).not.toContain("Q4 planning");
    expect(stored).toContain(workspaceId);
  });

  it("tracks the newest epoch so a later frame can be measured against it", () => {
    const log = new FrameLog(workspaceId);
    expect(log.newestEpoch).toBeNull();
    log.append(frame({ epoch: 3 }));
    log.append(frame({ epoch: 2 }));
    expect(log.newestEpoch).toBe(3);
  });

  it("hands a returning device only what it has not seen", () => {
    const log = new FrameLog(workspaceId);
    log.append(frame({ epoch: 1 }));
    log.append(frame({ epoch: 2 }));
    log.append(frame({ epoch: 3 }));
    expect(log.since(2).map((stored) => stored.index)).toEqual([2]);
    expect(log.since(0)).toHaveLength(3);
  });

  it("drops what a retention window closes", () => {
    const log = new FrameLog(workspaceId);
    log.append(frame({ epoch: 1 }));
    log.append(frame({ epoch: 2 }));
    log.append(frame({ epoch: 3 }));
    expect(log.dropBefore(3)).toBe(2);
    expect(log.all()).toHaveLength(1);
  });

  it("does not renumber a position a client already holds", () => {
    const log = new FrameLog(workspaceId);
    log.append(frame({ epoch: 1 }));
    log.append(frame({ epoch: 2 }));
    log.append(frame({ epoch: 3 }));

    log.dropBefore(3);
    expect(log.oldestIndex).toBe(2);
    expect(log.since(2).map((stored) => stored.index)).toEqual([2]);
    expect(log.append(frame({ epoch: 4 })).index).toBe(3);
  });

  it("reads a cursor older than retention as a gap", () => {
    const log = new FrameLog(workspaceId);
    log.append(frame({ epoch: 1 }));
    log.append(frame({ epoch: 2 }));
    log.append(frame({ epoch: 3 }));

    log.dropBefore(3);
    expect(log.hasGap(0)).toBe(true);
    expect(log.hasGap(1)).toBe(true);
    expect(log.hasGap(2)).toBe(false);
    expect(log.since(0).map((stored) => stored.index)).toEqual([2]);
  });

  it("keeps the next position when the log is restored empty", () => {
    const log = new FrameLog(workspaceId);
    log.restore([], 5);
    expect(log.oldestIndex).toBe(5);
    expect(log.hasGap(4)).toBe(true);
    expect(log.hasGap(5)).toBe(false);
    expect(log.append(frame({ epoch: 6 })).index).toBe(5);
  });

  it("keeps stored positions when it is restored", () => {
    const log = new FrameLog(workspaceId);
    const first = log.append(frame({ epoch: 1 }));
    const second = log.append(frame({ epoch: 2 }));

    const restored = new FrameLog(workspaceId);
    restored.restore([second], 3);
    expect(restored.oldestIndex).toBe(1);
    expect(restored.since(1).map((stored) => stored.index)).toEqual([1]);
    expect(restored.append(frame({ epoch: 3 })).index).toBe(3);
    expect(first.index).toBe(0);
  });
});

describe("the signature covers the header, not only the payload", () => {
  it("changes when the epoch is rewritten", () => {
    const original = framePayload(frame());
    const rewritten = framePayload(frame({ epoch: 9 }));
    expect(Buffer.from(original).equals(Buffer.from(rewritten))).toBe(false);
  });

  it("changes when the sender is rewritten", () => {
    const original = framePayload(frame());
    const rewritten = framePayload(frame({ deviceId: viewerDevice }));
    expect(Buffer.from(original).equals(Buffer.from(rewritten))).toBe(false);
  });
});
