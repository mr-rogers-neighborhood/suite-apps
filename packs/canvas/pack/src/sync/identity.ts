import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { decodeBase64, encodeBase64 } from "@suite/sync";
import type { SyncIdentity } from "@suite/sync-desktop/relay";

import { decodeStoreText, encodeStoreText, type SyncStoreFiles } from "./files.js";

/**
 * Who this install is, as far as the relay and its neighbours are concerned.
 *
 * One Ed25519 key per pack install, in the pack's own `files` root. It signs every frame this
 * device sends, and its fingerprint is the device id. The relay pins the key on first join and
 * refuses any later frame that does not carry it, so losing this file means asking to be let
 * back in, not silently becoming someone else.
 *
 * This is the installation key, not the MLS credential inside the group: this one still works
 * when a device has been removed from every group it was in.
 *
 * The signature is synchronous because the relay header is signed on the send path. Ed25519 in
 * WebCrypto is promise-only, so the small noble implementation is used and its SHA-512 is wired
 * once at module load. Nothing here is Electron, Node or a host key.
 */
const IDENTITY_FILE = "sync/identity.json";

// `sign` and `getPublicKey` are synchronous only once this is set. v3's async WebCrypto path
// would force every frame signature to await, which the protocol's send shape does not allow.
ed.hashes.sha512 = sha512;

interface StoredIdentity {
  readonly version: 1;
  readonly publicKey: string;
  readonly privateKey: string;
}

/** This install's key pair, for a recovery file. Null when it has never made one. */
export interface StoredIdentityFile {
  readonly version: 1;
  readonly publicKey: string;
  readonly privateKey: string;
}

export function deviceIdFrom(publicKeyBase64: string): string {
  const bytes = decodeBase64(publicKeyBase64);
  if (bytes === null) throw new Error("That identity key is not base64.");
  return bytesToHex(sha256(bytes));
}

/** This install's key pair, as it sits in the pack's own root. */
export async function readStoredIdentity(
  files: SyncStoreFiles,
): Promise<StoredIdentityFile | null> {
  const bytes = await files.read(IDENTITY_FILE);
  if (bytes === null) return null;
  try {
    const parsed = JSON.parse(decodeStoreText(bytes)) as StoredIdentity;
    if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") return null;
    return { version: 1, publicKey: parsed.publicKey, privateKey: parsed.privateKey };
  } catch {
    return null;
  }
}

/**
 * Install a key pair from a recovery file.
 *
 * Refuses to overwrite an identity that belongs to a different device: that file is somebody
 * else's install, and adopting it would make two machines answer to one id.
 */
export async function writeStoredIdentity(
  files: SyncStoreFiles,
  stored: StoredIdentityFile,
  replace = false,
): Promise<SyncIdentity> {
  const existing = await readStoredIdentity(files);
  if (!replace && existing !== null && existing.publicKey !== stored.publicKey) {
    throw new Error("This device already has its own identity.");
  }
  await files.write(IDENTITY_FILE, encodeStoreText(`${JSON.stringify(stored, null, 2)}\n`));
  return fromStored(stored);
}

export async function loadOrCreateIdentity(files: SyncStoreFiles): Promise<SyncIdentity> {
  const stored = await readStoredIdentity(files);
  if (stored !== null) return fromStored(stored);

  const { publicKey, secretKey } = ed.keygen();
  const created: StoredIdentity = {
    version: 1,
    publicKey: encodeBase64(publicKey),
    privateKey: encodeBase64(secretKey),
  };
  await files.write(IDENTITY_FILE, encodeStoreText(`${JSON.stringify(created, null, 2)}\n`));
  return fromStored(created);
}

function fromStored(stored: StoredIdentity): SyncIdentity {
  const privateKey = decodeBase64(stored.privateKey);
  if (privateKey === null || privateKey.length !== 32) {
    throw new Error("That identity key could not be read.");
  }
  return {
    deviceId: deviceIdFrom(stored.publicKey),
    publicKey: stored.publicKey,
    sign: (payload) =>
      encodeBase64(ed.sign(asBytes(payload), privateKey)),
  };
}

/** The verifier `verifyFriendInvite` takes, with a base64 key. */
export function verifyEd25519(
  payload: string,
  signature: string,
  publicKeyBase64: string,
): boolean {
  try {
    const publicKey = decodeBase64(publicKeyBase64);
    const signatureBytes = decodeBase64(signature);
    if (publicKey === null || signatureBytes === null) return false;
    return ed.verify(signatureBytes, asBytes(payload), publicKey);
  } catch {
    return false;
  }
}

function asBytes(payload: Uint8Array | string): Uint8Array {
  return typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
