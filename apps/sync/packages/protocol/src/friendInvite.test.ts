import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { formatFingerprint } from "./fingerprint.js";
import {
  deviceIdFromPublicKey,
  type FriendInvite,
  friendInvitePayload,
  verifyFriendInvite,
} from "./friendInvite.js";
import { formatInvite, parseInvite } from "./inviteLink.js";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PIN = formatFingerprint("cd".repeat(32));

function device() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const publicKeyBase64 = raw.toString("base64");
  return {
    publicKey: publicKeyBase64,
    deviceId: createHash("sha256").update(raw).digest("hex"),
    sign: (payload: string) => sign(null, Buffer.from(payload), privateKey).toString("base64"),
  };
}

function verifier(payload: string, signature: string, publicKey: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(payload),
      createPublicKey({
        key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, "base64")]),
        format: "der",
        type: "spki",
      }),
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

function make(overrides: Partial<FriendInvite> = {}) {
  const owner = device();
  const unsigned = {
    from: { deviceId: owner.deviceId, publicKey: owner.publicKey },
    relay: { url: "wss://192.168.1.20:8787/sync", fingerprint: PIN },
    workspace: "a".repeat(64),
    invite: "b".repeat(64),
    expiresAt: "2099-01-01T00:00:00.000Z",
    nonce: "c".repeat(32),
    ...overrides,
  };
  return { record: { ...unsigned, signature: owner.sign(friendInvitePayload(unsigned)) }, owner };
}

function invite(overrides: Partial<FriendInvite> = {}): FriendInvite {
  return make(overrides).record;
}

describe("a signed friend invitation", () => {
  it("verifies when the key, the id and the signature agree", () => {
    const record = invite();
    expect(verifyFriendInvite(record, verifier)).toEqual({ ok: true, record });
  });

  it("names the device id the key implies, and refuses a claim that does not", () => {
    const record = invite();
    expect(deviceIdFromPublicKey(record.from.publicKey)).toBe(record.from.deviceId);

    const claimed = { ...record, from: { ...record.from, deviceId: "d".repeat(64) } };
    expect(verifyFriendInvite(claimed, verifier)).toEqual({
      ok: false,
      reason: "device-key-mismatch",
    });
  });

  it("breaks when the relay, workspace, expiry or recipient is changed", () => {
    const record = invite();
    for (const tampered of [
      { ...record, relay: { ...record.relay, url: "wss://198.51.100.9:8787/sync" } },
      { ...record, workspace: "e".repeat(64) },
      { ...record, expiresAt: "2099-02-01T00:00:00.000Z" },
      { ...record, to: "0123456789ABCDEF" },
    ]) {
      expect(verifyFriendInvite(tampered, verifier)).toEqual({
        ok: false,
        reason: "invalid-signature",
      });
    }
  });

  it("refuses an expired envelope even when the signature is good", () => {
    const { record } = make({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(verifyFriendInvite(record, verifier)).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a wss relay with no usable pin", () => {
    const unpinned = invite({ relay: { url: "wss://relay.example:8787/sync", fingerprint: null } });
    expect(verifyFriendInvite(unpinned, verifier)).toEqual({
      ok: false,
      reason: "unpinned-relay",
    });

    const malformed = invite({
      relay: { url: "wss://relay.example:8787/sync", fingerprint: "not a fingerprint" },
    });
    expect(verifyFriendInvite(malformed, verifier)).toEqual({
      ok: false,
      reason: "unpinned-relay",
    });
  });

  it("lets a loopback relay carry no certificate pin", () => {
    const loopback = invite({ relay: { url: "ws://127.0.0.1:8787/sync", fingerprint: null } });
    expect(verifyFriendInvite(loopback, verifier).ok).toBe(true);
  });

  it("refuses a key that is not 32 bytes", () => {
    const record = invite();
    const short = { ...record, from: { ...record.from, publicKey: "AAAA" } };
    expect(verifyFriendInvite(short, verifier)).toEqual({ ok: false, reason: "malformed-key" });
  });
});

describe("an invitation link with a signed envelope", () => {
  it("round-trips, and still carries the legacy fields an older build reads", () => {
    const friend = invite();
    const link = formatInvite({
      host: friend.relay.url,
      workspaceId: friend.workspace,
      inviteId: friend.invite,
      friend,
    });

    expect(link).toContain("h=");
    expect(link).toContain("w=");
    expect(link).toContain("i=");
    expect(link).toContain("e=");
    expect(parseInvite(link)).toEqual({
      ok: true,
      value: {
        host: friend.relay.url,
        workspaceId: friend.workspace,
        inviteId: friend.invite,
        friend,
      },
    });
  });

  it("reads an old link with no envelope exactly as before", () => {
    const parsed = parseInvite(
      `suite://join?h=ws://127.0.0.1:8787/sync&w=${"a".repeat(64)}&i=${"b".repeat(64)}`,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        host: "ws://127.0.0.1:8787/sync",
        workspaceId: "a".repeat(64),
        inviteId: "b".repeat(64),
      },
    });
  });

  it("refuses an envelope that was cut up by a chat client", () => {
    const friend = invite();
    const link = formatInvite({
      host: friend.relay.url,
      workspaceId: friend.workspace,
      inviteId: friend.invite,
      friend,
    });
    const damaged = link.replace(/e=[^&]+/u, "e=not-base64");
    expect(parseInvite(damaged)).toEqual({
      ok: false,
      reason: "That invitation is damaged. Ask for a fresh one.",
    });
  });

  it("refuses a link whose legacy fields disagree with its envelope", () => {
    const friend = invite();
    const link = formatInvite({
      host: friend.relay.url,
      workspaceId: friend.workspace,
      inviteId: friend.invite,
      friend,
    });
    const lying = link.replace(`w=${friend.workspace}`, `w=${"f".repeat(64)}`);
    expect(parseInvite(lying)).toEqual({
      ok: false,
      reason: "That invitation is damaged. Ask for a fresh one.",
    });
  });
});
