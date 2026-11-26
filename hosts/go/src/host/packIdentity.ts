import { Directory, Filesystem } from "@capacitor/filesystem";
import {
  type DeviceKey,
  derivePackKey,
  generateDeviceKey,
  type PackIdentityService,
  type PackIdentityView,
  type PackKey,
  type PackRecordPurpose,
  packIdentityView,
  signPackRecord,
} from "@suite/go";

/**
 * The host's device key and the per-pack identities derived from it (S2.6, S4.7).
 *
 * The device key is the host's own Ed25519 seed, kept in the app's private data
 * directory. It never crosses the frame bridge and no pack can ask for it.
 *
 * The derivation itself lives in `@suite/go` (`identity.ts`) so this file owns
 * only storage. The input is `(publisher id, pack id)` under the versioned label
 * `suite/pack-identity/v1`, exactly as the desktop host derives it; the pure
 * vectors in `packages/go/src/identity.test.ts` are the cross-host proof.
 */

export const IDENTITY_ROOT = "identity";
export const DEVICE_KEY_FILE = "device.json";
export const DEVICE_KEY_VERSION = 1;

/** The bytes the host stores and reads. A test supplies its own implementation. */
export interface IdentityStorage {
  read(path: string): Promise<string | null>;
  write(path: string, text: string): Promise<void>;
}

/** Capacitor's private data directory, which is the app sandbox on a phone. */
export function createFilesystemIdentityStorage(): IdentityStorage {
  return {
    async read(path) {
      try {
        const file = await Filesystem.readFile({ path, directory: Directory.Data });
        return typeof file.data === "string" ? file.data : "";
      } catch {
        return null;
      }
    },
    async write(path, text) {
      const bytes = new TextEncoder().encode(text);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await Filesystem.writeFile({
        path,
        data: btoa(binary),
        directory: Directory.Data,
        recursive: true,
      });
    },
  };
}

function isDeviceKey(value: unknown): value is DeviceKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.version === DEVICE_KEY_VERSION &&
    typeof record.secretKey === "string" &&
    record.secretKey.length > 0 &&
    typeof record.publicKey === "string"
  );
}

/**
 * Read the host's device key, creating it on first use.
 *
 * A malformed file is not replaced: minting a new device key would change every
 * pack identity at once. The caller gets an error and identity calls stay
 * refused until the person repairs or deliberately removes the file.
 */
export async function openDeviceKey(
  storage: IdentityStorage,
  root = IDENTITY_ROOT,
): Promise<DeviceKey> {
  const path = `${root}/${DEVICE_KEY_FILE}`;
  const text = await storage.read(path);

  if (text === null) {
    const created = generateDeviceKey();
    await storage.write(path, `${JSON.stringify(created, null, 2)}\n`);
    return created;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!isDeviceKey(parsed)) {
    throw new Error(
      `The host device key at ${path} is not a device key; identity calls stay refused.`,
    );
  }
  return parsed;
}

/** Derive one pack's key from the host device key. The secret never leaves this module. */
export function deriveIdentityKey(device: DeviceKey, publisherId: string, packId: string): PackKey {
  return derivePackKey(device, publisherId, packId);
}

/**
 * The service a mounted pack sees.
 *
 * The secret lives in this closure. Only the public view and a signature leave.
 */
export function createPackIdentity(
  device: DeviceKey,
  publisherId: string,
  packId: string,
): PackIdentityService {
  const key = deriveIdentityKey(device, publisherId, packId);
  return {
    pack: (): Promise<PackIdentityView> => packIdentityView(key),
    sign: async (purpose: PackRecordPurpose, bytes: Uint8Array): Promise<string> =>
      signPackRecord(purpose, bytes, key.secretKey),
  };
}

/** A service for a module that did not declare `identity.pack`. It refuses both calls. */
export function refusedPackIdentity(message: string): PackIdentityService {
  return {
    pack: async () => {
      throw new Error(message);
    },
    sign: async () => {
      throw new Error(message);
    },
  };
}
