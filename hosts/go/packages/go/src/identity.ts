/**
 * The per-pack identity derived from the host's device key (S2.6, S4.7).
 *
 * This file is pure: it derives bytes and signs them. It never reads or writes a
 * device key — that is the host's `host/packIdentity.ts`, which keeps the secret
 * in the app's private data directory. Keeping the derivation here means the
 * phone and the desktop can agree on one identity while each host owns its own
 * storage.
 *
 * The derivation is HKDF-SHA256 over the host's 32-byte Ed25519 device seed:
 *
 *   secret = HKDF-SHA256(ikm = device seed,
 *                        salt = "suite/pack-identity/v1",
 *                        info = "suite/pack-identity/v1" 0x00 publisher id
 *                                                            0x00 pack id,
 *                        length = 32)
 *
 * The derived bytes are an Ed25519 seed. The input is `(publisher id, pack id)`,
 * never the pack id alone: one host can hold the same pack id under two
 * publishers, and they must not share an identity. A publisher *key* rotation
 * keeps the id, so the pack key survives it; a migration to another publisher
 * changes the tuple and therefore the key.
 *
 * HKDF is one-way. The device seed is never part of the output, and the derived
 * secret is never returned to a pack: the host gives a pack the public identity
 * and a host-mediated sign call (`signPackRecord`). The forbid list is enforced
 * in that one place, before Ed25519 runs.
 */
import { getPublicKey, hashes, sign as nobleSign, verify as nobleVerify } from "@noble/ed25519";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { isSuiteGoModuleId } from "./module.js";

// The same explicit hash the pack verifier installs. Module evaluation order is
// not something a caller should have to think about, so it is set here too.
hashes.sha512 = sha512;

/** The domain-separation label and the version of this derivation. */
export const PACK_KEY_DERIVATION_LABEL = "suite/pack-identity/v1";
/** An Ed25519 seed is 32 bytes. */
export const PACK_KEY_BYTES = 32;
/** The first-party publisher id the pinned suite key carries. */
export const FIRST_PARTY_PUBLISHER_ID = "suite";

const PUBLISHER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;

/** A stable publisher id, safe as one path segment. Same rule as the desktop. */
export function isSafePublisherId(value: string): boolean {
  return PUBLISHER_ID.test(value);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** The host's device key, as the host stores it. The secret never crosses the frame. */
export interface DeviceKey {
  readonly version: 1;
  /** Standard base64 of the 32-byte Ed25519 seed. */
  readonly secretKey: string;
  /** Standard base64 of the derived public key, recorded for inspection. */
  readonly publicKey: string;
}

/** One pack's derived key. Only the public half leaves the host. */
export interface PackKey {
  readonly publisherId: string;
  readonly packId: string;
  /** Standard base64 Ed25519 public key. */
  readonly publicKey: string;
  /** The derived secret. It stays on the host; never return it over the frame. */
  readonly secretKey: string;
}

/** What a pack may learn about its own identity. There is no secret field. */
export interface PackIdentityView {
  readonly publisherId: string;
  readonly packId: string;
  readonly algorithm: "Ed25519";
  readonly publicKey: string;
  readonly fingerprint: string;
}

/**
 * The four things somebody might ask a key to sign.
 *
 * Only `pack-data` is a pack key's job. The other three belong to the device key
 * and to the relay, so they are named here to be refused rather than merely
 * omitted.
 */
export const PACK_RECORD_PURPOSES = [
  "pack-data",
  "relay-frame",
  "role-record",
  "membership-change",
] as const;

export type PackRecordPurpose = (typeof PACK_RECORD_PURPOSES)[number];

const FORBIDDEN_RECORD: Readonly<Record<Exclude<PackRecordPurpose, "pack-data">, string>> = {
  "relay-frame": "a relay frame",
  "role-record": "a relay role record",
  "membership-change": "a membership change",
};

/** A signing request a pack key is not allowed to serve. */
export class PackSigningRefusal extends Error {
  readonly purpose: Exclude<PackRecordPurpose, "pack-data">;

  constructor(purpose: Exclude<PackRecordPurpose, "pack-data">) {
    super(
      `A pack key cannot sign ${FORBIDDEN_RECORD[purpose]} (S2.6, S4.7); a pack key signs only the pack's own data.`,
    );
    this.name = "PackSigningRefusal";
    this.purpose = purpose;
  }
}

/** A fresh device key. The secret is a host secret; a pack never sees it. */
export function generateDeviceKey(): DeviceKey {
  const secret = crypto.getRandomValues(new Uint8Array(PACK_KEY_BYTES));
  const secretKey = bytesToBase64(secret);
  return { version: 1, secretKey, publicKey: publicKeyFromSecret(secretKey) };
}

/** The public half of an Ed25519 secret, standard base64. */
export function publicKeyFromSecret(secretKeyBase64: string): string {
  return bytesToBase64(getPublicKey(base64ToBytes(secretKeyBase64)));
}

/**
 * The exact HKDF `info` bytes for one `(publisher id, pack id)`.
 *
 * Both ids are lower-case kebab-case, so a NUL cannot occur in either and cannot
 * be used to make two different tuples share one input.
 */
export function packKeyInfo(publisherId: string, packId: string): Uint8Array {
  if (!isSafePublisherId(publisherId)) throw new Error("invalid publisher id");
  if (!isSuiteGoModuleId(packId)) throw new Error("invalid pack id");
  return new TextEncoder().encode(
    `${PACK_KEY_DERIVATION_LABEL}\u0000${publisherId}\u0000${packId}`,
  );
}

/** Derive one pack's 32-byte Ed25519 seed, standard base64. */
export function derivePackSecretKey(
  deviceSecretKeyBase64: string,
  publisherId: string,
  packId: string,
): string {
  let ikm: Uint8Array;
  try {
    ikm = base64ToBytes(deviceSecretKeyBase64);
  } catch {
    throw new Error("invalid device key");
  }
  if (ikm.byteLength !== PACK_KEY_BYTES) throw new Error("invalid device key");

  const salt = new TextEncoder().encode(PACK_KEY_DERIVATION_LABEL);
  const info = packKeyInfo(publisherId, packId);
  return bytesToBase64(hkdf(sha256, ikm, salt, info, PACK_KEY_BYTES));
}

/** Derive a pack's key pair from the host device key. */
export function derivePackKey(device: DeviceKey, publisherId: string, packId: string): PackKey {
  const secretKey = derivePackSecretKey(device.secretKey, publisherId, packId);
  return {
    publisherId,
    packId,
    secretKey,
    publicKey: publicKeyFromSecret(secretKey),
  };
}

/** The public identity a pack may see. An explicit field list, so no secret can slip through. */
export async function packIdentityView(key: PackKey): Promise<PackIdentityView> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", base64ToBytes(key.publicKey) as unknown as BufferSource),
  );
  const fingerprint = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(":")
    .toUpperCase();
  return {
    publisherId: key.publisherId,
    packId: key.packId,
    algorithm: "Ed25519",
    publicKey: key.publicKey,
    fingerprint,
  };
}

/**
 * Sign bytes with a pack key, if the purpose is the pack's own data.
 *
 * The check runs before `nobleSign`, so a caller that wires a relay frame, a role
 * record or a membership change into this function gets no signature at all.
 */
export function signPackRecord(
  purpose: PackRecordPurpose,
  bytes: Uint8Array,
  secretKeyBase64: string,
): string {
  if (purpose !== "pack-data") {
    throw new PackSigningRefusal(purpose);
  }
  return bytesToBase64(nobleSign(bytes, base64ToBytes(secretKeyBase64)));
}

/** Verify a signature with a standard-base64 public key. A malformed value is `false`. */
export async function verifyPackRecord(
  bytes: Uint8Array,
  signatureBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    return await nobleVerify(base64ToBytes(signatureBase64), bytes, base64ToBytes(publicKeyBase64));
  } catch {
    return false;
  }
}

/** What a mounted module may ask the host for. The secret is not a field. */
export interface PackIdentityService {
  /** The public half of this pack's derived identity. */
  pack(): Promise<PackIdentityView>;
  /**
   * Sign the pack's own data. A relay frame, a role record or a membership
   * change is refused by the host before any signature is made.
   */
  sign(purpose: PackRecordPurpose, bytes: Uint8Array): Promise<string>;
}
