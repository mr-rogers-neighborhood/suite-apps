import { gcm } from "@noble/ciphers/aes.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { type DeviceGroup, decodeGroup, encodeGroup, genesisRecordSchema } from "@suite/sync";

import { decodeStoreText, encodeStoreText } from "./files.js";
import type { StoredIdentityFile } from "./identity.js";

/**
 * A way back in, as one file, in the same format the Electron shell writes.
 *
 * MLS has no escrow and a blind relay has nothing to restore from, so this is the only thing
 * that survives losing every device in a workspace. It carries the two halves that make a
 * device real: its signing identity, which the relay has pinned, and the group state, which is
 * the only thing that can read what was sealed to it.
 *
 * Whoever holds the file *is* this device, so the only question is how it is protected. Plain
 * by default; a passphrase seals it with scrypt and AES-256-GCM, the same construction and
 * parameters the shell uses, so a kit written here opens there and the other way round.
 *
 * There is no identity root in a pack kit: a pack does not create one. The field stays optional
 * in the format, and a kit from a shell that has one still imports its group and identity.
 */
export const KIT_FORMAT = "suite.recovery-kit";
export const KIT_VERSION = 1;

export interface KitPayload {
  readonly group: string;
  readonly identity: StoredIdentityFile;
  /** Present when the kit came from a device that holds a workspace root. Left as read. */
  readonly root?: unknown;
}

export interface KitFile {
  readonly format: typeof KIT_FORMAT;
  readonly version: number;
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly createdAt: string;
  readonly plain?: KitPayload;
  readonly sealed?: {
    readonly salt: string;
    readonly nonce: string;
    readonly tag: string;
    readonly ciphertext: string;
  };
}

export interface KitOptions {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly group: DeviceGroup;
  readonly identity: StoredIdentityFile;
  readonly now?: Date;
}

const SCRYPT_KEY_LENGTH = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/** Write a kit. `passphrase` seals it; null or "" leaves it plain. */
export function exportKit(options: KitOptions, passphrase: string | null): Uint8Array {
  const payload: KitPayload = {
    group: toBase64(encodeGroup(options.group)),
    identity: options.identity,
  };
  const common = {
    format: KIT_FORMAT as typeof KIT_FORMAT,
    version: KIT_VERSION,
    workspaceId: options.workspaceId,
    deviceId: options.deviceId,
    deviceName: options.deviceName,
    createdAt: (options.now ?? new Date()).toISOString(),
  };

  const secret = passphrase?.trim() ?? "";
  if (secret.length === 0) return encodeJson({ ...common, plain: payload });

  const salt = randomBytes(16);
  const nonce = randomBytes(NONCE_BYTES);
  const sealed = gcm(deriveKey(secret, salt), nonce).encrypt(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  // noble returns ciphertext followed by the tag; the kit format keeps the tag beside the
  // nonce, as the Electron shell writes it.
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const ciphertext = sealed.subarray(0, sealed.length - TAG_BYTES);

  return encodeJson({
    ...common,
    sealed: {
      salt: toBase64(salt),
      nonce: toBase64(nonce),
      tag: toBase64(tag),
      ciphertext: toBase64(ciphertext),
    },
  });
}

export interface OpenedKit {
  readonly workspaceId: string;
  readonly deviceId: string;
  readonly deviceName: string;
  readonly group: DeviceGroup;
  readonly identity: StoredIdentityFile;
  /** The identity root a shell kit carried, kept opaque to the pack. */
  readonly root: unknown | null;
}

/**
 * Read a kit, or say what is wrong with it in a sentence a person can act on.
 *
 * A wrong passphrase and a damaged file are the same failure to a cipher; they are different
 * failures to a person, so the message names the passphrase when one was supplied.
 */
export function importKit(bytes: Uint8Array, passphrase: string | null): OpenedKit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeStoreText(bytes));
  } catch {
    throw new Error("That file is not a recovery file.");
  }
  const kit = parsed as Partial<KitFile>;
  if (kit.format !== KIT_FORMAT) throw new Error("That file is not a recovery file.");
  if (typeof kit.version !== "number" || kit.version > KIT_VERSION) {
    throw new Error("That recovery file was written by a newer version of the app.");
  }
  if (typeof kit.workspaceId !== "string" || typeof kit.deviceId !== "string") {
    throw new Error("That recovery file is missing what it needs.");
  }

  const payload = kit.sealed === undefined ? kit.plain : openSealed(kit.sealed, passphrase);
  if (payload === undefined) throw new Error("That recovery file has nothing in it.");

  const identity = payload.identity;
  if (typeof identity?.publicKey !== "string" || typeof identity?.privateKey !== "string") {
    throw new Error("That recovery file is missing the device it belongs to.");
  }

  const root = payload.root === undefined ? null : storedRoot(payload.root);
  if (payload.root !== undefined && root === null) {
    throw new Error("That recovery file's workspace root could not be read.");
  }

  let group: DeviceGroup;
  try {
    group = decodeGroup(fromBase64(payload.group));
  } catch {
    throw new Error("That recovery file's workspace could not be read.");
  }

  return {
    workspaceId: kit.workspaceId,
    deviceId: kit.deviceId,
    deviceName: typeof kit.deviceName === "string" ? kit.deviceName : "this device",
    group,
    identity,
    root,
  };
}

/** A root record as a shape, so a shell kit's optional field is not silently dropped. */
function storedRoot(value: unknown): unknown | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.publicKey !== "string" || typeof record.privateKey !== "string") return null;
  const genesis = genesisRecordSchema.safeParse(record.genesis);
  return genesis.success ? value : null;
}

function openSealed(sealed: NonNullable<KitFile["sealed"]>, passphrase: string | null): KitPayload {
  const secret = passphrase?.trim() ?? "";
  if (secret.length === 0) throw new Error("That recovery file needs its passphrase.");
  try {
    const tag = fromBase64(sealed.tag);
    const ciphertext = fromBase64(sealed.ciphertext);
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);
    const plain = gcm(
      deriveKey(secret, fromBase64(sealed.salt)),
      fromBase64(sealed.nonce),
    ).decrypt(combined);
    return JSON.parse(decodeStoreText(plain)) as KitPayload;
  } catch {
    throw new Error("That passphrase did not open it.");
  }
}

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  // The Electron shell uses Node's defaults for scrypt; these are the same numbers. Slow
  // enough to be worth the name, fast enough that opening one file is not noticeable.
  return scrypt(passphrase.normalize("NFKC"), salt, {
    N: 16_384,
    r: 8,
    p: 1,
    dkLen: SCRYPT_KEY_LENGTH,
  });
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function encodeJson(value: unknown): Uint8Array {
  return encodeStoreText(`${JSON.stringify(value, null, 2)}\n`);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
