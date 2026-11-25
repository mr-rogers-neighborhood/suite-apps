import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addContact, learnContact, resolveFriendInvite } from "./contacts.js";
import { formatFingerprint } from "./fingerprint.js";
import { deriveFriendCode, formatFriendCode } from "./friendCode.js";
import {
  deviceIdFromPublicKey,
  type FriendInvite,
  friendInvitePayload,
  friendInviteSchema,
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

function make(overrides: Partial<FriendInvite> = {}, owner = device()) {
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

  it("breaks when any signed field is changed", () => {
    const record = invite();
    for (const tampered of [
      { ...record, relay: { ...record.relay, url: "wss://198.51.100.9:8787/sync" } },
      { ...record, relay: { ...record.relay, fingerprint: formatFingerprint("ab".repeat(32)) } },
      { ...record, relay: { ...record.relay, fingerprint: null } },
      { ...record, workspace: "e".repeat(64) },
      { ...record, invite: "f".repeat(64) },
      { ...record, expiresAt: "2099-02-01T00:00:00.000Z" },
      { ...record, nonce: "f".repeat(32) },
      { ...record, to: "0123456789ABCDEF" },
    ]) {
      expect(verifyFriendInvite(tampered, verifier)).toEqual({
        ok: false,
        reason: "invalid-signature",
      });
    }
  });

  it("refuses a different key, with or without a matching device id", () => {
    const record = invite();
    const other = device();

    expect(
      verifyFriendInvite(
        { ...record, from: { ...record.from, publicKey: other.publicKey } },
        verifier,
      ),
    ).toEqual({ ok: false, reason: "device-key-mismatch" });

    // A forger can change both halves so the binding holds, but then the signature was
    // made by the other device and the named key does not verify it.
    expect(
      verifyFriendInvite(
        {
          ...record,
          from: { deviceId: other.deviceId, publicKey: other.publicKey },
        },
        verifier,
      ),
    ).toEqual({ ok: false, reason: "invalid-signature" });
  });

  it("refuses an expiry that is not an ISO-8601 timestamp", () => {
    const { owner } = make();
    const unsigned = {
      from: { deviceId: owner.deviceId, publicKey: owner.publicKey },
      relay: { url: "wss://192.168.1.20:8787/sync", fingerprint: PIN },
      workspace: "a".repeat(64),
      invite: "b".repeat(64),
      expiresAt: "tomorrow",
      nonce: "c".repeat(32),
    };
    const signed = { ...unsigned, signature: owner.sign(friendInvitePayload(unsigned)) };

    expect(friendInviteSchema.safeParse(signed).success).toBe(false);
    expect(verifyFriendInvite(signed, verifier)).toEqual({ ok: false, reason: "expired" });
  });

  it("compares expiry instants, not ISO strings with different zones", () => {
    // 00:30 at +01:00 is 23:30 UTC on the previous day. Compared as text it looks later
    // than 00:00Z; compared as an instant it has already passed.
    const { record } = make({ expiresAt: "2099-01-01T00:30:00.000+01:00" });
    expect(friendInviteSchema.safeParse(record).success).toBe(true);
    expect(verifyFriendInvite(record, verifier, new Date("2099-01-01T00:00:00.000Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
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

  it("allows a plaintext relay only on loopback, and only without a pin", () => {
    for (const url of [
      "ws://127.0.0.1:8787/sync",
      "ws://[::1]:8787/sync",
      "ws://localhost:8787/sync",
    ]) {
      const loopback = invite({ relay: { url, fingerprint: null } });
      expect(verifyFriendInvite(loopback, verifier).ok).toBe(true);
    }

    for (const url of [
      "ws://192.168.1.20:8787/sync",
      "ws://relay.example:8787/sync",
      "ws://127.0.0.1.evil.example:8787/sync",
    ]) {
      const remote = invite({ relay: { url, fingerprint: null } });
      expect(verifyFriendInvite(remote, verifier)).toEqual({
        ok: false,
        reason: "unpinned-relay",
      });
    }

    const pinnedPlaintext = invite({
      relay: { url: "ws://127.0.0.1:8787/sync", fingerprint: PIN },
    });
    expect(verifyFriendInvite(pinnedPlaintext, verifier)).toEqual({
      ok: false,
      reason: "unpinned-relay",
    });
  });

  it("refuses a key that is not 32 bytes", () => {
    const record = invite();
    const short = { ...record, from: { ...record.from, publicKey: "AAAA" } };
    expect(verifyFriendInvite(short, verifier)).toEqual({ ok: false, reason: "malformed-key" });
  });
});

describe("a code-only contact and the first invitation", () => {
  const at = new Date("2026-01-01T00:00:00.000Z");

  it("is completed by the first verified invitation", () => {
    const inviter = device();
    const ownCode = deriveFriendCode(device().publicKey);
    const { record } = make({ to: ownCode }, inviter);
    expect(verifyFriendInvite(record, verifier).ok).toBe(true);

    const code = deriveFriendCode(inviter.publicKey);
    let contacts = addContact([], { code, name: "Ada" }, at);
    expect(contacts[0]?.publicKey).toBeUndefined();

    expect(resolveFriendInvite(record, contacts, ownCode)).toMatchObject({ status: "known", code });
    contacts = learnContact(contacts, record, at);
    expect(contacts[0]).toMatchObject({
      code,
      name: "Ada",
      deviceId: inviter.deviceId,
      publicKey: inviter.publicKey,
      lastSeenAt: at.toISOString(),
      trusted: true,
    });
  });

  it("accepts a display-form `to` that the inviter signed that way", () => {
    const inviter = device();
    const ownCode = deriveFriendCode(device().publicKey);
    const { record } = make({ to: formatFriendCode(ownCode).toLowerCase() }, inviter);
    expect(verifyFriendInvite(record, verifier).ok).toBe(true);

    const contacts = addContact([], { code: deriveFriendCode(inviter.publicKey), name: "Ada" }, at);
    expect(resolveFriendInvite(record, contacts, ownCode)).toMatchObject({ status: "known" });
  });

  it("is still refused when the signed `to` names another code", () => {
    const inviter = device();
    const { record } = make({ to: deriveFriendCode(device().publicKey) }, inviter);
    const contacts = addContact([], { code: deriveFriendCode(inviter.publicKey), name: "Ada" }, at);
    expect(
      resolveFriendInvite(record, contacts, deriveFriendCode(device().publicKey)),
    ).toMatchObject({ status: "for-someone-else" });
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
    const lies: ReadonlyArray<readonly [string, string]> = [
      ["w", "f".repeat(64)],
      ["i", "f".repeat(64)],
      ["h", "wss://198.51.100.9:8787/sync"],
    ];
    for (const [field, value] of lies) {
      const lying = new URL(link);
      lying.searchParams.set(field, value);
      expect(parseInvite(lying.toString())).toEqual({
        ok: false,
        reason: "That invitation is damaged. Ask for a fresh one.",
      });
    }
  });

  it("reads a link that carries only the envelope", () => {
    const friend = invite();
    const link = `suite://join?e=${encodeURIComponent(Buffer.from(JSON.stringify(friend)).toString("base64url"))}`;
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
});
