import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Who this install is, as far as the relay and its neighbours are concerned.
 *
 * One Ed25519 key per install, kept beside the workspace. It signs every frame this device
 * sends, and its fingerprint is the device id. The relay pins the key on first join and
 * refuses any later frame that does not carry it, so losing this file means asking to be
 * let back in, not silently becoming someone else.
 *
 * This is deliberately not the key inside the MLS credential. That one belongs to the
 * group; this one belongs to the installation.
 */
const IDENTITY_FILE = "identity.json";

export interface DeviceIdentity {
  /** Base64 of 32 raw Ed25519 bytes. */
  readonly publicKey: string;
  readonly deviceId: string;
  sign(payload: Uint8Array | string): string;
}

interface StoredIdentity {
  readonly version: 1;
  readonly publicKey: string;
  readonly privateKey: string;
}

export async function loadOrCreateIdentity(dataDir: string): Promise<DeviceIdentity> {
  const directory = directoryFor(dataDir);
  const stored = await read(join(directory, IDENTITY_FILE));
  if (stored !== null) return fromStored(stored);

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // 12 bytes of SPKI header, then the 32 raw bytes every other implementation wants.
  const rawPublic = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const created: StoredIdentity = {
    version: 1,
    publicKey: rawPublic.toString("base64"),
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };

  await mkdir(directory, { recursive: true });
  const target = join(directory, IDENTITY_FILE);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(created, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
  return fromStored(created);
}

/** The id the protocol expects: the SHA-256 of the raw public key, lower-case hex. */
function deviceIdFrom(publicKeyBase64: string): string {
  return createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest("hex");
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Check an Ed25519 signature against a base64 public key.
 *
 * A signed invitation arrives carrying the inviter's key, so the reader has to be able
 * to verify with a key it has never seen. Node wants an SPKI wrapper; the twelve-byte
 * header is fixed for Ed25519.
 */
export function verifyEd25519(
  payload: string,
  signature: string,
  publicKeyBase64: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBase64, "base64")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(payload), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

function directoryFor(dataDir: string): string {
  return join(dataDir, "sync");
}

function fromStored(stored: StoredIdentity): DeviceIdentity {
  const key = createPrivateKey({
    key: Buffer.from(stored.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return {
    publicKey: stored.publicKey,
    deviceId: deviceIdFrom(stored.publicKey),
    sign: (payload) => sign(null, Buffer.from(payload), key).toString("base64"),
  };
}

async function read(path: string): Promise<StoredIdentity | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as StoredIdentity;
    if (typeof parsed.publicKey !== "string" || typeof parsed.privateKey !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
