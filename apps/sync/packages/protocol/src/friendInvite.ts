import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { decodeBase64 } from "./base64.js";
import { canonicalJson } from "./canonical.js";
import { normaliseFingerprint } from "./fingerprint.js";
import { isFriendCode } from "./friendCode.js";
import { deviceIdSchema, inviteIdSchema, workspaceIdSchema } from "./ids.js";

/**
 * An invitation that says who sent it, and carries the key to prove it.
 *
 * The relay's invitation record answers "may this device ask to join?" and deliberately
 * cannot say who the invitation is for. This envelope answers the other half: it names
 * the inviter's install key, the relay and its pin, the workspace, the one-use invite
 * and an expiry, and signs all of them together. A chat client or a relay in the middle
 * cannot redirect it to another host or swap the certificate without breaking the
 * signature.
 *
 * The envelope travels out of band, inside the link a person sends. The relay never
 * sees it and learns no friend code it was not given.
 */
const friendCodeSchema = z.string().refine(isFriendCode, "a friend code is 16 Crockford symbols");

export const friendInviteSchema = z
  .object({
    /** The inviter's installation, and the public half of the key that signed this. */
    from: z
      .object({
        deviceId: deviceIdSchema,
        /** Base64 of the 32 raw Ed25519 public-key bytes. */
        publicKey: z.string().min(1),
      })
      .strict(),
    /** Where to connect, and the certificate pin that makes a self-signed relay safe. */
    relay: z
      .object({
        url: z.string().regex(/^wss?:\/\/\S+$/u, "a relay address starts with ws:// or wss://"),
        /** Null only for a loopback `ws://` relay, which has no certificate to pin. */
        fingerprint: z.string().min(1).nullable(),
      })
      .strict(),
    workspace: workspaceIdSchema,
    invite: inviteIdSchema,
    /** Optional: the friend code this invitation was written for, as a hint to the app. */
    to: friendCodeSchema.optional(),
    /** ISO-8601. The relay refuses the invite, and a reader refuses the envelope. */
    expiresAt: z.string().min(1),
    /** Random and single-use. It makes two envelopes for one invite distinguishable. */
    nonce: z.string().min(1),
    signature: z.string().min(1),
  })
  .strict();

export type FriendInvite = z.infer<typeof friendInviteSchema>;

/** The part of an envelope that is signed, and the part that is not. */
export type FriendInviteBody = Omit<FriendInvite, "signature">;

export type FriendInviteVerifier = (
  payload: string,
  signature: string,
  publicKey: string,
) => boolean;

export const friendInviteRejectionSchema = z.enum([
  "malformed-key",
  "device-key-mismatch",
  "unpinned-relay",
  "expired",
  "invalid-signature",
]);

export type FriendInviteRejection = z.infer<typeof friendInviteRejectionSchema>;

export type FriendInviteResult =
  | { readonly ok: true; readonly record: FriendInvite }
  | { readonly ok: false; readonly reason: FriendInviteRejection };

/** The bytes the inviter signs. Canonical, so two builders of one envelope agree. */
export function friendInvitePayload(record: FriendInviteBody): string {
  return canonicalJson({
    from: record.from,
    relay: record.relay,
    workspace: record.workspace,
    invite: record.invite,
    ...(record.to !== undefined ? { to: record.to } : {}),
    expiresAt: record.expiresAt,
    nonce: record.nonce,
  });
}

/**
 * Check everything the envelope can prove on its own.
 *
 * The caller still decides two things: whether the workspace is the one this device has
 * open, and whether the inviter is a contact it trusts. This function establishes that
 * the signer holds the key it names, that the key is the device id it claims, that a
 * `wss://` relay carries a usable pin, and that the invitation has not expired.
 */
export function verifyFriendInvite(
  record: FriendInvite,
  verify: FriendInviteVerifier,
  now: Date = new Date(),
): FriendInviteResult {
  const deviceId = deviceIdFromPublicKey(record.from.publicKey);
  if (deviceId === null) return { ok: false, reason: "malformed-key" };
  if (deviceId !== record.from.deviceId) return { ok: false, reason: "device-key-mismatch" };

  if (record.relay.url.startsWith("wss://")) {
    if (record.relay.fingerprint === null) return { ok: false, reason: "unpinned-relay" };
    if (normaliseFingerprint(record.relay.fingerprint) === null) {
      return { ok: false, reason: "unpinned-relay" };
    }
  }

  if (record.expiresAt <= now.toISOString()) return { ok: false, reason: "expired" };

  let signed = "";
  try {
    signed = friendInvitePayload(record);
  } catch {
    return { ok: false, reason: "invalid-signature" };
  }
  if (!verify(signed, record.signature, record.from.publicKey)) {
    return { ok: false, reason: "invalid-signature" };
  }
  return { ok: true, record };
}

/**
 * The device id a public key implies: SHA-256 of its 32 raw bytes, lower-case hex.
 *
 * This is the same derivation the host and both app identities use. It lives here so a
 * reader of an envelope can check the claim without importing a platform's crypto.
 */
export function deviceIdFromPublicKey(publicKeyBase64: string): string | null {
  const bytes = decodeBase64(publicKeyBase64);
  if (bytes === null || bytes.length !== 32) return null;
  return Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
