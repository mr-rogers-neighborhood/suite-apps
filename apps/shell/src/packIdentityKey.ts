import { hkdfSync, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  base64ToBytes,
  bytesToBase64,
  generatePackKeyPair,
  isSafePackId,
  isSafePublisherId,
  publicKeyFromSecret,
  publisherKeyFingerprint,
  signBytes,
} from "@suite/pack";

/**
 * The host's device key and the per-pack keys derived from it (S2.6, S4.7).
 *
 * The device key is the host's own Ed25519 seed, kept at
 * `<dataRoot>/identity/device.json` with mode 0600. It never crosses the pack
 * bridge and no pack can ask for it.
 *
 * A pack's key is derived with HKDF-SHA256:
 *
 *   secret = HKDF-SHA256(ikm = device seed,
 *                        salt = "suite/pack-identity/v1",
 *                        info = "suite/pack-identity/v1" 0x00 publisher id
 *                                                            0x00 pack id,
 *                        length = 32)
 *
 * The 32 derived bytes are an Ed25519 seed. The derivation input is
 * `(publisher id, pack id)`, not the pack id alone: one host can hold the same
 * public pack id under two publishers (S2.2), and they must not share an
 * identity. A publisher *key* rotation keeps the id (S2.3), so the pack key
 * survives it; a migration to a different publisher changes the tuple and the
 * key, which is what "inherits nothing" means for identity too.
 *
 * HKDF is one-way. The device seed is the input keying material, never part of
 * the output, and the derived secret is never written or returned to a pack.
 * The pack receives the public half and a host-mediated sign call (below), so
 * there is no second copy of the derived secret for a renderer to keep.
 *
 * The forbidden-signature rule is enforced in `signPackRecord`, the one place a
 * pack key signs anything: only `pack-data` is accepted. A relay frame, a relay
 * role record or a membership change is refused before the signature is made,
 * not left to a caller's comment.
 */

export const DEVICE_KEY_FILE = "device.json";
export const DEVICE_KEY_VERSION = 1;
/** The domain-separation label and the version of this derivation. */
export const PACK_KEY_DERIVATION_LABEL = "suite/pack-identity/v1";
/** An Ed25519 seed is 32 bytes. */
export const PACK_KEY_BYTES = 32;

/** The host's device key. The secret is host-only; it never crosses the bridge. */
export interface DeviceKey {
  readonly version: typeof DEVICE_KEY_VERSION;
  /** Standard base64 of the 32-byte Ed25519 seed. */
  readonly secretKey: string;
  /** Standard base64 of the derived public key, recorded for inspection. */
  readonly publicKey: string;
}

/** One pack's derived key. Only the public half and a view leave the host. */
export interface PackKey {
  readonly publisherId: string;
  readonly packId: string;
  /** Standard base64 Ed25519 public key. */
  readonly publicKey: string;
  /** The derived secret. It stays in the main process; never return it over IPC. */
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
 * omitted. A future relay signer can pass its record kind through the same
 * guard and get the refusal instead of a signature.
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

/**
 * Sign bytes with a pack key, if the purpose is the pack's own data.
 *
 * This is the enforcement point: the check runs before `signBytes`, so a caller
 * that wires a relay frame, a role record or a membership change into this
 * function gets no signature at all.
 */
export function signPackRecord(
  purpose: PackRecordPurpose,
  bytes: Uint8Array,
  secretKeyBase64: string,
): string {
  if (purpose !== "pack-data") {
    throw new PackSigningRefusal(purpose);
  }
  return signBytes(bytes, secretKeyBase64);
}

function parseDeviceKey(text: string): DeviceKey | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.version !== DEVICE_KEY_VERSION) return null;
  if (typeof record.secretKey !== "string") return null;

  let secret: Uint8Array;
  try {
    secret = base64ToBytes(record.secretKey);
  } catch {
    return null;
  }
  if (secret.byteLength !== PACK_KEY_BYTES) return null;

  const publicKey = publicKeyFromSecret(record.secretKey);
  if (record.publicKey !== undefined && record.publicKey !== publicKey) return null;

  return { version: DEVICE_KEY_VERSION, secretKey: record.secretKey, publicKey };
}

async function writeDeviceKey(root: string, key: DeviceKey): Promise<void> {
  const target = join(root, DEVICE_KEY_FILE);
  const temporary = join(root, `.tmp-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Read the host's device key, creating it on first use.
 *
 * A missing file is a first run and gets a fresh key. A malformed file is *not*
 * replaced: silently minting a new device key would change every pack identity
 * on the host, so the caller gets an error and can keep refusing identity calls
 * until the person repairs or removes the file.
 */
export async function openDeviceKey(root: string): Promise<DeviceKey> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const file = join(root, DEVICE_KEY_FILE);

  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const pair = await generatePackKeyPair();
    const created: DeviceKey = {
      version: DEVICE_KEY_VERSION,
      secretKey: pair.secretKeyBase64,
      publicKey: pair.publicKeyBase64,
    };
    await writeDeviceKey(root, created);
    return created;
  }

  const parsed = parseDeviceKey(text);
  if (parsed === null) {
    throw new Error(
      `The host device key at ${file} is not a device key; identity calls stay refused.`,
    );
  }
  return parsed;
}

/**
 * The exact HKDF `info` bytes for one `(publisher id, pack id)`.
 *
 * Both ids are lower-case kebab-case (`isSafePublisherId`, `isSafePackId`), so a
 * NUL cannot occur in either and cannot be used to make two different tuples
 * share one input.
 */
export function packKeyInfo(publisherId: string, packId: string): Uint8Array {
  if (!isSafePublisherId(publisherId)) throw new Error("invalid publisher id");
  if (!isSafePackId(packId)) throw new Error("invalid pack id");
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
  const derived = new Uint8Array(hkdfSync("sha256", ikm, salt, info, PACK_KEY_BYTES));
  return bytesToBase64(derived);
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

/**
 * The public identity a pack may see.
 *
 * Deliberately an explicit field list rather than a spread, so adding a field to
 * `PackKey` cannot accidentally carry the secret across the bridge.
 */
export async function packIdentityView(key: PackKey): Promise<PackIdentityView> {
  return {
    publisherId: key.publisherId,
    packId: key.packId,
    algorithm: "Ed25519",
    publicKey: key.publicKey,
    fingerprint: await publisherKeyFingerprint(key.publicKey),
  };
}
