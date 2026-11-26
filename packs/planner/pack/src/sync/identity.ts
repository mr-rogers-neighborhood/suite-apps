import {
  getPublicKey,
  hashes,
  sign as nobleSign,
  verify as nobleVerify,
} from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { FilesService } from "@suite/pack-runtime";
import type { SyncIdentity } from "@suite/sync-desktop";
import { decodeBase64, encodeBase64 } from "@suite/sync";

hashes.sha512 = sha512;

/**
 * The installation key this pack signs relay frames with.
 *
 * The host's `identity.pack` key is not this key: a pack key signs the pack's own
 * data and is refused for a relay frame or a membership record (S2.6, S4.7).
 * Sync needs its own Ed25519 key, held by the pack itself, in the pack's scoped
 * files root. The device id is the SHA-256 of the raw public key, the same value
 * the relay pins on first join.
 *
 * Node's `readFile`/`writeFile` are not available here, so this is the renderer's
 * version of `legacy/planner/src/main/sync/identity.ts`. `@noble` is the same
 * family the protocol already uses; it gives the synchronous `sign` the shared
 * lifecycle expects, which `crypto.subtle` cannot.
 */
const IDENTITY_PATH = "sync/identity.json";
const IDENTITY_VERSION = 1;

interface StoredIdentity {
  readonly version: 1;
  /** Base64 of the 32-byte Ed25519 seed. */
  readonly privateKey: string;
  /** Base64 of the 32-byte public key. */
  readonly publicKey: string;
}

export interface PackSyncIdentity extends SyncIdentity {
  /** The scoped files path the key lives at. Never a document or a host path. */
  readonly path: string;
}

function isFilesService(files: Partial<FilesService> | null | undefined): files is FilesService {
  return (
    files !== null &&
    files !== undefined &&
    typeof files.read === "function" &&
    typeof files.write === "function"
  );
}

function decodeStored(parsed: unknown): StoredIdentity | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as { version?: unknown; privateKey?: unknown; publicKey?: unknown };
  if (record.version !== IDENTITY_VERSION) return null;
  if (typeof record.privateKey !== "string" || typeof record.publicKey !== "string") return null;
  return { version: 1, privateKey: record.privateKey, publicKey: record.publicKey };
}

function identityFrom(stored: StoredIdentity): PackSyncIdentity | null {
  const secret = decodeBase64(stored.privateKey);
  const publicKey = decodeBase64(stored.publicKey);
  if (secret === null || secret.byteLength !== 32) return null;
  if (publicKey === null || publicKey.byteLength !== 32) return null;
  return {
    deviceId: bytesToHex(sha256(publicKey)),
    publicKey: encodeBase64(publicKey),
    path: IDENTITY_PATH,
    sign(payload) {
      const bytes = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
      return encodeBase64(nobleSign(bytes, secret));
    },
  };
}

async function readIdentity(files: FilesService): Promise<StoredIdentity | null> {
  try {
    const bytes = await files.read(IDENTITY_PATH);
    return decodeStored(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

/**
 * Load this installation's key, or make the first one.
 *
 * The key is written before it is used: an invitation spent against a key that
 * was never stored would ask somebody to add a device that cannot come back.
 * `FilesService.write` is the host's atomic write, so a crash leaves the old key
 * or the new one, never half of either.
 */
export async function loadOrCreateIdentity(
  files: Partial<FilesService> | null | undefined,
): Promise<PackSyncIdentity> {
  if (!isFilesService(files)) {
    throw new Error("This host gives Planner no files root, so sync keys cannot be stored.");
  }

  const stored = await readIdentity(files);
  const existing = stored === null ? null : identityFrom(stored);
  if (existing !== null) return existing;

  const secret = new Uint8Array(32);
  crypto.getRandomValues(secret);
  const publicKey = getPublicKey(secret);
  const created: StoredIdentity = {
    version: 1,
    privateKey: encodeBase64(secret),
    publicKey: encodeBase64(publicKey),
  };
  await files.write(
    IDENTITY_PATH,
    new TextEncoder().encode(`${JSON.stringify(created, null, 2)}\n`),
    { atomic: true },
  );
  const identity = identityFrom(created);
  if (identity === null) throw new Error("The new sync key could not be read back.");
  return identity;
}

/** Check an Ed25519 signature against a base64 public key. A malformed value is false. */
export function verifyEd25519(
  payload: string,
  signature: string,
  publicKeyBase64: string,
): boolean {
  const key = decodeBase64(publicKeyBase64);
  const sig = decodeBase64(signature);
  if (key === null || sig === null) return false;
  try {
    return nobleVerify(sig, new TextEncoder().encode(payload), key);
  } catch {
    return false;
  }
}
